// Popup of the toolbar icon: keys SEND (this tab to TV / back; message 'toggleTab'), CLEAR (close
// all TV windows), AUTO (automatic mode), OPT (options). State is shown only in the keys' lamp
// lines; a problem appears in red in the lamp of the key that was pressed.
const $ = id => document.getElementById(id);

// ?tabId= lets tests open the popup as a normal tab for a given page tab.
const testTabId = +new URLSearchParams(location.search).get('tabId') || null;

let tab = null;
let autoMode = true;
let onTv = false;
let busy = false;   // a button action is running
let problem = null; // { key, code }: short code (e.g. NO VIDEO) under the key that failed, until the next click

// Lamp line under a key legend (cockpit-panel style): text and color class on/off/info.
function setLamp(id, text, kind) {
  $(id).textContent = text;
  $(id).className = 'lamp' + (text ? ' ' + kind : '');
}

async function render() {
  const [displays, s, state] = await Promise.all([
    chrome.system.display.getInfo(),
    tab2tvLoadSettings(),
    chrome.storage.session.get({ sessions: {} }),
  ]);
  autoMode = s.autoMode;

  const target = tab2tvPickTarget(displays, s.targetDisplay);
  onTv = !!(tab && state.sessions[tab.id]);
  // SEND's lamp: a problem from the last click, else no TV connected, else on TV.
  if (problem?.key === 'tabToggle') setLamp('sendLamp', problem.code, 'off');
  else if (!target && !onTv) setLamp('sendLamp', 'NO TV', 'off');
  else setLamp('sendLamp', onTv ? 'ON' : '', 'on');
  $('tabToggle').disabled = busy || (!target && !onTv);
  $('auto').disabled = busy;
  // Also leftovers: TV windows without a page (e.g. after a crash), closed by the same button.
  const tvWindows = (await chrome.tabs.query({ windowType: 'popup' }))
    .filter(tab2tvIsOrphanTvTab);
  const open = Object.keys(state.sessions).length + tvWindows.length;
  $('closeAll').disabled = busy || !open;
  if (problem?.key === 'closeAll') setLamp('clearLamp', problem.code, 'off');
  else setLamp('clearLamp', open ? String(open) : '', 'info');

  if (problem?.key === 'auto') setLamp('autoLamp', problem.code, 'off');
  else setLamp('autoLamp', autoMode ? 'ON' : 'OFF', autoMode ? 'on' : 'off');
}

const FAILED = 'ERROR';

// Runs a button action: buttons disabled meanwhile, then re-rendered (render() alone decides
// which buttons are enabled), problems shown in the lamp of the pressed key. The action returns
// a short code to show, or 'close' to close the popup.
// `probe` must already be running: it was started synchronously within the click.
function runAction(key, probe, action) {
  if (busy) return;
  busy = true;
  problem = null;
  $('auto').disabled = $('tabToggle').disabled = $('closeAll').disabled = true;
  probe.then(action)
    .catch(() => FAILED)
    .then(async result => {
      busy = false;
      if (result === 'close' && !testTabId) return window.close();
      problem = result && result !== 'close' ? { key, code: result } : null;
      await render();
    });
}

// The probe could not inject (browser pages, web store, …): null. No video in any frame: no score.
const unsupported = results => results === null;
const noVideo = results => !results?.some(r => r.result > 0);

$('tabToggle').addEventListener('click', () => {
  if (!tab || busy) return;
  const wasOnTv = onTv;
  // Starting: probe right within the click (user activation for the TV window, see
  // tab2tvProbeFrames). Returning needs no probe.
  runAction('tabToggle', wasOnTv ? Promise.resolve([]) : tab2tvProbeFrames(tab.id), async results => {
    if (unsupported(results)) return 'N/A';          // e.g. a browser page
    if (!wasOnTv && noVideo(results)) return 'NO VIDEO';
    const ok = await chrome.runtime.sendMessage({ type: 'toggleTab', tabId: tab.id, probe: results });
    return ok ? 'close' : FAILED;
  });
});

// Keep the shown state (and autoMode used by the click handler) current while the popup is open.
chrome.storage.onChanged.addListener(() => { if (!busy) render(); });

$('auto').addEventListener('click', () => {
  if (busy) return;
  const turnOn = !autoMode;
  // Turning on starts this tab's video: probe right within the click, so the page gets the user
  // activation for opening the TV window (see tab2tvProbeFrames). No await before this call.
  runAction('auto', turnOn && tab ? tab2tvProbeFrames(tab.id) : Promise.resolve([]), async results => {
    const ok = await chrome.runtime.sendMessage({ type: 'setAutoMode', on: turnOn, tabId: tab?.id, probe: results || [] });
    if (!ok) return FAILED;
    return turnOn && !noVideo(results) ? 'close' : '';
  });
});

$('closeAll').addEventListener('click', () => {
  runAction('closeAll', Promise.resolve(), async () => {
    const ok = await chrome.runtime.sendMessage({ type: 'closeAll' });
    return ok ? '' : FAILED;
  });
});

$('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  if (!testTabId) window.close();
});

(async () => {
  tab = testTabId ? await chrome.tabs.get(testTabId)
    : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  render();
})();

// Footer line, as in Jan's other projects: "dev · v0.36 · 1a2b3c4" (empty without version.js).
const v = globalThis.TAB2TV_VERSION;
$('version').textContent = v ? `${v.branch} · v${v.version} · ${v.commit}` : '';
