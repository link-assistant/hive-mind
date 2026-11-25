# Development log: issue 4149 / PR 4150

Issue: <https://github.com/link-assistant/hive-mind/issues/4149>
Pull request: <https://github.com/link-assistant/hive-mind/pull/4150>
Analysis: [`docs/case-studies/issue-4149/README.md`](../../../../../../docs/case-studies/issue-4149/README.md)

`*.log` is ignored by git, so logs are committed gzipped (`zcat <file>.log.gz`).

## Runs on `main` (045fdf675, 45c85a4b3)

| Run         | Workflow                | Result  | Evidence                                                                                                                                  |
| ----------- | ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 45280760241 | Checks and release      | success | `annotations.tsv`, `check-runs-045fdf675.tsv`: 8 `formal-ai 0.356.10 -> 0.356.11` freshness warnings (F4)                                  |
| 45309890775 | Dependabot Health       | success | `ci-logs/run-45309890775.log.gz` (the run before the failure)                                                                             |
| 45513290782 | Dependabot Health       | failure | `ci-logs/run-45513290782.log.gz`: `#4105 3 unfinished "Dependabot is rebasing this PR" banners` (F3); `pr-4105.json`: open, `DIRTY`        |
| 45618587462 | Formal AI Draft         | failure | `ci-logs/job-45618587462-draft.log.gz` line 4749: `Dispatched release.yml, but no run appeared for a3d8593cb…` (F2); the run 45622194807 existed |
| 45618594320 | Formal AI Draft         | failure | `ci-logs/run-45618594320.log.gz` line 2892: `unexpected end of JSON input` in `report-checks` at 14:39:28 (F1)                             |
| 45629684702 | Formal AI Draft (#4149) | failure | `ci-logs/run-45629684702.log.gz` line 3003: the same at 14:39:22 (F1); `ci-logs/job-45629684702-draft.log.gz`                              |
| 45638103197 | Checks and release (#4143 branch) | failure | `ci-logs/run-45638103197.log.gz`: `Dependency freshness failed: 15 stale`, all pins updated here (F4) |
| 45661017613 | Checks and release (this PR, merge of `main`) | failure | `ci-logs/run-45661017613-detect-changes.log.gz`: `12 stale`, Sentry 11.18.0 published at 16:49 UTC; pins updated (F4) |
| 45650846747 | Security                | failure, then success on re-run | `ci-logs/security-45650846747.log.gz`: both CodeQL `Analyze` steps fail after `Uploading results` with no error; the gate reports clean results |
| 45647110409 | Broken Link Checker     | failure | `ci-logs/links-45647110409.log.gz`: `[503]` for a public gist, `still failing (503)` after the re-check (F5)                               |
| 45624825910 | Cleanup Test Repositories | success | `annotations.tsv`: `1384 fixture branch(es) retained` (B1); `ruleset-21204104.json`: `deletion` on `~ALL`, no bypass actors          |
| 4563544…    | Dependabot Updates (8)  | success | `main-runs.json`, `check-runs-45c85a4b3.tsv`                                                                                              |

`main-runs.json` lists every `main` run from 2026-11-23 20:09 to 2026-11-25 14:33.
Each `ci-logs/run-*.json` holds the run's jobs and their conclusions.

## Reports

- `template-issues/{js,python,rust,cpp}.md`: the bodies of
  js#318, python#169, rust#273 and cpp#44 (missing retries on gh/API calls; the F1 class).
- Upstream: <https://github.com/cli/cli/issues/10579#issuecomment-7166867052>.

## Sessions

`sessions/` holds the AI solver session logs of this pull request.
