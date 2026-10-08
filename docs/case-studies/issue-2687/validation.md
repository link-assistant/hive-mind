# Validation record

The implementation and original incident evidence were pushed at commit `6ad714ae181bc2b11720722f46b0351731f18880`. Local validation used Node.js 26.11.0; CI used Node.js 24 for repository checks and verified Node.js 26.11.1 inside the built task images.

## Local checks

| Check                                        | Result                                      | Evidence                                                                                                          |
| -------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Command-wrapper regression                   | 18 tests passed; zero failures              | [Final replay](data/regression-after.log)                                                                         |
| Full default suite                           | All 576 selected test files passed          | [Complete successful run](data/local-default-after.log)                                                           |
| Failed final verification and draft recovery | Passed                                      | [Issue #2263](data/local-2263.log)                                                                                |
| Background-turn tracking and continuation    | Passed                                      | [Turn tests](data/local-2301-turn.log), [execution tests](data/local-2301-execution.log)                          |
| Account limits versus temporary throttling   | 15 checks passed                            | [Issue #1935](data/local-1935.log)                                                                                |
| Runtime pins and single-version roots        | Passed, including 52 runtime-version checks | [Pins](data/local-runtime-pins.log), [versions](data/local-runtime-versions.log)                                  |
| ESLint and Prettier                          | Passed                                      | [Lint](data/local-lint.log), [format](data/local-format.log)                                                      |
| Duplication                                  | 11.13%, below the 12% threshold             | [Duplication output](data/local-duplication.log)                                                                  |
| Secret scan, syntax, and source line limits  | Passed                                      | [Secrets](data/local-secret-scan.log), [syntax](data/local-syntax.log), [line limits](data/local-line-limits.log) |
| Documentation and language synchronization   | Passed                                      | [Documentation](data/local-docs-validation.log), [languages](data/local-docs-language-sync.log)                   |
| Package-manager and Changeset checks         | Passed; one patch Changeset                 | [Package manager](data/local-package-manager.log), [Changeset](data/local-changeset.log)                          |
| Authenticated dependency freshness           | 168/168 declarations current                | [Freshness output](data/local-freshness.log)                                                                      |

The first full local run stopped at an assertion still expecting Node.js 26.11.0 after the Docker pins had been advanced to the newly released 26.11.1. The [failed run](data/local-default-before.log) preserves that error. Both runtime-pin test fixtures were updated together, their focused checks passed, and the complete 576-file suite was rerun successfully.

Self-review also caught installation guidance being hidden when a native exit 127 was marked as a generic command failure first. The [17-pass/1-failure replay](data/guidance-before.log) reproduces that implementation regression. Moving the existing missing-executable check before the generic native-exit classification preserves the guidance; the final replay passes all 18 tests.

The new local validation exports were processed with the repository's existing `sanitizeLogFileToFile` publication boundary, in 256 KiB blocks and a process with a 256 MB Node heap cap. [Archive statistics](data/validation-archive.jsonl) record source sizes, bytes read, and output counts. Original incident exports retain their original sanitized bytes and separate checksums.

## Remote checks

The first fresh runs were created on 2026-10-08 at 02:22:22 UTC and match the implementation head above:

- [Security run 37717539904](https://github.com/link-assistant/hive-mind/actions/runs/37717539904): passed.
- [Broken Link Checker run 37717539905](https://github.com/link-assistant/hive-mind/actions/runs/37717539905): passed.
- [Checks and release run 37717540140](https://github.com/link-assistant/hive-mind/actions/runs/37717540140): default and GitHub integration suites, lint, compilation, documentation, memory, release-preflight, version, and Changeset checks passed on the first attempt.

Both Docker images built successfully. Both running images reported `file-5.48` and passed the Node.js 26.11.1 verification. The standard image completed all container checks. DinD then failed after the Playwright package fallback passed: the Docker client running verification was reported as `Killed`, and the step exited 137. In the downloaded first-attempt log, these are lines 52955–52956 at 02:39:59–02:40:04 UTC. The script's next operation was its live `claude mcp list` probe, which had not reported completion.

The [complete first-attempt log](data/ci-37717540140-attempt-1.log) and [job metadata](data/ci-37717540140-attempt-1.json) are preserved. Exit 137 and the `Killed` diagnostic establish termination but do not identify the kernel victim, memory allocation, or initiating signal source. No OOM inspection/kernel trace was included, so this is not evidence that the attachment prerequisite or provider-error fix failed. The failed jobs were rerun on the same SHA after preserving the original evidence; the outcome is recorded in the final PR validation.
