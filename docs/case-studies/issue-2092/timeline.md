# Timeline — issue #2092

All timestamps from the run logs quoted in the issue body and in
`raw/second-run.log`. Both runs used image `konard/hive-mind-dind:2.8.7`.

## Run 1 — execution `11d26f6f-b5c6-47ee-962e-8ae39af22163`

| Time (UTC)       | Event                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| 11:37:40.628     | `fix https://github.com/link-assistant/formal-ai --ci-cd --attach-logs --verbose …` starts in a detached DinD container |
| 11:37:41 (≈ +1s) | `dockerd is ready`, image preload complete                                                                          |
| —                | `/fix --ci-cd` resolves the target: default branch `main`, commit `bd0bac8`, 2 CI/CD runs (1 not passing)            |
| —                | `📝 Creating remediation issue...` → `src/fix.mjs:201`, immediately followed by `await import('./task.issue-creation.lib.mjs')` |
| —                | That module imports `./github.lib.mjs`, whose **module top level** runs `await use('command-stream')` (`src/github.lib.mjs:5`) |
| —                | ❌ `Failed to import module from '/home/box/.nvm/versions/node/v20.20.2/lib/node_modules/command-stream-v-latest/src/$.mjs'.` |
| 11:37:53.244     | Exit code 1, container kept for investigation                                                                       |

Elapsed: 12.6 s. The single `❌` line is the *entire* diagnostic output —
`src/fix.mjs:240` printed only `error.message`, so the `SyntaxError` in
`error.cause` never reached the log.

## Run 2 — execution `f9cc6a52-a237-4f70-a130-5bd7e540736a`

| Time (UTC)   | Event                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| 11:44:53.183 | Same command, new container `40ab794ec7dd`                                                               |
| ≈ 11:44:54   | `dockerd is ready after 1s`                                                                              |
| —            | Same `/fix` preamble, same `📝 Creating remediation issue...`                                            |
| —            | ❌ `Failed to install command-stream@latest globally into '/home/box/.nvm/versions/node/v20.20.2/lib/node_modules'.` |
| 11:45:08.473 | Exit code 1                                                                                              |

Elapsed: 15.3 s. Seven minutes after run 1, at the *same* call site, the same
package fails one stage earlier: use-m's `npm install -g` step itself
(`use.js:682`) instead of the `import()` of an already-installed tree
(`use.js:954`).

## Why the two runs differ — and why that matters

Run 1 found a **corrupt** install on disk (the file existed but was truncated,
so `import()` threw `SyntaxError: Unexpected end of input`). Run 2 found **no**
install and could not create one. Both are the same underlying condition —
`command-stream` is fetched from the npm registry at runtime, inside a
Docker-in-Docker container, on the critical path of the very first command —
observed at two different points of the install lifecycle.

Crucially, run 2 is what the naive fix ("retry the import") would have produced
anyway: delete the corrupt tree, reinstall, and the reinstall fails. Any fix has
to cover **both** stages, which is why `useWithRetry` grew a fourth failure mode
(`isTransientInstallError`) rather than only being wired up more widely.

## Lineage

| Issue                                                                | Failure mode                                        | What it added                                      |
| -------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------- |
| [#1710](https://github.com/link-assistant/hive-mind/issues/1710)     | truncated file → `SyntaxError`; incomplete tree      | `src/use-with-retry.lib.mjs` (modes 1 and 2)       |
| [#1712](https://github.com/link-assistant/hive-mind/issues/1712)     | corrupt `package.json` → `ERR_INVALID_PACKAGE_CONFIG` | mode 3                                             |
| **#2092**                                                            | same modes at ~40 unprotected call sites + failed `npm install -g` | wrapper at the bootstrap + mode 4 |

#1710 and #1712 built the right recovery and then wired it into exactly three
call sites (`config.lib.mjs`, `queue-config.lib.mjs`, `lino.lib.mjs`) — the ones
that happened to be failing at the time. `command-stream` was never one of them.
