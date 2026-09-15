#!/usr/bin/env bash
set -euo pipefail

# Issue #2244 verification: does a task container killed during startup now leave
# usable evidence behind?
#
# Companion to experiments/issue-2244-start-command-log-gaps.sh, which recorded
# what the *old* behavior preserved (an empty container stdout, a one-line
# `Reason: exitCode=137 oomKilled=false`, and nothing else once the container was
# removed). This script runs the same incident shape through the CURRENT code:
#
#   1. the task command is built by the real buildDockerStartGatedCommand(), so
#      the gate narrates itself instead of waiting silently;
#   2. the container is SIGKILLed mid-gate, exactly like the incident;
#   3. captureDockerTaskContainerDiagnostics() snapshots the container to the
#      host BEFORE it is removed, as the session monitor now does;
#   4. the container is removed and the snapshot is re-read, proving the evidence
#      outlives the container.
#
# A tiny image is used instead of the 19.7 GB DinD image; the daemon-log copy is
# therefore expected to be absent here (alpine has no /var/log/dockerd.log) and
# is reported as such.
#
# Usage: experiments/issue-2244-verify-full-logs.sh [output-dir]

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${ISSUE_2244_LOG_GAP_IMAGE:-alpine:3.20}"
output_dir="${1:-/tmp/issue-2244-verify-full-logs}"
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

# The command under test, built by the shipping code path — not a copy of it.
task_command="$(node --input-type=module -e "
import { buildDockerStartGatedCommand } from '${repo_root}/src/isolation-runner.lib.mjs';
process.stdout.write(buildDockerStartGatedCommand(\"echo WORKLOAD_STARTED; sleep 300\", '${session}'));
")"
printf '%s\n' "$task_command" >"$output_dir/task-command.sh"

echo "[run] launching detached docker session through start-command"
\$ --isolated docker \
  --image "$image" \
  --shell sh \
  -e "HIVE_MIND_PARENT_SESSION_ID=${session}" \
  --detached --session "$session" \
  -- "$task_command" >"$output_dir/launch-stdout.log" 2>&1 || true

log_path="$(grep -o '/tmp/start-command/logs/isolation/docker/[^ ]*\.log' "$output_dir/launch-stdout.log" | head -n1 || true)"
echo "[run] session log: ${log_path:-<none>}"

echo "[run] waiting ${kill_after_seconds}s, then SIGKILL like the incident's 5.563s"
sleep "$kill_after_seconds"
docker kill --signal KILL "$session" >/dev/null 2>&1 || true
sleep 3

# What the session monitor now does before the retention policy reaps the
# container: snapshot it to the host.
node --input-type=module -e "
import { captureDockerTaskContainerDiagnostics } from '${repo_root}/src/docker-task-diagnostics.lib.mjs';
const capture = await captureDockerTaskContainerDiagnostics({
  containerName: '${session}',
  logPath: '${log_path:-}' || null,
  exitCode: 137,
  status: 'killed',
  verbose: true,
});
console.log(JSON.stringify(capture, null, 2));
" >"$output_dir/capture.json" 2>"$output_dir/capture.stderr" || true

diagnostics_dir="$(node -e '
const fs = require("fs");
try {
  const text = fs.readFileSync(process.argv[1], "utf8");
  const start = text.indexOf("{");
  console.log(JSON.parse(text.slice(start)).directory || "");
} catch { console.log(""); }
' "$output_dir/capture.json")"

if [ -n "${log_path:-}" ] && [ -f "$log_path" ]; then
  cp "$log_path" "$output_dir/session.log"
fi

# Now destroy the container, the way the monitor does, and re-read the snapshot.
docker rm -f "$session" >/dev/null 2>&1 || true
if [ -n "$diagnostics_dir" ] && [ -d "$diagnostics_dir" ]; then
  cp -r "$diagnostics_dir" "$output_dir/diagnostics-after-container-removed"
fi

check() {
  local label="$1" condition="$2"
  if eval "$condition"; then
    echo "PASS $label"
  else
    echo "FAIL $label"
  fi
}

{
  echo "session=$session"
  echo "image=$image"
  echo "session_log=${log_path:-<none>}"
  echo "diagnostics_dir=${diagnostics_dir:-<none>}"
  echo
  # The session log's header echoes the command verbatim, so the markers are
  # counted in the container's OWN output (docker logs), and the session log is
  # required to carry them more than once - header plus live output.
  check "container output records that the gate was waiting" "grep -q 'start-gate: waiting' '$output_dir/diagnostics-after-container-removed/container-logs.txt'"
  check "container output records a heartbeat, so the task had not started yet" "grep -q 'start-gate: still waiting after' '$output_dir/diagnostics-after-container-removed/container-logs.txt'"
  check "session log carries the live markers, not only the echoed command" "[ \"\$(grep -c 'start-gate: waiting' '$output_dir/session.log')\" -ge 2 ]"
  check "container state was snapshotted before removal" "[ -f '$output_dir/diagnostics-after-container-removed/container-inspect.json' ]"
  check "snapshot names the signal behind exit 137" "grep -q 'SIGKILL' '$output_dir/diagnostics-after-container-removed/summary.txt'"
  check "snapshot keeps the real container timestamps" "grep -q 'finishedAt=20' '$output_dir/diagnostics-after-container-removed/summary.txt'"
  check "container output survived the container" "[ -f '$output_dir/diagnostics-after-container-removed/container-logs.txt' ]"
  echo
  echo "note: the nested daemon log (dockerd.log) is only present for DinD images;"
  echo "with ${image} the capture reports it as missing, which is the expected miss."
} >"$output_dir/summary.txt"

echo
echo "=== summary ==="
cat "$output_dir/summary.txt"
echo
echo "=== session log ==="
cat "$output_dir/session.log" 2>/dev/null || echo "(no session log)"
echo
echo "=== snapshot summary.txt ==="
cat "$output_dir/diagnostics-after-container-removed/summary.txt" 2>/dev/null || echo "(no snapshot)"
