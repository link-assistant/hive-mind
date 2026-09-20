#!/usr/bin/env bash
# run-with-budget-warning.sh
#
# Owns the deadline for a long CI step so the step, not the job, decides
# when time has run out.
#
# `timeout-minutes` on a job is a backstop, never the deadline: GitHub
# reports a job killed by it as *cancelled*, not *failed*, so a genuine
# overrun can pass unnoticed on a pull request and cannot name the
# deadline it blew on the default branch. A step that owns its own budget
# exits non-zero instead, which GitHub reports as a failure with a title
# naming the budget and the overrun.
#
# Usage:
#   bash scripts/run-with-budget-warning.sh SECONDS LABEL COMMAND [ARG...]
#
# Environment:
#   BUDGET_WARN_PERCENT   emit a warning at this share of the budget (default 70)
#   BUDGET_GRACE_SECONDS  seconds between SIGTERM and SIGKILL (default 10)
#   BUDGET_POLL_SECONDS   polling interval while the command runs (default 1)
#
# Exit codes: the command's own status, or 124 on timeout (matching timeout(1)).
set -uo pipefail

if [ "$#" -lt 3 ]; then
  echo "Usage: $0 SECONDS LABEL COMMAND [ARG...]" >&2
  exit 2
fi

budget_seconds="$1"
label="$2"
shift 2

case "$budget_seconds" in
  '' | *[!0-9]*)
    echo "Budget must be a whole number of seconds, got '${budget_seconds}'." >&2
    exit 2
    ;;
esac

if [ "$budget_seconds" -le 0 ]; then
  echo "Budget must be greater than zero seconds." >&2
  exit 2
fi

warn_percent="${BUDGET_WARN_PERCENT:-70}"
grace_seconds="${BUDGET_GRACE_SECONDS:-10}"
poll_seconds="${BUDGET_POLL_SECONDS:-1}"
warn_seconds=$((budget_seconds * warn_percent / 100))

status_dir="$(mktemp -d "${TMPDIR:-/tmp}/budget-status.XXXXXX")"
status_file="${status_dir}/status"
trap 'rm -rf "${status_dir}"' EXIT

# `set -m` puts the command in its own process group, so the signals below
# reach the whole tree. `npm test` and `bun test` spawn workers, and killing
# only the direct child leaves orphans holding the runner -- which is also
# why timeout(1) is not sufficient here.
#
# Completion is detected through the status file rather than process
# liveness: a finished child stays visible as a zombie until it is reaped,
# so `kill -0` alone would never report it as done.
set -m
{
  "$@"
  command_status=$?
  printf '%s\n' "${command_status}" > "${status_file}.partial"
  mv "${status_file}.partial" "${status_file}"
} &
command_pid=$!
set +m

# Signal the process group when possible, falling back to the direct child
# on platforms without usable process groups (notably Git Bash on Windows).
signal_command() {
  local signal="$1"
  kill "-${signal}" -- "-${command_pid}" 2>/dev/null ||
    kill "-${signal}" "${command_pid}" 2>/dev/null ||
    true
}

command_is_running() {
  [ ! -f "${status_file}" ] && kill -0 "${command_pid}" 2>/dev/null
}

terminate_over_budget() {
  echo "::error title=${label} exceeded its execution budget::${label} did not finish within its ${budget_seconds}s budget and was terminated. Shorten the step or raise its budget (keeping it below the job's timeout-minutes backstop)."
  signal_command TERM

  local waited=0
  while command_is_running && [ "${waited}" -lt "${grace_seconds}" ]; do
    sleep "${poll_seconds}"
    waited=$((waited + poll_seconds))
  done

  if command_is_running; then
    echo "${label} ignored SIGTERM after ${grace_seconds}s; sending SIGKILL."
    signal_command KILL
  fi

  wait "${command_pid}" 2>/dev/null || true
  exit 124
}

echo "Running ${label} with a ${budget_seconds}s budget (warning at ${warn_seconds}s)."

SECONDS=0
warned=false

while command_is_running; do
  if [ "${warned}" = false ] && [ "${SECONDS}" -ge "${warn_seconds}" ]; then
    warned=true
    echo "::warning title=${label} is approaching its execution budget::${label} has run for ${SECONDS}s of its ${budget_seconds}s budget."
  fi

  if [ "${SECONDS}" -ge "${budget_seconds}" ]; then
    terminate_over_budget
  fi

  sleep "${poll_seconds}"
done

wait "${command_pid}" 2>/dev/null
wait_status=$?

# The status file is authoritative: the wrapper subshell's own exit status is
# that of the bookkeeping it does after the command returns.
if [ -f "${status_file}" ]; then
  status="$(cat "${status_file}")"
else
  status="${wait_status}"
fi
echo "${label} finished in ${SECONDS}s of its ${budget_seconds}s budget (exit ${status})."
exit "${status}"
