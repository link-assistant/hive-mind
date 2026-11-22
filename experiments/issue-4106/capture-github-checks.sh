#!/usr/bin/env bash
# Compare GitHub's PR check view with the REST views of the same head SHA.
set -euo pipefail
repo=${1:?Usage: bash capture-github-checks.sh OWNER/REPO PR}
pr=${2:?Provide a pull request number}

pr_state=$(gh pr view "$pr" --repo "$repo" --json headRefOid,isDraft,mergeable,mergeStateStatus,mergedAt,state,statusCheckRollup)
sha=$(jq -er '.headRefOid' <<< "$pr_state")

checks_exit=0
pr_checks=$(gh pr checks "$pr" --repo "$repo" --json bucket) || checks_exit=$?
case "$checks_exit" in
  0|1|8) ;;
  *) exit "$checks_exit" ;;
esac
jq -e 'type == "array"' <<< "$pr_checks" > /dev/null

rest_checks=$(gh api "repos/$repo/commits/$sha/check-runs?filter=latest&per_page=100" --paginate --slurp)
rest_status=$(gh api "repos/$repo/commits/$sha/status")
workflows=$(gh api "repos/$repo/actions/runs?head_sha=$sha&per_page=100" --paginate --slurp)
latest_sha=$(gh pr view "$pr" --repo "$repo" --json headRefOid --jq .headRefOid)
if [[ "$sha" != "$latest_sha" ]]; then
  echo "HEAD changed during capture. Run again to get comparable data." >&2
  exit 1
fi

jq -n \
  --arg capturedAt "$(date -u +%FT%TZ)" --arg repository "$repo" --argjson pullRequest "$pr" \
  --argjson prState "$pr_state" --argjson cliChecks "$pr_checks" \
  --argjson restChecks "$rest_checks" --argjson restStatus "$rest_status" --argjson workflows "$workflows" '
  def by($key): group_by(.[$key]) | map({($key): .[0][$key], count: length});
  {
    capturedAt: $capturedAt,
    repository: $repository,
    pullRequest: $pullRequest,
    prState: ($prState | .statusCheckRollup |= (map(.conclusion // .state // .status) | map({result: .}) | by("result"))),
    prChecksCli: ($cliChecks | by("bucket")),
    restHeadCheckRuns: ($restChecks | [.[].check_runs[] | {result: (.conclusion // .status)}] | by("result")),
    restLegacyStatuses: ($restStatus | {state, total_count, contexts: (.statuses | by("state"))}),
    restHeadWorkflowRuns: ($workflows | [.[].workflow_runs[] | {event, status, conclusion}] | group_by([.event, .status, .conclusion]) | map(.[0] + {count: length}))
  }'
