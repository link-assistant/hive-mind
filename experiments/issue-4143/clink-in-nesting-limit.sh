#!/usr/bin/env bash
# Issue #4143: `clink --in` rejects LiNo nested deeper than 64 levels.
# Usage: CLINK=/path/to/clink experiments/issue-4143/clink-in-nesting-limit.sh
set -u
CLINK=${CLINK:-clink}
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
$CLINK --version
for depth in 63 64 65; do
  python3 -c "
s = 'e'
for _ in range($depth - 1): s = f'(a {s})'
print(f'(root: r {s})')" > "$dir/in.lino"
  rm -f "$dir"/s.*
  error=$($CLINK --db "$dir/s.links" --in "$dir/in.lino" 2>&1 >/dev/null | head -1)
  links=$($CLINK --db "$dir/s.links" --out /dev/stdout 2>/dev/null | wc -l)
  echo "depth=$depth links_after=$links ${error:-ok}"
done
