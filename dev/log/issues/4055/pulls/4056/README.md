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
| 43493862530 | Checks and release (2.40.2) | failure | `ci-logs/release-43493862530-job-132199526388.log.gz` (variants uploaded, main package published), `ci-logs/docker-arm64-43493862530-job-132204130169.log.gz`, `ci-logs/docker-dind-arm64-43493862530-job-132204130118.log.gz` (refusal), `ci-logs/docker-amd64-43493862530-job-132204130287.log.gz`, `ci-logs/npm-time-2.40.2.txt` (F9) |

## Runs of this pull request

| Run         | Workflow                             | Result                       | Evidence                                                                                                                                         |
| ----------- | ------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 43496638282 | Native Codex auth adapter experiment | attempt 1 failure, 2 success | `ci-logs/native-experiment-43496638282-config-lock.log.gz` (the `rustc` timeout), `…-attempt1-native-file-authority.log.gz` (the job log) (F7) |
| 43496638615 | Checks and release | success | `ci-logs/release-43496638615-linux-arm64-sqlite-recovery-selected-after.log.gz`: `actualNativeRecovery: true` on linux-arm64 (F1 fixed) |
| 43513268777 | Checks and release | failure | `ci-logs/release-43513268777-detect-changes.log.gz`: ESLint 10.15.0, published 11 minutes earlier, fails the freshness gate; ESLint updated |
| 43513684161 | Checks and release | failure | `ci-logs/release-43513684161-test-suites.log.gz`: `reap all live fixture processes` in the Router native-lifetime test (F8) |
| 43522467758 | Security | failure | `ci-logs/security-43522467758-codeql.log.gz`: CodeQL `js/incomplete-sanitization` in this pull request's own new F9 test (a hand-written regex escape); replaced by a substring check |
| 43524101203 | Checks and release | failure | `ci-logs/release-43524101203-test-suites-line-limit.log.gz`: the F9 comment made `release.yml` 1,351 lines, over the 1,350-line warning threshold; comment shortened |
| 43513683924 | Native Codex auth adapter experiment | failure | `ci-logs/native-experiment-43513683924-native-file-authority.log.gz`: `Expected the actual G0 usage snapshot.` for `logout` (F11) |
| 43527335157 | Native Codex auth adapter experiment | failure | `ci-logs/native-experiment-43527335157-native-file-authority.log.gz`: the same for `malformed`; its binary artifact reproduced the race locally (F11) |
| 43531726849 | Checks and release | failure | `ci-logs/release-43531726849-detect-changes.log.gz`: lino-i18n 0.6.0, published 23 minutes earlier, fails the freshness gate; lino-i18n updated |
| 43545485066 | Checks and release | failure | `ci-logs/release-43545485066-detect-changes.log.gz`: links-notation 0.31.4, published 64 minutes earlier, fails the freshness gate; the `use-m` pin and lockfile updated |
| 43533158148 | Workflows | attempt 1 cancelled, 2 success | `ci-logs/workflows-43533158148-attempt1-stuck-jobs.json`: all steps succeeded by 00:17:54, the jobs stayed `in_progress` until a force-cancel at 01:40 (B4); dispatched run 43541611465 passed on the same commit |

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
- `proc-dead-state-window.txt`: `experiments/issue-4055/proc-dead-state-window.py` shows a reaped zombie as `X (dead)` right after `Z` (F8).
- `dependabot-health-before.txt`: `node scripts/dependabot-health.mjs` against the live repository before #2285 was closed. It exits 1 and names #2285 (F6).
- `pr-2285-body.md`: #2285's body with its 37 rebase banners.
- `sanitizer-0.22.4-probes.txt`: `experiments/issue-4055/sanitizer-0.22.4-*.mjs` against sensitive-data-sanitizer 0.22.4 without the adapter. The library keeps a 4 MiB run next to an emoji, masks a 4 MiB Bearer value (#172 fixed) and keeps single-backtick placeholders (#177 fixed). It still masks the double-backtick one (#181 open), so only that exemption stays (F10).
- `native-limits-race-repro.log.gz`: 24 runs of `probe-codex-native-limits-generation.py --expect-retired-response` with `CODEX_PROBE_DIAGNOSTICS=1` against the before-repair binary of run 43527335157. Two print `application network permission was revoked` and now exit 3 (F11).

## Reports to other projects

- `upstream/`: comment on dependabot/dependabot-core#16791 and issue link-foundation/sensitive-data-sanitizer#182, the flaky timing test that blocks the release of the #177 fix (F10). `URLS.txt` has the links.
- `template-issues/`: issues filed in the pipeline templates: [python#149](https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/149), [cpp#28](https://github.com/link-foundation/cpp-ai-driven-development-pipeline-template/issues/28), [rust#239](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/239).

## Earlier evidence

- `ci-logs/pr2285-checks-35741671039.log.gz`: the only CI run of Dependabot pull request #2285 (2026-09-22). `detect-changes` failed the dependency-freshness gate on unrelated packages.
