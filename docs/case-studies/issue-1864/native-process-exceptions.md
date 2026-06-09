# Issue 1864 Native Process Exceptions

These files intentionally retain native `child_process` usage after the command-stream migration. The list is enforced by `tests/test-issue-1864-command-stream-audit.mjs`; new native process imports must either migrate to command-stream or add a documented exception here and in the test.

| File                                     | Reason                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `create-test-repo.mjs`                   | Keeps native sync git operations because local command-stream research documents git push silent-failure and quoting workarounds. |
| `cleanup-test-repos.mjs`                 | Uses interactive prompt reads plus `spawnSync` argv-array GitHub deletion loops.                                                  |
| `scripts/preinstall-use-m-packages.mjs`  | Preinstall script must resolve npm globals before `use-m` packages are available.                                                 |
| `scripts/detect-code-changes.mjs`        | CI helper uses synchronous git fetch/diff and process-exit workflow gating.                                                       |
| `scripts/validate-changeset.mjs`         | CI helper uses synchronous git fetch/diff and process-exit workflow gating.                                                       |
| `scripts/check-version.mjs`              | Release check uses synchronous git diff during package-script startup.                                                            |
| `scripts/upload-sourcemaps.mjs`          | Release helper streams installer and uploader output synchronously to inherited stdio.                                            |
| `scripts/free-disk-space.mjs`            | CI cleanup helper deliberately streams sudo/docker cleanup commands to inherited stdio.                                           |
| `scripts/run-tests.mjs`                  | Test runner must spawn isolated Node test processes with inherited stdio.                                                         |
| `src/hive-screens.lib.mjs`               | Screen attach and close flows require argv-array spawn, inherited TTY behavior, and lifecycle handling.                           |
| `src/telegram-command-execution.lib.mjs` | Deprecated `start-screen` execution still needs child lifecycle callbacks and captured pipes.                                     |
| `src/solve.auto-continue.lib.mjs`        | Auto-continue resume launches a detached child process with explicit stdio handling.                                              |
| `src/hive.mjs`                           | Worker launch and graceful shutdown require detached process groups and signal forwarding.                                        |
| `src/task.mjs`                           | Task command execution streams child stdout/stderr with lifecycle callbacks.                                                      |
| `src/version-info.lib.mjs`               | Version probes rely on native timeout semantics not currently exposed by command-stream.                                          |
| `src/interactive-mode.shared.lib.mjs`    | Requires argv-array execution with stdin, maxBuffer, and captured pipe behavior.                                                  |
| `src/cleanup.os.lib.mjs`                 | Offline cleanup uses synchronous `execFile` with argv arrays and timeouts by design.                                              |
| `src/task.issue-creation.lib.mjs`        | Issue creation path streams child output through lifecycle callbacks.                                                             |
| `src/cleanup.mjs`                        | Interactive cleanup prompt read uses synchronous shell stdin handling.                                                            |
| `src/models/index.mjs`                   | Codex model discovery uses `execFile` argv arrays and maxBuffer.                                                                  |

## Upstream Blocker Classes

- Native child object access, lifecycle callbacks, and `kill` behavior.
- Detached process groups and signal forwarding.
- Precise argv-array execution similar to `spawn` and `execFile`.
- Synchronous execution needed by install, release, and CI gate scripts.
- Timeout and signal options for short probe commands.
- Known command-stream quoting/output issues for git push, complex GitHub CLI bodies, and `gh pr create`.
