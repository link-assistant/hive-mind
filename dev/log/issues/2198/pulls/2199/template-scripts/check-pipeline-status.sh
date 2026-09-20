#!/usr/bin/env bash
# Turn timeout cancellations into visible failures on the release branch.
set -euo pipefail

: "${NEEDS_JSON:?NEEDS_JSON is required (pass toJSON(needs))}"
IS_MAIN="${IS_MAIN:-false}"

select_by_result() {
  NEEDS_JSON="$NEEDS_JSON" WANT_RESULT="$1" node --input-type=module -e '
    const needs = JSON.parse(process.env.NEEDS_JSON);
    const jobs = Object.entries(needs)
      .filter(([, value]) => value.result === process.env.WANT_RESULT)
      .map(([name]) => name);
    console.log(jobs.join(", "));
  '
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
    echo "::error::Pipeline has cancelled jobs on main: ${cancelled}. A job killed by 'timeout-minutes' is reported as cancelled, which would otherwise hide the failure."
    status=1
  else
    echo "::warning::Cancelled jobs: ${cancelled}. On a non-default ref this is usually a superseded run. A genuine overrun should surface as a step budget failure instead (see docs/CI-TIMEOUT-BUDGETS.md)."
  fi
fi

if [ "$status" -eq 0 ]; then
  echo "All required jobs succeeded or were legitimately skipped."
fi

exit "$status"
