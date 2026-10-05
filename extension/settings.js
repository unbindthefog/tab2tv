// Shared settings defaults, used by content script, background and options page.
const TAB2TV_DEFAULTS = {
  autoEnabled: true,
  disabledSites: [],        // hostnames where automatic output is off
  parallel: false,          // keep video visible in the page player
  minDurationSec: 30,       // ignore shorter clips for automatic output
  minWidthPx: 320,          // ignore smaller videos for automatic output
  onEnded: 'stay',          // 'stay' | 'return' | 'black'
};

function tab2tvLoadSettings() {
  return chrome.storage.local.get(TAB2TV_DEFAULTS);
}
