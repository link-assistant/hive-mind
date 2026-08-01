#!/usr/bin/env bash
# Issue #2117 (hive-mind) / start-command upstream defect.
#
# `$ --status` derives the exit code of a detached session from an UNANCHORED
# `Exit Code: N` scan over the WHOLE session log
# (src/lib/status-formatter.js#readExitCodeFromLog). Any text the wrapped command
# prints that merely contains "Exit Code: N" is therefore indistinguishable from
# the terminal footer start-command appends itself:
#
#     ==================================================
#     Finished: 2026-07-30 23:36:20.295
#     Exit Code: 0
#
# This script reproduces the fabrication end to end with the real CLI, with no
# mocks and no manipulation of the execution store.
#
# Requirements: docker, `$` (start-command) on PATH.
# Usage: bash experiments/issue-2117/upstream-repro-cli.sh
set -u

SESSION="issue-2117-repro-$$"
WORKDIR="$(mktemp -d)"
export START_APP_FOLDER="$WORKDIR/store"

cleanup() {
  docker rm -f "$SESSION" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== 1. start a detached docker command whose OUTPUT contains 'Exit Code: 1' =="
# The command exits 0 on its own; the '1' below is ordinary stdout, exactly like
# an agent echoing the tail of an older log.
$ -i docker -d --image alpine:3 --session "$SESSION" -- \
  sh -c 'echo "Exit Code: 1"; sleep 300' > "$WORKDIR/start.log" 2>&1

UUID="$(grep -m1 -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$WORKDIR/start.log")"
LOG="$(grep -m1 -oE '/[^ ]*/logs/isolation/docker/[0-9a-f-]+\.log' "$WORKDIR/start.log")"
echo "   uuid=$UUID"
echo "   log=$LOG"

echo
echo "== 2. simulate the window in which the container is gone but the host-side =="
echo "==    watcher has not appended the real footer yet                        =="
# The footer is written by a HOST-side `sh -c "docker logs -f …; docker inspect …; printf footer"`
# watcher, so between container stop and footer write there is a real window.
# Killing the watcher makes that window permanent and the reproduction deterministic.
pkill -9 -f "docker logs -f '?${SESSION}'?" >/dev/null 2>&1 || true
sleep 1
docker rm -f "$SESSION" >/dev/null 2>&1   # container is SIGKILLed: its real exit code is 137
sleep 1

echo "   log tail:"
tail -3 "$LOG" | sed 's/^/     /'

echo
echo "== 3. what \`\$ --status\` reports =="
STATUS_OUTPUT="$($ --status "$UUID" 2>&1)"
echo "$STATUS_OUTPUT" | sed -n '1,12p' | sed 's/^/     /'

REPORTED_STATUS="$(printf '%s\n' "$STATUS_OUTPUT" | sed -n 's/^[[:space:]]*status[[:space:]]\+\(.*\)$/\1/p' | head -1)"
REPORTED_EXIT="$(printf '%s\n' "$STATUS_OUTPUT" | sed -n 's/^[[:space:]]*exitCode[[:space:]]\+\(-\?[0-9]\+\)$/\1/p' | head -1)"

echo
echo "== result =="
echo "   status   = $REPORTED_STATUS"
echo "   exitCode = $REPORTED_EXIT   (expected: 137 from SIGKILL, or the -1 sentinel; NOT 1)"

if [ "$REPORTED_EXIT" = "1" ]; then
  echo
  echo "REPRODUCED: the exit code was fabricated from the command's own stdout."
  exit 0
fi

echo
echo "NOT REPRODUCED (exitCode=$REPORTED_EXIT) — the footer may have been written after all."
exit 1
