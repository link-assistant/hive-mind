#!/usr/bin/env bash
# Turn failures and unexplained cancellations into a failing Pipeline Status.
#
# GitHub reports a job killed by `timeout-minutes` as "cancelled", not
# "failed". A cancellation is only harmless when a newer commit superseded
# this run (the workflow's `cancel-in-progress` on non-main refs). Anything
# else - a timeout, or a cancellation on main, where runs queue instead of
# cancelling - fails the gate (issue #4025, adapted from
# link-foundation/js-ai-driven-development-pipeline-template).
#
# Inputs (environment):
#   NEEDS_JSON      toJSON(needs) (required)
#   IS_MAIN         "true" on refs/heads/main, for every event
#   RUN_SHA         the commit this run tests (the PR head for pull requests)
#   HEAD_REF        the ref whose head is compared with RUN_SHA
#                   (refs/pull/N/head for pull requests, refs/heads/X otherwise)
#   BRANCH_HEAD_SHA overrides the `git ls-remote` lookup (tests)
#   GIT_REMOTE      remote to query (default: origin)
#   PIPELINE_STATUS_VERBOSE=1 prints the gate's reasoning to stderr (off by default)
set -euo pipefail

: "${NEEDS_JSON:?NEEDS_JSON is required (pass toJSON(needs))}"
IS_MAIN="${IS_MAIN:-false}"
git_remote="${GIT_REMOTE:-origin}"
verbose="${PIPELINE_STATUS_VERBOSE:-0}"

trace() { [ "$verbose" = "1" ] && echo "[pipeline-status] $*" >&2 || true; }

select_by_result() {
  NEEDS_JSON="$NEEDS_JSON" WANT_RESULT="$1" node --input-type=module -e '
    const needs = JSON.parse(process.env.NEEDS_JSON);
    const jobs = Object.entries(needs)
      .filter(([, value]) => value.result === process.env.WANT_RESULT)
      .map(([name]) => name);
    console.log(jobs.join(", "));
  '
}

# Succeeds only when the ref has moved past the commit this run tests.
run_is_superseded() {
  local head="${BRANCH_HEAD_SHA:-}"
  if [ -z "${RUN_SHA:-}" ] || [ -z "${HEAD_REF:-}" ]; then
    echo "RUN_SHA or HEAD_REF is unset, so the gate cannot tell whether a newer commit superseded this run."
    return 1
  fi
  if [ -z "$head" ]; then
    head="$(git ls-remote "$git_remote" "$HEAD_REF" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
  fi
  trace "RUN_SHA=${RUN_SHA} HEAD_REF=${HEAD_REF} head=${head:-<unresolved>}"
  if [ -z "$head" ]; then
    echo "Could not resolve ${HEAD_REF}, so the gate cannot tell whether a newer commit superseded this run."
    return 1
  fi
  echo "This run tests ${RUN_SHA}; ${HEAD_REF} is at ${head}."
  [ "$head" != "$RUN_SHA" ]
}

failed="$(select_by_result failure)"
cancelled="$(select_by_result cancelled)"

echo "Failed jobs:    ${failed:-<none>}"
echo "Cancelled jobs: ${cancelled:-<none>}"

status=0

if [ -n "$failed" ]; then
  echo "::error::Pipeline failed. Failing jobs: ${failed}"
  status=1
fi

if [ -n "$cancelled" ]; then
  if [ "$IS_MAIN" = "true" ]; then
    echo "::error::Pipeline has cancelled jobs on main: ${cancelled}. Runs on main queue instead of cancelling, so this is a timeout ('timeout-minutes' is reported as cancelled) or a manual cancel."
    status=1
  elif run_is_superseded; then
    echo "::warning::Cancelled jobs: ${cancelled}. A newer commit superseded this run."
  else
    echo "::error::Cancelled jobs: ${cancelled}, but no newer commit superseded this run. A job that hits 'timeout-minutes' is reported as cancelled; see its log."
    status=1
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "All required jobs succeeded or were legitimately skipped."
fi

exit "$status"
