#!/usr/bin/env bash
# Issue #3530: what start-command (`$`) does with execution ids, verified on 0.37.8.
#
#   1. `--session U --session-id U` makes the execution id U: session, execution
#      and log file share one id.
#   2. `$ --resume U` keeps that id and appends attempt 2 to the same log.
#   3. A *new* launch that reuses an existing `--session-id` silently replaces the
#      earlier execution record and truncates its log (data loss).
#   4. The command is not told its own session/execution id (no env variable).
#
# Usage: experiments/issue-3530-start-session-id-reuse.sh
set -u
START="${START_BIN:-$(command -v '$' || echo "$HOME/.bun/bin/\$")}"
U="$(cat /proc/sys/kernel/random/uuid)"
LOG="/tmp/start-command/logs/isolation/screen/$U.log"
# The bot launches tasks detached; `--session` needs `--isolated`. Wait for a run to end.
wait_done() { for _ in $(seq 1 30); do "$START" --status "$1" 2>/dev/null | grep -qiE 'status +(executed|failed)|"status": *"(executed|failed)"' && return; sleep 1; done; }
echo "start-command: $("$START" --version 2>/dev/null | head -1)"
echo "id: $U"

echo; echo "== 1. one id for session and execution"
"$START" --isolated screen --detached --session "$U" --session-id "$U" -- sh -c 'echo first-run-output' >/dev/null 2>&1
wait_done "$U"
grep -c first-run-output "$LOG" | sed 's/^/first-run lines in log: /'

echo; echo "== 2. \$ --resume keeps the id and appends"
"$START" --resume "$U" >/dev/null 2>&1
sleep 2; wait_done "$U"
grep -c first-run-output "$LOG" | sed 's/^/first-run lines in log after resume (grows): /'

echo; echo "== 3. a new launch with the same --session-id"
"$START" --isolated screen --detached --session "other-$U" --session-id "$U" -- sh -c 'echo second-launch-output' >/dev/null 2>&1
sleep 2; wait_done "$U"
echo "first-run lines left in log (0 = earlier attempts lost): $(grep -c first-run-output "$LOG")"
echo "second-launch lines: $(grep -c second-launch-output "$LOG")"
"$START" --status "$U" 2>/dev/null | grep -iE 'session|attempt|command|status' | head -12

echo; echo "== 4. does the command see its id?"
V="$(cat /proc/sys/kernel/random/uuid)"
echo "env variables holding the id (0 = not exported): $("$START" --session-id "$V" -- env 2>/dev/null | grep -cE "^[A-Za-z_][A-Za-z0-9_]*=.*$V")"
