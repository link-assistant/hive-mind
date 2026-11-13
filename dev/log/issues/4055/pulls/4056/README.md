# Development log: issue 4055 / PR 4056

Issue: <https://github.com/link-assistant/hive-mind/issues/4055>
Pull request: <https://github.com/link-assistant/hive-mind/pull/4056>
Analysis: [`docs/case-studies/issue-4055/README.md`](../../../../../../docs/case-studies/issue-4055/README.md)

`*.log` is ignored by git, so logs are committed gzipped (`zcat <file>.log.gz`).

## Runs on `f9ad62d` and after it

| Run         | Workflow                  | Result  | Evidence                                                                                                                                       |
| ----------- | ------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 43334992149 | Checks and release        | failure | `ci-logs/run-43334992149.log.gz`, `ci-logs/run-43334992149-jobs.json`, `ci-logs/release-43334992149-job-131589125538-linux-arm64.log.gz` (F1) |
|             |                           |         | `ci-logs/native-codex-build-logs-linux-arm64/` (the job's artifact; `native-release-sqlite-recovery-selected.log.gz` holds the F1 error)      |
| 43334991887 | Security                  | success | `ci-logs/run-43334991887.log.gz`                                                                                                               |
| 43334991939 | Broken Link Checker       | success | `ci-logs/run-43334991939.log.gz`                                                                                                               |
| 43334992000 | Workflows                 | success | `ci-logs/run-43334992000.log.gz`                                                                                                               |
| 43418490693 | Cleanup Test Repositories | success | `ci-logs/run-43418490693.log.gz`: 1,380 retained fixture branches (B1)                                                                         |
| 43443919872 | Dependabot (docker)       | success | `ci-logs/run-43443919872.log.gz`: `groups where no dependencies match` (F5)                                                                     |
| 434439…     | Dependabot (other 9 jobs) | success | `ci-logs/dependabot/run-*.log.gz`: `Deferring creation of a new pull request` for #2285 (F6)                                                   |
| 43463503145 | Formal AI Draft (health)  | success | `ci-logs/run-43463503145.log.gz`: green with 12 consecutive draft failures (F2)                                                                |
| 43491294883 | Formal AI Draft (#4055)   | failure | `ci-logs/run-43491294883.log.gz`: `DRAFT_IMAGE_UNAVAILABLE` for `konard/hive-mind:2.40.1` (F3)                                                 |


## Runs of this pull request

| Run         | Workflow                             | Result                       | Evidence                                                                                                                                         |
| ----------- | ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 43496638282 | Native Codex auth adapter experiment | attempt 1 failure, 2 success | `ci-logs/native-experiment-43496638282-config-lock.log.gz` (the `rustc` timeout), `…-attempt1-native-file-authority.log.gz` (the job log) (F7) |

## Summaries

- `check-runs-f9ad62d4b.tsv` and `annotations-f9ad62d4b.txt`: every check run and annotation on `f9ad62d` and the scheduled runs after it.
- `release-runs-main.tsv`: Checks and release history on `main`, where the failures began on 2026-11-09.
- `warnings-summary.txt`: every `warning`, `WARN` and `deprecated` line, grouped by run and job.
- `experiment-draft-health-outcomes-1631.txt`: the real draft outcomes replayed through the old health check. It ends with `streak: null`, which is F2.

## Reproductions and verification

- `probe-sqlx-before.log.gz`: the new `rebuild-closing` SQLx control fails with the CI error before the fix (F1).
- `probe-sqlx-after.log.gz`: all 50 SQLx controls pass after it.
- `probe-sqlite-selected-vfs-after.log.gz`: 1,034 VFS component controls pass.
- `sqlite-vfs-control-build.log.gz`, `test-native-build.log.gz`: the build of the control binary and the native build test.
- `dependabot-health-before.txt`: `node scripts/dependabot-health.mjs` against the live repository before #2285 was closed. It exits 1 and names #2285 (F6).
- `pr-2285-body.md`: #2285's body with its 37 rebase banners.

## Reports to other projects

- `upstream/`: comment on dependabot/dependabot-core#16791 (`URLS.txt` has the link).
- `template-issues/`: issues filed in the pipeline templates: [python#149](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/149), [cpp#28](https://github.com/link-foundation/cpp-ai-driven-development-pipeline-template/issues/28), [rust#239](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/239).

## Earlier evidence

- `ci-logs/pr2285-checks-35741671039.log.gz`: the only CI run of Dependabot pull request #2285 (2026-09-22). `detect-changes` failed the dependency-freshness gate on unrelated packages.
