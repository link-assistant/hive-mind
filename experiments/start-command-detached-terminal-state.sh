#!/usr/bin/env bash
# Minimal, self-contained reproducer for start-command 0.33.0:
# a detached Docker session that is SIGKILLed never gets its terminal state
# persisted, and `$ --status` fabricates `endTime` at query time.
#
# Usage: start-command-detached-terminal-state.sh [output-dir]
set -euo pipefail

out="${1:-/tmp/start-command-detached-terminal-state}"
session="$(cat /proc/sys/kernel/random/uuid)"
mkdir -p "$out"
trap 'docker rm -f "$session" >/dev/null 2>&1 || true' EXIT

echo "[1/5] launching a detached docker session (session=$session)"
\$ --isolated docker --image alpine:3.20 --shell sh \
  --detached --session "$session" \
  -- 'sleep 300' >"$out/launch.log" 2>&1 || true

log_path="$(grep -o '/tmp/start-command/logs/isolation/docker/[^ ]*\.log' "$out/launch.log" | head -n1)"
execution_id="$(basename "$log_path" .log)"

echo "[2/5] SIGKILL after 5s (the incident shape: exit 137, not an OOM)"
sleep 5
docker kill --signal KILL "$session" >/dev/null 2>&1 || true
sleep 3   # let the detached completion watcher append its block

docker inspect "$session" >"$out/inspect.json" 2>/dev/null || true
cp "$log_path" "$out/session.log"

echo "[3/5] first \$ --status"
\$ --status "$session" >"$out/status-1.txt" 2>&1 || true

echo "[4/5] reading the persisted record straight out of the store"
node -e '
const fs = require("fs");
const text = fs.readFileSync(process.env.HOME + "/.start-command/executions.lino", "utf8");
const decoded = text.replace(/\(str ([A-Za-z0-9+/=]+)\)/g, (_, b64) => `"${Buffer.from(b64, "base64").toString("utf8")}"`);
const at = decoded.indexOf(process.argv[1]);
const slice = at === -1 ? "" : decoded.slice(at, at + 1200);
for (const key of ["status", "exitCode", "endTime"]) {
  const m = slice.match(new RegExp(`"${key}"\\s+([^)]*)`));
  console.log(`persisted ${key} = ${m ? m[1].trim() : "<absent>"}`);
}
' "$execution_id" >"$out/stored-record.txt" 2>&1 || true

echo "[5/5] second \$ --status, 4s later (a *persisted* endTime cannot move)"
sleep 4
\$ --status "$session" >"$out/status-2.txt" 2>&1 || true

{
  echo "container_started_at=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].State.StartedAt' "$out/inspect.json")"
  echo "container_finished_at=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].State.FinishedAt' "$out/inspect.json")"
  echo "status_endTime_query_1=$(grep -o 'endTime.*' "$out/status-1.txt" | head -n1)"
  echo "status_endTime_query_2=$(grep -o 'endTime.*' "$out/status-2.txt" | head -n1)"
  cat "$out/stored-record.txt"
  echo "session_log_mentions_signal=$(grep -ci 'signal\|sigkill' "$out/session.log" || true)"
} | tee "$out/summary.txt"
