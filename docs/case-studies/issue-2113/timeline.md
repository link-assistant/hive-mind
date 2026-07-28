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

The first two runs and changing absent file rule out a simple "package was never
installed" or deterministic bad-release interpretation. The final run confirms
the upstream repair was selected but could not finish its transient filesystem
cleanup.
