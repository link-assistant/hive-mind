#!/usr/bin/env bash
# Issue #3530: a kill recovery in a new container stays the same start-command
# execution with `--append-attempt` (start-command >= 0.38.0, start#229).
# Needs docker and `$` on PATH. Usage: bash experiments/issue-3530-append-attempt.sh
set -u
echo "start-command: $($ --version 2>&1 | head -1)"
TASK=$(cat /proc/sys/kernel/random/uuid)
FRESH=$(cat /proc/sys/kernel/random/uuid)
echo "--- attempt 1: --session $TASK --session-id $TASK (exits 137 like a kill)"
$ --isolated docker --image alpine:3.20 --detached --session "$TASK" --session-id "$TASK" -- sh -c 'echo attempt1; exit 137' 2>&1 | grep -E 'container|session|log '
sleep 5
echo "--- attempt 2 without --append-attempt (refused):"
$ --isolated docker --image alpine:3.20 --detached --session "$FRESH" --session-id "$TASK" -- sh -c 'echo x' 2>&1 | tail -1
echo "--- attempt 2: --session $FRESH --session-id $TASK --append-attempt"
$ --isolated docker --image alpine:3.20 --detached --session "$FRESH" --session-id "$TASK" --append-attempt -- sh -c 'echo attempt2 SID=$START_EXECUTION_ID ATT=$START_ATTEMPT NAME=$START_SESSION_NAME' 2>&1 | grep -E 'container|session|log '
sleep 5
echo "--- \$ --status <new container name> answers about the same execution:"
$ --status "$FRESH" --output-format json 2>/dev/null | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log({uuid:r.uuid,status:r.status,exitCode:r.exitCode,attempt:r.attempt?.number,history:(r.attemptHistory||[]).map(a=>[a.sessionName,a.exitCode]),logPath:r.logPath})'
echo "--- one log, both attempts:"
grep -E '^(attempt|Session:|Exit Code:)|attempt-appended' "/tmp/start-command/logs/isolation/docker/$TASK.log" | cut -c1-160
docker rm -f "$TASK" "$FRESH" >/dev/null 2>&1
