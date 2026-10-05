// Popup of the toolbar icon: status, automatic mode switch, link to the options.
const $ = id => document.getElementById(id);

// ?tabId= lets tests open the popup as a normal tab for a given page tab.
const testTabId = +new URLSearchParams(location.search).get('tabId') || null;

let tab = null;
let autoMode = true;

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
    : 'Kein Zielbildschirm verbunden – die Erweiterung ist inaktiv.';
  $('display').classList.toggle('warn', !target);
  $('tabState').textContent = tab && state.sessions[tab.id] ? 'Dieser Tab läuft gerade auf dem TV.' : '';

  $('auto').textContent = 'Automatik: ' + (autoMode ? 'AN' : 'AUS');
  $('auto').classList.toggle('off', !autoMode);
  $('autoHint').textContent = autoMode
    ? 'Videos starten automatisch auf dem TV, der TV folgt dem aktiven Tab. Ausschalten: Der TV behält sein Video.'
    : 'Der TV behält sein Video und folgt keinem Tabwechsel. Einschalten holt das Video dieses Tabs auf den TV.';

  const cmd = (await chrome.commands.getAll()).find(c => c.name === 'toggle-tv');
  $('shortcut').replaceChildren();
  if (cmd?.shortcut) {
    const key = document.createElement('kbd');
    key.textContent = cmd.shortcut;
    $('shortcut').append(key, ' Video dieses Tabs auf den TV / zurückholen');
  }
}

$('auto').addEventListener('click', () => {
  const turnOn = !autoMode;
  // Turning on starts this tab's video: probe right within the click, so the page gets the user
  // activation for opening the TV window (see tab2tvProbeFrames). No await before this call.
  const probe = turnOn && tab ? tab2tvProbeFrames(tab.id) : Promise.resolve([]);
  probe.then(async results => {
    await chrome.runtime.sendMessage({ type: 'setAutoMode', on: turnOn, tabId: tab?.id, probe: results });
    if (turnOn && !testTabId) window.close();
    else render();
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
