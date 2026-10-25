#!/bin/zsh
# Builds the live test copy of the extension that Jan loads in his main Brave next to the regular
# install: /Users/Shared/dev/tab2tv-live (or $TAB2TV_LIVE). Every file is a symlink into this
# worktree's extension/, so code changes show up after ↻ in brave://extensions. Only manifest.json
# is a copy, renamed to "TabToTV (live)" so both installs can be told apart.
# Run again after manifest.json changes or files are added at the top level of extension/.
# The folder stays the same when switching branches: run this script from the other worktree,
# e.g. /Users/Shared/dev/tab2tv-glass/tools/make-live.sh.
SRC=${0:A:h:h}/extension
LIVE=${TAB2TV_LIVE:-/Users/Shared/dev/tab2tv-live}
[[ -f $SRC/manifest.json ]] || { echo "no manifest.json in $SRC" >&2; exit 1 }

[[ -L $LIVE ]] && rm "$LIVE"          # earlier version was a single symlink
# Only work in a folder this script created (it holds .source) or an empty/new one, never in
# some other folder $TAB2TV_LIVE might point to by mistake.
if [[ -d $LIVE && ! -e $LIVE/.source && -n $(ls -A "$LIVE") ]]; then
  echo "refusing: $LIVE exists, is not empty and was not created by this script" >&2; exit 1
fi
mkdir -p "$LIVE"
# Remove only what this script created (symlinks, the manifest copy, the source note).
find "$LIVE" -mindepth 1 -maxdepth 1 \( -type l -o -name manifest.json -o -name .source \) -delete
for f in "$SRC"/*(N); do
  [[ ${f:t} == manifest.json ]] && continue
  ln -sfn "$f" "$LIVE/${f:t}"
done
python3 - "$SRC/manifest.json" "$LIVE/manifest.json" <<'EOF'
import json, sys
m = json.load(open(sys.argv[1]))
m['name'] = m['name'] + ' (live)'
json.dump(m, open(sys.argv[2], 'w'), indent=2, ensure_ascii=False)
EOF
print -r -- "$SRC" > "$LIVE/.source"
echo "live copy: $LIVE -> $SRC"
