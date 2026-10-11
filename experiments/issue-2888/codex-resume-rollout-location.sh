#!/usr/bin/env bash
# Issue #2888: which CODEX_HOME layouts let `codex exec resume <thread>` find a
# thread's rollout? Needs a codex CLI; no auth is required — a found rollout
# fails later with 401, a missing one fails with "no rollout found".
set -u
ROOT=${1:-/tmp/exp2888-resume}
rm -rf "$ROOT"; mkdir -p "$ROOT"
cd "$ROOT"
# 1. Produce a real rollout in an "original container" CODEX_HOME.
mkdir -p "$ROOT/original"
CODEX_HOME="$ROOT/original" timeout 90 codex exec --skip-git-repo-check --json "say hi" </dev/null > original.log 2>&1
THREAD=$(grep -o '"thread_id":"[^"]*"' original.log | head -1 | cut -d'"' -f4)
[ -n "$THREAD" ] || { echo "no thread id produced"; cat original.log; exit 1; }
echo "thread=$THREAD"
ROLLOUT=$(find "$ROOT/original/sessions" -name "*$THREAD.jsonl" | head -1)
echo "rollout=$ROLLOUT"
REL=${ROLLOUT#"$ROOT/original/sessions/"}
try() {
  local name=$1
  CODEX_HOME="$ROOT/$name" timeout 90 codex exec resume "$THREAD" --skip-git-repo-check --json "continue" </dev/null > "$name.log" 2>&1
  if grep -q "no rollout found" "$name.log"; then echo "$name: NOT FOUND (no rollout found)"; elif grep -q "\"thread_id\":\"$THREAD\"" "$name.log"; then echo "$name: FOUND (thread.started $THREAD, then the API call)"; else echo "$name: other:"; tail -3 "$name.log"; fi
}
# A. Fresh container: empty per-repository CODEX_HOME (the incident).
mkdir -p "$ROOT/fresh"; try fresh
# B. sessions/ is a symlink to a shared (host-mounted) sessions dir.
mkdir -p "$ROOT/shared-sessions/$(dirname "$REL")" "$ROOT/symlinked"
cp "$ROLLOUT" "$ROOT/shared-sessions/$REL"
ln -s ../shared-sessions "$ROOT/symlinked/sessions"; try symlinked
# C. Rollout copied into a real sessions/ dir of a new CODEX_HOME (docker cp restore).
mkdir -p "$ROOT/copied/sessions/$(dirname "$REL")"; cp "$ROLLOUT" "$ROOT/copied/sessions/$REL"; try copied
# D. Rollout copied into today's date dir instead of its original date dir.
mkdir -p "$ROOT/redated/sessions/2020/01/01"; cp "$ROLLOUT" "$ROOT/redated/sessions/2020/01/01/"; try redated
# E. A home whose sqlite state already exists (a fresh run's capability
#    preflight has started codex there) but that never saw the thread: the
#    rollout is placed afterwards, as a pre-launch restore would do.
mkdir -p "$ROOT/prestate"
CODEX_HOME="$ROOT/prestate" timeout 90 codex exec resume "$THREAD" --skip-git-repo-check --json "continue" </dev/null > prestate-before.log 2>&1
ls "$ROOT/prestate" | grep -q sqlite && echo "prestate: sqlite state present before the restore"
mkdir -p "$ROOT/prestate/sessions/$(dirname "$REL")"; cp "$ROLLOUT" "$ROOT/prestate/sessions/$REL"; try prestate
