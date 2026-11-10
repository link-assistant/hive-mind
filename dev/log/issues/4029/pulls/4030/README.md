# Evidence for issue #4029 / PR #4030

The analysis is in [`docs/case-studies/issue-4029/README.md`](../../../../../docs/case-studies/issue-4029/README.md).

| File                                                     | What it is                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ci-logs/checks-and-release-42609000121.log.gz`          | Main on `e1f89c0` (PR #3786 merge): `docker-pr-check` fails at P3 with `CodexStockBaselineError` (F1)       |
| `ci-logs/checks-and-release-42657172126.log.gz`          | Main on `b245deb` (the run named in the issue): same failure (F1); `git init` hints from native-codex-build (F6) |
| `ci-logs/checks-and-release-42765137804-pr.log.gz`       | First run of this PR: 7 stale declarations in the freshness gate (F3)                                       |
| `ci-logs/checks-and-release-pr-3739-42763193101.log.gz`  | Another PR failing the same freshness gate at the same time (F3)                                            |
| `ci-logs/cleanup-test-repositories-42614826072.log`      | Scheduled cleanup on `e1f89c0`, cancelled at the 15-minute timeout before the #4025 fix (F5)                |
| `ci-logs/cleanup-test-repositories-dry-run-42767772589.log` | Dispatched dry run on `b245deb`: finishes in about 1 minute; 1,108 fixtures and 1,380 retained branches (F5) |
| `ci-logs/e2e-hello-world-matrix-42679593402.json`        | E2E Hello World Matrix skipped (opt-in variable not set, F8)                                                |
| `ci-logs/formal-ai-draft-42764915861.log.gz`             | Formal AI Draft job for this issue: "Finished without changes" (F9)                                         |
| `ci-logs/formal-ai-draft-42678067777.log`, `formal-ai-draft-failed-42613543767.log` | Earlier drafts: `git init` hints (F6)                                            |
| `ci-logs/workflows-42657172034.log`                      | Workflows on `b245deb`: the pipx "already on your PATH" warning (F7)                                        |
| `ci-logs/security-42657171845.log.gz`, `broken-link-checker-42657171591.log`, `dependency-graph-42657181071.log`, `dependabot-github-actions-42636298498.log` | The green workflows named in the issue (F9) |
| `annotations-b245deb.txt`, `check-runs-b245deb.tsv`      | Every check run and annotation on `b245deb` (F9)                                                            |
| `formal-ai-draft-42764915861-annotations.txt`            | Annotations of the draft run for this issue                                                                 |
| `release-runs-docker-pr-check.tsv`                       | `docker-pr-check` results across recent release runs: never successful on the PR #3786 branch (F1, F2)    |
| `experiment-codex-stock-skills-drift.txt`                | `experiments/issue-4029/codex-stock-skills-drift.sh` with Codex 0.163.0 / 0.164.0 / 0.167.0 (F1)            |
| `experiment-codex-0.165-0.166.txt`                       | The same probe with 0.165.0 and 0.166.0: both match the pinned baseline (F1)                                |
| `local-lifecycle-before-fix.txt`, `local-lifecycle-after-fix.txt` | The full lifecycle gate run locally in the image, without and with the fix (F1)                     |
| `release-dispatch-durations.txt`                         | Durations of release runs dispatched by drafts (up to 137 minutes) (F4)                                     |
| `stale-pending-status-correction.txt`                    | The fixed reporter correcting 4 stale `pending` statuses (F4)                                               |
| `sessions/`                                              | Automated solver session logs                                                                               |
