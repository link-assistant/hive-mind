#!/bin/sh
# Issue #2189 / R25: does jscpd 5 still understand `.jscpd.json`'s v4 key
# `skipComments`, or does it silently ignore it? `--debug` prints the merged
# configuration, so the answer is readable rather than guessed.
set -eu
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
mkdir -p "$dir/src"
cat > "$dir/src/a.mjs" <<'JS'
// a comment that only differs between the two files
export const f = (a, b) => { const x = a + b; const y = a - b; const z = a * b; return [x, y, z]; };
JS
cat > "$dir/src/b.mjs" <<'JS'
// another comment that only differs between the two files
export const f = (a, b) => { const x = a + b; const y = a - b; const z = a * b; return [x, y, z]; };
JS

echo "=== v4 key: skipComments ==="
printf '{"minTokens":10,"minLines":1,"format":["javascript"],"skipComments":true,"reporters":["console"]}\n' > "$dir/.jscpd.json"
(cd "$dir" && "$1" --debug . 2>&1 | grep -i "mode\|skip" | head -5)

echo "=== v5 key: mode ==="
printf '{"minTokens":10,"minLines":1,"format":["javascript"],"mode":"weak","reporters":["console"]}\n' > "$dir/.jscpd.json"
(cd "$dir" && "$1" --debug . 2>&1 | grep -i "mode\|skip" | head -5)
