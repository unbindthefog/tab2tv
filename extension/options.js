const $ = id => document.getElementById(id);

let displays = [];
let labels = {};        // display id -> label from the Window Management API (optional)
let savedTarget = null;

// Display names: chrome.system.display reports none on macOS. getScreenDetails() may know them,
// but needs the window-management permission (one-time prompt, triggered by a click).
async function loadLabels(request) {
  try {
    const perm = await navigator.permissions.query({ name: 'window-management' });
    if (perm.state !== 'granted' && !request) return;
    const details = await window.getScreenDetails();
    labels = {};
    for (const s of details.screens) {
      const d = displays.find(d => d.bounds.left === s.left && d.bounds.top === s.top
        && d.bounds.width === s.width && d.bounds.height === s.height);
      if (d && s.label) labels[d.id] = s.label;
    }
  } catch (e) {
    $('displayStatus').textContent = 'Bildschirmnamen nicht verfügbar: ' + e.message;
  }
}

async function renderDisplays() {
  displays = await chrome.system.display.getInfo();
  const sel = $('targetDisplay');
  const opts = [new Option('Automatisch: erster zusätzlicher Bildschirm', '')];
  for (const d of displays.filter(d => !d.isPrimary)) {
    opts.push(new Option(tab2tvDisplayLabel(d, labels[d.id]), d.id));
  }
  const match = savedTarget && tab2tvPickTarget(displays, savedTarget);
  if (savedTarget && !match) {
    opts.push(new Option(`${savedTarget.label || 'Gewählter Bildschirm'} (${savedTarget.width}×${savedTarget.height}) – nicht verbunden`, 'saved'));
  }
  sel.replaceChildren(...opts);
  sel.value = !savedTarget ? '' : match ? match.id : 'saved';

  const current = tab2tvPickTarget(displays, savedTarget);
  $('displayStatus').textContent = current
    ? 'Ausgabe aktuell auf: ' + tab2tvDisplayLabel(current, labels[current.id])
    : 'Kein Zielbildschirm verbunden.';

  const { displayLog = [] } = await chrome.storage.local.get('displayLog');
  $('displayLog').textContent = displayLog.slice().reverse().map(e =>
    new Date(e.t).toLocaleTimeString('de-DE') + ' ' + e.event + ': ' +
    e.displays.map(d => `#${d.id} ${d.w}×${d.h}${d.primary ? ' primär' : ''}${d.internal ? ' intern' : ''}${d.name ? ' „' + d.name + '“' : ''}`).join(', ')
  ).join('\n') || '(noch keine Einträge)';
}

function selectedTarget() {
  const v = $('targetDisplay').value;
  if (v === '') return null;
  if (v === 'saved') return savedTarget;
  const d = displays.find(d => d.id === v);
  return { id: d.id, width: d.bounds.width, height: d.bounds.height, label: labels[d.id] || d.name || '' };
}

async function renderShortcuts() {
  // _execute_action is the implicit "click the toolbar icon" command; only show it if assigned.
  const commands = (await chrome.commands.getAll())
    .filter(c => c.name !== '_execute_action' || c.shortcut);
  $('shortcuts').replaceChildren(...commands.map(c => {
    const row = document.createElement('div');
    const key = document.createElement('kbd');
    key.textContent = c.shortcut || 'nicht festgelegt';
    const label = c.name === '_execute_action' ? 'Wie Klick auf das Erweiterungssymbol' : c.description;
    row.append(key, ' ', label);
    return row;
  }));
}

function syncAutoFields() {
  $('autoSites').disabled = $('autoAllSites').checked;
}

tab2tvLoadSettings().then(async s => {
  $('autoAllSites').checked = s.autoAllSites;
  $('autoSites').value = s.autoSites.join('\n');
  syncAutoFields();
  $('parallel').checked = s.parallel;
  $('minDurationSec').value = s.minDurationSec;
  $('minWidthPx').value = s.minWidthPx;
  $('onEnded').value = s.onEnded;
  $('backgroundCloseSec').value = s.backgroundCloseSec;
  savedTarget = s.targetDisplay;
  displays = await chrome.system.display.getInfo();
  await loadLabels(false);
  renderDisplays();
});

renderShortcuts();
// Shortcuts may be changed on the browser's shortcut page while this page is open.
addEventListener('focus', renderShortcuts);
$('editShortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
$('autoAllSites').addEventListener('change', syncAutoFields);

chrome.system.display.onDisplayChanged.addListener(() => setTimeout(renderDisplays, 300));

$('showNames').addEventListener('click', async () => {
  await loadLabels(true);
  renderDisplays();
});

$('save').addEventListener('click', async () => {
  savedTarget = selectedTarget();
  const autoSites = [...new Set($('autoSites').value.split('\n').map(tab2tvNormalizeSite).filter(Boolean))];
  $('autoSites').value = autoSites.join('\n');
  await chrome.storage.local.set({
    autoAllSites: $('autoAllSites').checked,
    autoSites,
    parallel: $('parallel').checked,
    minDurationSec: +$('minDurationSec').value,
    minWidthPx: +$('minWidthPx').value,
    onEnded: $('onEnded').value,
    backgroundCloseSec: Math.max(5, +$('backgroundCloseSec').value || 30),
    targetDisplay: savedTarget,
  });
  renderDisplays();
  $('saved').textContent = 'Gespeichert';
  setTimeout(() => { $('saved').textContent = ''; }, 1500);
});
