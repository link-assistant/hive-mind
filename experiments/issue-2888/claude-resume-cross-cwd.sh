#!/usr/bin/env bash
# Issue #2888: Claude Code keeps transcripts in
# $CLAUDE_CONFIG_DIR/projects/<cwd with / → ->/<id>.jsonl. A fresh recovery run
# works in a different temporary directory than the killed one. Does
# `claude --resume <id>` still find the transcript? No credentials are used:
# a found session fails afterwards with an auth error, a missing one with
# "No conversation found".
set -u
SRC=${1:?usage: $0 <any existing claude session .jsonl to use as a template>}
ROOT=${2:-/tmp/exp2888-claude}
rm -rf "$ROOT"; mkdir -p "$ROOT/config" "$ROOT/original-cwd" "$ROOT/fresh-cwd"
ID=$(cat /proc/sys/kernel/random/uuid)
OLD_ID=$(head -c 4000 "$SRC" | grep -o '"sessionId":"[^"]*"' | head -1 | cut -d'"' -f4)
OLD_CWD=$(head -c 8000 "$SRC" | grep -o '"cwd":"[^"]*"' | head -1 | cut -d'"' -f4)
proj() { echo "$ROOT/config/projects/$(echo "$1" | sed 's|/|-|g')"; }
mkdir -p "$(proj "$ROOT/original-cwd")"
head -20 "$SRC" | sed "s|$OLD_ID|$ID|g; s|\"cwd\":\"$OLD_CWD\"|\"cwd\":\"$ROOT/original-cwd\"|g" > "$(proj "$ROOT/original-cwd")/$ID.jsonl"
echo "session=$ID stored under $(proj "$ROOT/original-cwd")"
run() {
  local name=$1 cwd=$2
  (cd "$cwd" && env -u ANTHROPIC_API_KEY -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR="$ROOT/config" timeout 60 claude --resume "${3:-$ID}" -p "continue" --output-format json </dev/null) > "$ROOT/$name.log" 2>&1
  if grep -qi "no conversation found" "$ROOT/$name.log"; then echo "$name: NOT FOUND ($(grep -oi 'no conversation found[^"]*' "$ROOT/$name.log" | head -1))"
  elif grep -q "Not logged in" "$ROOT/$name.log"; then echo "$name: FOUND (transcript loaded, then 'Not logged in')"
  else echo "$name: other -> $(head -c 300 "$ROOT/$name.log")"; fi
}
run missing-id-control "$ROOT/fresh-cwd" 11111111-2222-4333-8444-555555555555
run same-cwd "$ROOT/original-cwd"
run fresh-cwd "$ROOT/fresh-cwd"
# Relocation: copy the transcript into the fresh cwd's project directory.
mkdir -p "$(proj "$ROOT/fresh-cwd")"; cp "$(proj "$ROOT/original-cwd")/$ID.jsonl" "$(proj "$ROOT/fresh-cwd")/"
run fresh-cwd-relocated "$ROOT/fresh-cwd"
