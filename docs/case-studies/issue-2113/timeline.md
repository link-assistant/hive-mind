# Timeline

| Time (UTC)          | Event                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-28          | Issues #1710/#1712 establish recovery for truncated JavaScript, unresolved entry points, and invalid package configuration.                                                                       |
| 2026-04-29          | PR #1725 adds retrying pre-installation for CI races, but runtime loading remains use-m's responsibility.                                                                                         |
| 2026-07-20          | Issue #2092 shows recovery only covered a few call sites. PR #2093 wraps `use` at `ensureUseM()`, adds failed-install retry, whole-alias cleanup, cache-busted re-import, and opt-in diagnostics. |
| 2026-07-28 15:28:19 | Hive Mind 2.10.2 starts `fix --ci-cd` in Docker-in-Docker.                                                                                                                                        |
| 2026-07-28 15:28:34 | Creating a remediation issue loads `command-stream`; Node finds `src/$.mjs` but cannot find its relative import `src/terminal-capture.mjs`.                                                       |
| 2026-07-28 15:28:34 | use-m wraps `ERR_MODULE_NOT_FOUND`; Hive Mind's classifier rejects it as non-retryable and the command exits 1.                                                                                   |
| 2026-07-28          | Issue #2113 requests a codebase-wide stable import fix, preserved evidence, deep analysis, research, and upstream reporting.                                                                      |

The 15-second run and the presence of the package entry point rule out a simple
"package was never installed" interpretation. The on-disk alias was accepted
as installed but its internal file set was incomplete.
