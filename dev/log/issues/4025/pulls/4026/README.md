# Evidence for issue #4025 / PR #4026

The analysis is in [`docs/case-studies/issue-4025/README.md`](../../../../../docs/case-studies/issue-4025/README.md).

| File                                                | What it is                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ci-logs/run-42570340658.{json,log.gz}`             | Checks and release on `c6e68bc`: stale-dependency warnings, `claude-prompt-argv-3282` fails |
| `ci-logs/test-suites.log`                           | The `test-suites` job of that run                                                           |
| `ci-logs/run-42570340566.{json,log}`                | Broken Link Checker: lychee-action download, curl exit 22                                   |
| `ci-logs/run-42472902848.{json,log}`                | Cleanup Test Repositories cancelled at the 15-minute timeout                                |
| `ci-logs/cleanup-run-history.json`                  | Last 37 cleanup runs (one success since 2026-10-20)                                         |
| `ci-logs/cleanup-success-40177802029.log`           | The last successful cleanup, for comparison                                                 |
| `ci-logs/cleanup-dry-run-after-fix.txt`             | Read-only dry run of the fixed script against this repository (35 s)                        |
| `ci-logs/run-42570805017.{json,log}`                | E2E Hello World Matrix skipped: opt-in variable not set                                     |
| `ci-logs/e2e-41776642750-failed.log.gz`             | The last E2E matrix run on main before the opt-in gate, which failed                        |
| `ci-logs/formal-ai-draft-42599900381.log.gz`        | Formal AI Draft for this issue: exit 5, annotation blamed a 403                             |
| `ci-logs/formal-ai-draft-42599900381-session-tail.log` | End of that session log: "Finished without changes" and the recovered gh-upload-log 403   |
| `ci-logs/pr4024-final-run-42311200153.log.gz`       | Last PR #4024 run: green, because the broken tests were not in the PR subset                |
| `ci-logs/checks-42605582705-agent-verbose-env.log` | `test-agent-verbose-env.mjs` failing once the whole suite ran (F11) |
| `ci-logs/checks-42608795713-freshness-npm10.log` | npm 10 re-nesting minimatch with the ranged override key (F9) |
| `ci-logs/codeql-open-alerts-main.txt` | The 44 open CodeQL alerts on main (F8) |
| `ci-logs/security-42607903721-codeql-gate.log` | The CodeQL result gate passing once the alerts were fixed (F8) |
| `ci-logs/shellcheck-before.txt` | ShellCheck findings before the fix (F10) |
| `ci-logs/checks-42611647973-closed-exception-issue.log` | `detect-changes` failing on 12 exceptions linked to closed #3785 (F12) |
| `ci-logs/freshness-closing-issue-guard-local.txt` | The new guard rejecting exceptions that link an issue the PR closes (F12) |
| `ci-logs/checks-42613833285-lint-retry-bypass.log` | Lint rejecting the gate's unretried `git ls-remote` (F10) |
| `ci-logs/checks-42615367731-test-suites.log` | Excerpt: two tests the main merge left inconsistent with this branch (F8, F9) |
| `sessions/`                                         | Solver session log and metadata                                                             |

Reproduction: `bash experiments/issue-4025/lychee-action-curl-no-retry.sh`.
