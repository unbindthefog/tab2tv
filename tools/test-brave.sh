#!/bin/zsh
# Starts an isolated Brave instance with the extension loaded and CDP on port 9333.
# Profile dir: $TAB2TV_PROFILE (default: ~/.cache/tab2tv-test-profile). Usage: tools/test-brave.sh [url]
ROOT=${0:A:h:h}
PROFILE=${TAB2TV_PROFILE:-$HOME/.cache/tab2tv-test-profile}
# Start clean: no restored tabs/popups from earlier test runs.
rm -rf "$PROFILE/Default/Sessions" "$PROFILE/Default/Current Session" "$PROFILE/Default/Current Tabs"
exec "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --user-data-dir="$PROFILE" --remote-debugging-port=9333 \
  --no-first-run --no-default-browser-check \
  --load-extension="$ROOT/extension" --enable-unsafe-extension-debugging \
  "${1:-about:blank}"
