# Issue 2281 / pull request 2282 evidence index

Collected on 2026-09-21 UTC for [hive-mind issue 2281](https://github.com/link-assistant/hive-mind/issues/2281) and [pull request 2282](https://github.com/link-assistant/hive-mind/pull/2282).

## Conclusions

- The cited main-branch failure is real, correctly reported, and caused by the release workflow requiring an unconfigured `RELEASE_PULL_REQUEST_TOKEN` after the Main ruleset rejected a direct push.
- The initial pull-request failure is real, correctly reported, and caused by three stale exact dependency declarations.
- `Pipeline Status` is not a second defect in either run; it correctly propagates the upstream failure.
- The successful cited workflows contain no suppressed repository-owned errors. The only runner-migration notice belongs to GitHub's dynamic Dependabot workflow; every repository-owned workflow already pins `ubuntu-24.04`.
- The last fully green release was run 34792591319. Its built-in token opened and merged release PR 2250 before `Pipeline Status` became a required check.
- The fix keeps the Main ruleset intact and uses the existing short-lived `GITHUB_TOKEN`: after every pre-release job succeeds and the generated commit is proven metadata-only, the release job publishes the required check on that exact commit, observes the required check, and merges the auditable PR.

See [ANALYSIS.md](ANALYSIS.md) for the full requirements, timeline, root causes, alternatives, and solution mapping. See [TEMPLATE-COMPARISON.md](TEMPLATE-COMPARISON.md) for the complete template comparison.

## Evidence layout

| Path | Contents |
| --- | --- |
| `issue.json`, `issue-comments.json`, `issue-timeline.json` | Complete issue metadata, every comment, and timeline events |
| `pr.json`, `pr-*.json`, `pr-timeline.json`, `pr-diff-initial.patch` | PR metadata, all three comment/review channels, events, and initial diff |
| `ci-runs.json`, `main-release-runs.json` | Recent run inventories with timestamps, SHAs, status, and conclusion |
| `ci-logs/run-*.json` | Full metadata and job/step structure for every investigated run |
| `ci-logs/run-*.log.gz` | Complete downloaded logs; decompress with `gzip -cd` |
| `ci-logs/annotations/`, `annotation-summary.tsv` | All 122 check-run annotation responses and counts |
| `ci-logs/key-lines.txt` | Short, line-addressed extract of every causal and propagating error |
| `github/` | Permissions, secret/variable names, environments, branch protection, and exact ruleset snapshots |
| `github/ruleset-main-put-*` | A safely rejected experiment proving GitHub Actions cannot be added as a ruleset bypass actor here; the before/after rulesets are identical |
| `research/pr-*`, `research/issue-*` | Related issue/PR metadata, all review channels, and historical implementations |
| `research/template-*` | Template head, history, complete file tree, workflow snapshot, and full `.github`/`scripts` diffs |
| `research/online/` | Primary-source GitHub and Changesets documentation and search snapshots |
| `research/upstream-follow-up-*` | Submitted template [issue 196](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/196), including reproduction, workarounds, and code plan |
| `research/reproducer-before.*` | Failing pre-fix regression reproduction and exit code |
| `tests/` | Focused and full local verification logs |

Raw workflow logs, large related/template diffs, and verbatim snapshots whose significant whitespace would pollute the source diff are gzip-compressed only to keep the evidence commit reviewable; compression does not alter their contents. `SHA256SUMS` records every final evidence artifact.
