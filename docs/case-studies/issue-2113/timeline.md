# Timeline

| Time (UTC)          | Event                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-28          | Issues #1710/#1712 establish recovery for truncated JavaScript, unresolved entry points, and invalid package configuration.                                                                       |
| 2026-04-29          | PR #1725 adds retrying pre-installation for CI races, but runtime loading remains use-m's responsibility.                                                                                         |
| 2026-07-20          | Issue #2092 shows recovery only covered a few call sites. PR #2093 wraps `use` at `ensureUseM()`, adds failed-install retry, whole-alias cleanup, cache-busted re-import, and opt-in diagnostics. |
| 2026-07-28 15:28:19 | Hive Mind 2.10.2 starts `fix --ci-cd` in Docker-in-Docker.                                                                                                                                        |
| 2026-07-28 15:28:34 | Creating a remediation issue loads `command-stream`; Node finds `src/$.mjs` but cannot find its relative import `src/terminal-capture.mjs`.                                                       |
| 2026-07-28 15:28:34 | use-m wraps `ERR_MODULE_NOT_FOUND`; Hive Mind's classifier rejects it as non-retryable and the command exits 1.                                                                                   |
| 2026-07-28 16:57:01 | A second 2.10.2 run starts the same command against the same repository.                                                                                                                          |
| 2026-07-28 16:57:26 | The alias now lacks a different packaged dependency, `src/$.trace.mjs`, and exits 1.                                                                                                              |
| 2026-07-28 17:05:52 | The new incomplete-tree signature, reproduction, workaround, and fix proposal are added to use-m #66.                                                                                             |
| 2026-07-28 19:26:30 | use-m PR #67 merges, closing #66 with install retry and corrupt-alias self-healing.                                                                                                               |
| 2026-07-28 19:28:19 | `use-m@8.14.3` is published to npm.                                                                                                                                                               |
| 2026-07-28 20:04:27 | The command is retried after the use-m update.                                                                                                                                                    |
| 2026-07-28 20:04:52 | use-m reaches self-healing but recursive alias removal loses an `ENOTEMPTY` race in `examples`; the command exits 1.                                                                              |
| 2026-07-28 20:37:11 | PR feedback supplies both additional logs and asks for command-stream ownership and pinning analysis.                                                                                             |
| 2026-07-28          | The package audit clears command-stream, real stress reproduction confirms the zero-retry cleanup gap, and use-m #68 reports it upstream.                                                         |
| 2026-07-30 06:38:13 | use-m #68 is closed after upstream adopts the suggested retry budget verbatim.                                                                                                                    |
| 2026-07-30 06:39:50 | `use-m@8.14.4` is published with `maxRetries: 5` and `retryDelay: 100` in `removePackageAlias()`.                                                                                                 |
| 2026-07-30          | A re-verification pass confirms the upstream fix, re-audits every analysis claim, and finds the CDN bootstrap fallback still pinned to 8.13.8 — the last release with no alias recovery at all.   |
| 2026-07-31 05:20:41 | A 2.10.2 image runs `fix --ci-cd --verbose` again; it fails with `Cannot find module '.../command-stream-v-latest/src/shell-parser.mjs'` — a third, different absent file.                        |
| 2026-07-31 18:05:31 | The same command on the latest image, 2.11.1, fails differently: use-m's own three install attempts all lose `ENOTEMPTY` on `.../command-stream-v-latest/examples` within nine seconds.           |
| 2026-07-31 18:06:29 | Container exits 1. Neither `--verbose` log contains a single line of loader diagnostics, so the failure has to be read out of a stack trace.                                                      |
| 2026-07-31          | Issue comment asks to redo the analysis for the actual root cause, and reports that splitting the same work into `/task --ci-cd` plus `/claude <issue>` never fails.                              |
| 2026-07-31          | The npm-only experiment reproduces the failure from concurrency alone (22/24 installs of one alias fail; 5/5 installs of different packages succeed), identifying the race as the root cause.     |
| 2026-07-31          | The end-to-end experiment confirms it through use-m (raw 24/24 failures) and that the single-flight guard removes it (guarded 0/24, 16× faster).                                                  |
| 2026-07-31          | Entry-point fan-out measurement explains the workaround: `fix` starts six simultaneous installs of one alias, `solve` starts one, and `/task --ci-cd` runs in the already-warm bot process.       |
| 2026-07-31          | The single-flight/per-alias-lock loader ships in Hive Mind and the concurrency defect is reported upstream as use-m #70.                                                                          |

The changing absent file across four runs, and the three identical `ENOTEMPTY`
failures inside nine seconds in the last one, rule out both a bad
`command-stream` release and a one-off disk fault. What is left is a competing
writer inside the same container — which the experiments then reproduce on
demand.
