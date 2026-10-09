// Popup of the toolbar icon: status, automatic mode switch, link to the options.
const $ = id => document.getElementById(id);

// ?tabId= lets tests open the popup as a normal tab for a given page tab.
const testTabId = +new URLSearchParams(location.search).get('tabId') || null;

let tab = null;
let autoMode = true;
let onTv = false;
let busy = false;   // a button action is running
let message = '';   // shown in the status line until the next click

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
  $('display').textContent = target
    ? 'Zielbildschirm: ' + tab2tvDisplayLabel(target, s.targetDisplay?.label)
    : 'Kein Zielbildschirm verbunden';
  $('display').classList.toggle('warn', !target);
  onTv = !!(tab && state.sessions[tab.id]);
  $('tabState').textContent = message || (onTv ? 'Dieser Tab läuft gerade auf dem TV.' : '');
  setLamp('sendLamp', onTv ? 'ON' : '', 'on');
  $('tabToggle').disabled = busy || (!target && !onTv);
  $('auto').disabled = busy;
  // Also leftovers: TV windows without a page (e.g. after a crash), closed by the same button.
  const tvWindows = (await chrome.tabs.query({ windowType: 'popup' }))
    .filter(t => (t.url || t.pendingUrl) === TAB2TV_POPUP_URL && t.openerTabId == null);
  const open = Object.keys(state.sessions).length + tvWindows.length;
  $('closeAll').disabled = busy || !open;
  setLamp('clearLamp', open ? String(open) : '', 'info');

  setLamp('autoLamp', autoMode ? 'ON' : 'OFF', autoMode ? 'on' : 'off');
  $('autoHint').textContent = autoMode
    ? 'Videos starten automatisch auf dem TV, der TV folgt dem aktiven Tab. Ausschalten: Der TV behält sein Video.'
    : 'Der TV behält sein Video und folgt keinem Tabwechsel. Einschalten holt das Video dieses Tabs auf den TV.';
}

const FAILED = 'Das hat nicht geklappt – bitte noch einmal versuchen.';

// Runs a button action: buttons disabled meanwhile, then re-rendered (render() alone decides
// which buttons are enabled), errors shown in the status line. The action returns a message to
// show, or 'close' to close the popup.
// `probe` must already be running: it was started synchronously within the click.
function runAction(probe, action) {
  if (busy) return;
  busy = true;
  message = '';
  $('auto').disabled = $('tabToggle').disabled = $('closeAll').disabled = true;
  probe.then(action)
    .catch(() => FAILED)
    .then(async result => {
      busy = false;
      if (result === 'close' && !testTabId) return window.close();
      message = result === 'close' ? '' : result || '';
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
  runAction(wasOnTv ? Promise.resolve([]) : tab2tvProbeFrames(tab.id), async results => {
    if (unsupported(results)) return 'Auf dieser Seite nicht möglich.';
    if (!wasOnTv && noVideo(results)) return 'Kein Video in diesem Tab gefunden.';
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
  runAction(turnOn && tab ? tab2tvProbeFrames(tab.id) : Promise.resolve([]), async results => {
    const ok = await chrome.runtime.sendMessage({ type: 'setAutoMode', on: turnOn, tabId: tab?.id, probe: results || [] });
    if (!ok) return FAILED;
    return turnOn && !noVideo(results) ? 'close' : '';
  });
});

$('closeAll').addEventListener('click', () => {
  runAction(Promise.resolve(), async () => {
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
