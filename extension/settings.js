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

// A display that can show the TV window: connected, enabled and not the main display. A display
// that becomes primary or disabled (e.g. switched to mirroring) counts as lost.
function tab2tvIsUsableTarget(d) {
  return !d.isPrimary && d.isEnabled !== false;
}

// Finds the chosen target among the connected displays (chrome.system.display.getInfo()) and how
// it was found: { display, by: 'auto' | 'id' | 'name' | 'resolution' } or { display: null }.
// macOS reports empty display names and AirPlay may assign new ids per connection, so match
// by id first, then by label (if known), then by resolution of an external display – the latter
// only if exactly one display has it, so a second monitor of the same size is never taken.
// A chosen display that is not connected yields null: never fall back to another monitor.
function tab2tvMatchTarget(displays, target) {
  const candidates = displays.filter(tab2tvIsUsableTarget);
  if (!target) return { display: candidates[0] || null, by: 'auto' };
  const byId = candidates.find(d => d.id === target.id);
  if (byId) return { display: byId, by: 'id' };
  const byName = target.label && candidates.find(d => d.name && d.name === target.label);
  if (byName) return { display: byName, by: 'name' };
  const sameSize = candidates.filter(d => !d.isInternal
    && d.bounds.width === target.width && d.bounds.height === target.height);
  if (sameSize.length === 1) return { display: sameSize[0], by: 'resolution' };
  return { display: null };
}

function tab2tvPickTarget(displays, target) {
  return tab2tvMatchTarget(displays, target).display;
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
// An explicit v1 "automatic output off" only meant "no automatic start": kept as an empty site list
// (the automatic mode switch also controls following the active tab, which v1 always did).
async function tab2tvMigrateSettings() {
  const { settingsVersion = 1, autoEnabled } = await chrome.storage.local.get(['settingsVersion', 'autoEnabled']);
  if (settingsVersion < 2) {
    if (autoEnabled === false) await chrome.storage.local.set({ autoSites: [], autoAllSites: false });
    await chrome.storage.local.remove(['autoEnabled', 'disabledSites', 'parallel']);
  }
  await chrome.storage.local.set({ settingsVersion: TAB2TV_SETTINGS_VERSION });
}

// A TV popup without its page (e.g. restored by Brave after a restart): TV URL but no opener tab.
function tab2tvIsOrphanTvTab(tab) {
  return (tab.url || tab.pendingUrl || '') === TAB2TV_POPUP_URL && tab.openerTabId == null;
}

// Scores the best video of every frame in a tab ([{ frameId, result: score }]); null if the
// page does not allow injection (browser pages, web store).
// Opening a TV window needs a user activation in the page, which a click in the popup does not
// give by itself. Scripts injected with chrome.scripting.executeScript right in
// the click handler run with that user gesture, though, so after this probe the chosen
// frame may call window.open. Call it before any await in the handler.
// Frames can't see into each other (cross-origin iframes), so each one scores its own video.
function tab2tvProbeFrames(tabId) {
  return chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => globalThis.tab2tvCandidateScore?.() ?? 0,
  }).catch(e => { console.debug('[TabToTV] probe failed:', e.message); return null; });
}

// Hostname of the website the user is on. For an embedded player that is the top-level page,
// taken from location.ancestorOrigins (last entry). A referrer policy can mask it ("null"); then
// the site is unknown (null) – never the iframe's own host, which would let e.g. a YouTube embed
// on any page count as youtube.com.
function tab2tvSiteHostname(isTopFrame, ownHostname, ancestorOrigins) {
  if (isTopFrame) return ownHostname;
  const top = ancestorOrigins?.[ancestorOrigins.length - 1];
  try { return top ? new URL(top).hostname || null : null; } catch { return null; }
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
