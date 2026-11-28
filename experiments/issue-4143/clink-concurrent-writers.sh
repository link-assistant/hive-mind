#!/usr/bin/env bash
# Reproduces lost updates / failed writes when several clink processes write the
# same store at once (issue #4143). Usage:
#   CLINK=clink WRITERS=12 experiments/issue-4143/clink-concurrent-writers.sh
# CLINK may also be "node /path/to/link-cli/js/server/bin/clink.js".
set -u
CLINK=${CLINK:-clink}
WRITERS=${WRITERS:-12}
DIR=$(mktemp -d)
trap 'rm -r "$DIR"' EXIT
for i in $(seq 1 "$WRITERS"); do
  (
    echo "(w$i: w$i w$i)" > "$DIR/in$i.lino"
    if $CLINK --db "$DIR/s.links" --in "$DIR/in$i.lino" > /dev/null 2> "$DIR/err$i.txt"; then echo ok > "$DIR/status$i"; else echo failed > "$DIR/status$i"; fi
  ) &
done
wait
ok=$(grep -l ok "$DIR"/status* | wc -l)
$CLINK --db "$DIR/s.links" --out "$DIR/out.lino" > /dev/null 2>&1
present=$(grep -c '^(w' "$DIR/out.lino" || true)
lost=0
for i in $(seq 1 "$WRITERS"); do
  if grep -q ok "$DIR/status$i" && ! grep -q "^(w$i:" "$DIR/out.lino"; then lost=$((lost + 1)); fi
done
echo "writers=$WRITERS exited_ok=$ok links_present=$present lost_after_success=$lost"
grep -h . "$DIR"/err*.txt 2>/dev/null | sort | uniq -c | head -5
