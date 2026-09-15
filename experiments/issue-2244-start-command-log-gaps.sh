#!/usr/bin/env bash
set -euo pipefail

# Issue #2244 follow-up: what exactly is missing from a detached Docker session
# log when the task container is killed during startup, and which layer dropped
# each record.
#
# The harness reproduces the incident shape with a tiny image instead of the
# 19.7 GB DinD image: a start-command detached Docker session whose command is
# held by Hive Mind's start gate, killed with SIGKILL a few seconds in.
#
# It captures, for the same run:
#   * the start-command session log (the only artifact issue #2244 preserved),
#   * `$ --status` output (including its endTime),
#   * `docker inspect` state (StartedAt/FinishedAt/ExitCode/OOMKilled), and
#   * whether stdout written by the container before the kill survived.
#
# Usage: experiments/issue-2244-start-command-log-gaps.sh [output-dir]

image="${ISSUE_2244_LOG_GAP_IMAGE:-alpine:3.20}"
output_dir="${1:-/tmp/issue-2244-log-gaps}"
kill_after_seconds="${ISSUE_2244_KILL_AFTER_SECONDS:-5.5}"
session="$(cat /proc/sys/kernel/random/uuid)"
gate="/tmp/hive-mind-disk-baseline-${session}"

mkdir -p "$output_dir"
rm -f "$gate"

cleanup() {
  docker rm -f "$session" >/dev/null 2>&1 || true
  rm -f "$gate"
}
trap cleanup EXIT

echo "[setup] session: $session"
echo "[setup] image:   $image"

# Same shape as buildDockerStartGatedCommand(): silent poll for the host gate,
# then the real task command.
task_command="gate='${gate}'; i=0; while [ ! -e \"\$gate\" ] && [ \"\$i\" -lt 300 ]; do i=\$((i+1)); sleep 0.1; done; rm -f \"\$gate\"; echo WORKLOAD_STARTED; sleep 300"

echo "[run] launching detached docker session through start-command"
\$ --isolated docker \
  --image "$image" \
  --shell sh \
  -e "HIVE_MIND_PARENT_SESSION_ID=${session}" \
  --detached --session "$session" \
  -- "$task_command" >"$output_dir/launch-stdout.log" 2>&1 || true

log_path="$(grep -o '/tmp/start-command/logs/isolation/docker/[^ ]*\.log' "$output_dir/launch-stdout.log" | head -n1 || true)"
echo "[run] session log: ${log_path:-<none>}"

echo "[run] waiting ${kill_after_seconds}s, then SIGKILL (docker kill) like the incident's 5.563s"
sleep "$kill_after_seconds"
docker kill --signal KILL "$session" >/dev/null 2>&1 || true

# Give start-command's detached completion watcher time to append its block.
sleep 3

docker inspect "$session" >"$output_dir/container-inspect.json" 2>/dev/null || true
docker logs "$session" >"$output_dir/docker-logs.txt" 2>&1 || true
if [ -n "${log_path:-}" ] && [ -f "$log_path" ]; then
  cp "$log_path" "$output_dir/session.log"
fi

echo "[status] querying \$ --status (this is what issue #2244 pasted)"
\$ --status "$session" >"$output_dir/status.txt" 2>&1 || true

# The stored record is the durable artifact. Capture it verbatim so the
# difference between "recomputed at query time" and "persisted" is visible.
execution_id="$(grep -o 'Execution ID: [0-9a-f-]*' "$output_dir/session.log" | awk '{print $3}' | head -n1)"
store="${START_COMMAND_APP_FOLDER:-$HOME/.start-command}/executions.lino"
if [ -f "$store" ]; then
  cp "$store" "$output_dir/executions.lino"
  # The store is lino with base64-encoded scalars; decode it so the persisted
  # status/exitCode/endTime of this record are directly readable.
  node -e '
const fs = require("fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const decoded = text.replace(/\(str ([A-Za-z0-9+/=]+)\)/g, (_, b64) => `"${Buffer.from(b64, "base64").toString("utf8")}"`);
const uuid = process.argv[2];
const index = decoded.indexOf(uuid);
if (index === -1) { console.log("record not found in store"); process.exit(0); }
const slice = decoded.slice(index, index + 1200);
for (const key of ["status", "exitCode", "endTime"]) {
  const match = slice.match(new RegExp(`"${key}"\\s+([^)]*)`));
  console.log(`persisted ${key} = ${match ? match[1].trim() : "<absent>"}`);
}
' "$output_dir/executions.lino" "$execution_id" >"$output_dir/stored-record.txt" 2>&1 || true
fi

# Second query, a few seconds later: a *recomputed* endTime moves, a persisted
# one would not.
sleep 3
\$ --status "$session" >"$output_dir/status-second-query.txt" 2>&1 || true

# Finally, drop the container the way host cleanup eventually does and query a
# third time: this is the state issue #2244's investigation actually faced.
docker rm -f "$session" >/dev/null 2>&1 || true
\$ --status "$session" >"$output_dir/status-after-container-removed.txt" 2>&1 || true

now="$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)"
read -r started_at finished_at exit_code oom <<<"$(node -e '
const fs = require("fs");
try {
  const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))[0].State;
  console.log([state.StartedAt, state.FinishedAt, state.ExitCode, state.OOMKilled].join(" "));
} catch {
  console.log("unknown unknown unknown unknown");
}
' "$output_dir/container-inspect.json")"
status_end_time="$(grep -o 'endTime[^\n]*' "$output_dir/status.txt" | head -n1 || true)"

{
  echo "session=$session"
  echo "image=$image"
  echo "observed_at=$now"
  echo "container_started_at=$started_at"
  echo "container_finished_at=$finished_at"
  echo "container_exit_code=$exit_code"
  echo "container_oom_killed=$oom"
  echo "status_end_time_line=$status_end_time"
  echo "status_end_time_second_query=$(grep -o 'endTime[^\n]*' "$output_dir/status-second-query.txt" | head -n1 || true)"
  echo "status_after_container_removed=$(grep -o '^  status .*' "$output_dir/status-after-container-removed.txt" | head -n1 || true)"
  echo "stored_record=$(tr '\n' ' ' <"$output_dir/stored-record.txt" 2>/dev/null || true)"
  echo "session_log_bytes=$( [ -f "$output_dir/session.log" ] && wc -c <"$output_dir/session.log" || echo 0)"
  echo "session_log_mentions_signal=$(grep -ci 'signal\|sigkill' "$output_dir/session.log" 2>/dev/null || true)"
  echo "session_log_mentions_finished_at=$(grep -c "$finished_at" "$output_dir/session.log" 2>/dev/null || true)"
} >"$output_dir/summary.txt"

echo
echo "=== summary ==="
cat "$output_dir/summary.txt"
echo
echo "=== session log ==="
cat "$output_dir/session.log" 2>/dev/null || echo "(no session log)"
echo
echo "=== \$ --status ==="
cat "$output_dir/status.txt"
