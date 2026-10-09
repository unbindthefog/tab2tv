// URL of the TV popup. The fragment keeps it same-origin with the opener (still "about:blank")
// but makes leftover popups recognizable, e.g. after Brave restored them on restart.
const TAB2TV_POPUP_URL = 'about:blank#tab2tv';

// Shared settings defaults, used by content script, background and options page.
const TAB2TV_DEFAULTS = {
  autoMode: true,           // master switch (toolbar icon): automatic start + TV follows active tab
  autoAllSites: false,      // automatic output on every website
  autoSites: ['youtube.com'], // websites with automatic output (domain, includes subdomains)
  parallel: true,           // keep video visible in the page player
  minDurationSec: 30,       // ignore shorter clips for automatic output
  minWidthPx: 320,          // ignore smaller videos for automatic output
  onEnded: 'stay',          // 'stay' | 'return' | 'black'
  backgroundCloseSec: 30,   // close a TV window this long after another tab took over the TV
  targetDisplay: null,      // null = first non-primary display, else { id, width, height, label }
};

// Finds the chosen target among the connected displays (chrome.system.display.getInfo()).
// macOS reports empty display names and AirPlay may assign new ids per connection, so match
// by id first, then by label (if known), then by resolution of an external display.
// A chosen display that is not connected yields null: never fall back to another monitor.
function tab2tvPickTarget(displays, target) {
  const candidates = displays.filter(d => !d.isPrimary && d.isEnabled !== false);
  if (!target) return candidates[0] || null;
  return candidates.find(d => d.id === target.id)
    || (target.label && candidates.find(d => d.name && d.name === target.label))
    || candidates.find(d => !d.isInternal
      && d.bounds.width === target.width && d.bounds.height === target.height)
    || null;
}

function tab2tvDisplayLabel(d, label) {
  const name = label || d.name || (d.isInternal ? 'Eingebauter Bildschirm' : 'Externer Bildschirm');
  return `${name} (${d.bounds.width}×${d.bounds.height})`;
}

// Bumped when stored values change meaning or defaults; see tab2tvMigrateSettings().
const TAB2TV_SETTINGS_VERSION = 2;

function tab2tvLoadSettings() {
  return chrome.storage.local.get(TAB2TV_DEFAULTS);
}

// v2: automatic output is opt-in per website (allow-list instead of block-list) and the parallel
// view is the default. Drop the old values once so the new defaults apply; keep everything else.
async function tab2tvMigrateSettings() {
  const { settingsVersion = 1 } = await chrome.storage.local.get('settingsVersion');
  if (settingsVersion < 2) await chrome.storage.local.remove(['autoEnabled', 'disabledSites', 'parallel']);
  await chrome.storage.local.set({ settingsVersion: TAB2TV_SETTINGS_VERSION });
}

// Scores the best video of every frame in a tab ([{ frameId, result: score }]); null if the
// page does not allow injection (browser pages, web store).
// Opening a TV window needs a user activation in the page, which a click in the popup or a
// shortcut does not give by itself. Scripts injected with chrome.scripting.executeScript right in
// the click/shortcut handler run with that user gesture, though, so after this probe the chosen
// frame may call window.open. Call it before any await in the handler.
// Frames can't see into each other (cross-origin iframes), so each one scores its own video.
function tab2tvProbeFrames(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.tab2tvCandidateScore?.() ?? 0,
  }).catch(e => { console.debug('[TabToTV] probe failed:', e.message); return null; });
}

// "youtube.com" matches youtube.com and all its subdomains.
function tab2tvSiteMatches(hostname, sites) {
  return sites.some(site => hostname === site || hostname.endsWith('.' + site));
}

// Normalizes user input like "https://www.youtube.com/watch" to "youtube.com".
function tab2tvNormalizeSite(input) {
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0];
  return host.replace(/^www\./, '');
}
