// Shared settings defaults, used by content script, background and options page.
const TAB2TV_DEFAULTS = {
  autoEnabled: true,
  disabledSites: [],        // hostnames where automatic output is off
  parallel: false,          // keep video visible in the page player
  minDurationSec: 30,       // ignore shorter clips for automatic output
  minWidthPx: 320,          // ignore smaller videos for automatic output
  onEnded: 'stay',          // 'stay' | 'return' | 'black'
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

function tab2tvLoadSettings() {
  return chrome.storage.local.get(TAB2TV_DEFAULTS);
}
