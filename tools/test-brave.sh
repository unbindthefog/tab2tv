#!/bin/zsh
# Starts an isolated Brave instance with the extension loaded and CDP on port 9333.
# Profile dir: $TAB2TV_PROFILE (default: ~/.cache/tab2tv-test-profile). Usage: tools/test-brave.sh [url]
#   TAB2TV_KEEP_SESSION=1  keep the previous session (to test session restore)
#   TAB2TV_NO_EXT=1        start without any extension (control runs)
#   TAB2TV_LOG=1           Chromium logging to stderr
ROOT=${0:A:h:h}
PROFILE=${TAB2TV_PROFILE:-$HOME/.cache/tab2tv-test-profile}
# Start clean: no restored tabs/popups from earlier test runs.
[[ -z $TAB2TV_KEEP_SESSION ]] && rm -rf "$PROFILE/Default/Sessions" "$PROFILE/Default/Current Session" "$PROFILE/Default/Current Tabs"
# Hide the toolbar in fullscreen (Brave: View → "Always show toolbar in full screen"), otherwise a
# thin address bar stays visible on the TV. Set before every start: Brave may drop or reset it.
mkdir -p "$PROFILE/Default"
python3 - "$PROFILE/Default/Preferences" <<'EOF'
import json, os, sys
p = sys.argv[1]
try:
    with open(p) as f:
        d = json.load(f)
except (OSError, ValueError):
    d = {}   # missing or broken (test profile): Brave fills in the rest
d.setdefault('browser', {})['show_fullscreen_toolbar'] = False
with open(p + '.tmp', 'w') as f:
    json.dump(d, f)
os.replace(p + '.tmp', p)   # atomic: an interrupted write can't truncate Preferences
EOF
if [[ -n $TAB2TV_NO_EXT ]]; then
  EXT_ARGS=(--disable-extensions)
else
  EXT_ARGS=(--load-extension="$ROOT/extension" --enable-unsafe-extension-debugging)
fi
exec "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333 \
  --no-first-run --no-default-browser-check \
  --use-mock-keychain \
  ${TAB2TV_LOG:+--enable-logging=stderr} \
  "${EXT_ARGS[@]}" \
  "${1:-about:blank}"
