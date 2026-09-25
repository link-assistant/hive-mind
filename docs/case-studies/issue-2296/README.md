# Issue #2296: a 20-hour session lost to a single 401

## Executive summary

A 20-hour `--tool claude` session (solve v2.32.0, image
`konard/hive-mind-dind:2.32.0`, link-foundation/relative-meta-logic#184) died
on one `401 authentication_failed` ("OAuth session expired and could not be
refreshed"). After that, five separate defects turned one failed request into lost work:

| #   | Defect                                                                                                                                                                                                  | Fix                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B   | Docker isolation mounted `~/.claude/.credentials.json` as a **single file**. The container kept the old inode after the host rotated the token, and `.oauth_refresh.lock` was private to the container. | The whole config directory is shared. Plugins, skills, settings, etc. stay per-task through private overlays mounted on top of it. A startup self-check warns about a single-file credential mount. |
| A   | The 401 was classified as a plain `tool_failure`, so there was no retry.                                                                                                                                | Transient auth failures re-read the credentials, wait for a refresh and `--resume` the session (`--auth-retry-attempts`, default 2) for every tool.                                                 |
| C   | solve **exited 0** after `CLAUDE EXECUTION FAILED`, so start-command removed the container along with 4 uncommitted files.                                                                              | A tool failure WIP-commits and pushes the work, and the process exits 1. Any other exit with unsaved work also exits 1 and keeps the workspace.                                                     |
| D   | The failure comment linked only the folder holding a 2-part log.                                                                                                                                        | Every part is linked, and the part containing the failure is named.                                                                                                                                 |
| E   | A `{"subtype":"success","is_error":true}` result was logged as "(subtype: success)" and its cost was "captured from success result".                                                                    | Such a result counts as an error everywhere.                                                                                                                                                        |

## Timeline (UTC)

| Time                | Event                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-09-24 20:40:49 | The task container starts with `~/.claude/.credentials.json` bind-mounted as a single file (#2190 layout).           |
| 2026-09-25 17:01:54 | Another Claude Code process refreshes the shared login. The host file is replaced atomically (temp file + `rename`). |
| 17:02:18            | Inside the container: `401 ... not retryable`. The container still reads the old inode.                              |
| 17:02:22            | `git status` shows 2 modified and 2 untracked files.                                                                 |
| 17:02:23            | `Stopping auto-restart — tool execution failed` (no retry).                                                          |
| 17:05:31            | `Keeping directory …`, then `solve exit 0`.                                                                          |
| 17:05:48            | start-command: `Container removed … (exit 0)`. The "kept" directory and the uncommitted work are gone.               |
| 17:46+              | New containers (fresh mount of the rotated file) work with the refreshed token.                                      |

## Root cause (B): single-file credential mounts

Claude Code is built to let several processes share one login, but only when
they share the **config directory**:

- the refresh is serialised by `join(configDir, ".oauth_refresh.lock")`;
- credentials are written atomically (temp file + `rename` onto
  `.credentials.json`);
- other processes notice a refresh from the file's `mtimeMs`.

A single-file bind mount breaks all three. The mount pins the inode it was
created with, so after the first rename on the host the container reads the
old token forever. A rename by the container onto the mount target fails
(`EBUSY`). The lock file is created in the container's private `~/.claude`.
Each side then refreshes with its own copy of the single-use refresh token, and
the losing lineage fails with "could not be refreshed".

The real-Docker experiment
[`experiments/issue-2296/probe-credential-mounts.mjs`](../../../experiments/issue-2296/probe-credential-mounts.mjs)
reproduces this. `tests/test-issue-2296-shared-credential-dir.mjs` covers
the new layout (`src/isolation-tool-mounts.lib.mjs`).

## Why exit 0 cost the work (C): start-command's cleanup policy

start-command (0.34.0, `src/lib/docker-cleanup.js`) decides whether to remove a
finished container **only from its exit code** (and Docker's `OOMKilled`):

```js
function shouldCleanupDockerContainer(policy, exitCode, oomKilled = false) {
  if (policy === DOCKER_CONTAINER_CLEANUP_POLICY.ALWAYS) return true;
  if (policy === DOCKER_CONTAINER_CLEANUP_POLICY.DEFAULT) return !isAbnormalDockerExit(exitCode, oomKilled);
  if (policy === DOCKER_CONTAINER_CLEANUP_POLICY.KEEP_ON_FAIL) return !isAbnormalDockerExit(exitCode, oomKilled);
  return false; // KEEP
}
```

| `keepContainer` | `keepContainerOnFail` | `alwaysCleanupContainer` | exit 0 (no OOM) | exit ≠ 0 or OOM |
| --------------- | --------------------- | ------------------------ | --------------- | --------------- |
| false           | false                 | false (default policy)   | **removed**     | kept            |
| false           | true                  | —                        | **removed**     | kept            |
| true            | —                     | —                        | kept            | kept            |
| false           | false                 | true                     | removed         | removed         |

Under the default configuration (`keepContainer false`, `keepContainerOnFail false`),
the meta-language#196 container (exit 1) was kept and this one (exit 0) was removed.
start-command cannot see the workspace inside the container, so the exit code
is the contract. Before this fix, solve reported a successful exit while
holding unsaved work.

The fix makes the exit code tell the truth:

- **A loop that stops because the AI tool failed** (auto-restart-until-mergeable,
  both `tool_failure` stops; watch mode, the API-error stop) calls
  `failOnToolFailure` (`src/tool-failure-exit.lib.mjs`). It commits and pushes
  the uncommitted work as a WIP commit and records the failure.
  `finalizeSolveProcess` then exits 1. This is the same pattern as the #2119
  auto-restart budget and the #2247 no-progress stop. The "Automation stopped"
  comment says whether the WIP commit was pushed.
- **The first-run tool failure path** already committed the work
  (`commitUncommittedChangesOnCriticalError`) and exited 1. The
  **authentication-error exit** (`handleMainExecutionError`) now does the same
  before exiting 1.
- **Last safety net:** before cleaning up, `finalizeSolveProcess` checks the
  workspace (`git status --porcelain`, `git rev-list --count HEAD --not --remotes`).
  If anything exists only there, the directory is not deleted and the process
  exits 1, so a container holding it is kept. A paused (limit-reached) run is
  exempt because its directory is kept for resume anyway.

Tests: `tests/test-issue-2296-tool-failure-exit.mjs` runs the finalize exit
codes against a real git repository with a bare remote.

## Retry on transient auth failures (A)

`src/auth-transient-retry.lib.mjs` wraps every tool iteration
(`executeToolIteration`) and the first run:

1. It classifies 401 / `authentication_failed` / "OAuth session expired" /
   "could not be refreshed" / a thrown `isAuthError` as transient.
2. It re-reads the tool's credential file and waits, with backoff, for a refresh
   by another process or a non-expired token. The wait is at most 10 minutes and
   can be changed with `HIVE_MIND_AUTH_RETRY_MAX_WAIT_MS`.
3. It resumes the same session with `--resume <session-id>`.
4. It gives up after `--auth-retry-attempts` resumes (default 2, `0` disables).
   The "Automation stopped" comment then says what was attempted
   (`auth_failure_after_retry`) instead of "restarting would fail the same way".

Tests: `tests/test-issue-2296-auth-retry.mjs` (a mocked 401 followed by success).

## Log parts (D)

gh-upload-log splits a log larger than 100 MiB with `split -b 100m` into
`<name>.part-NN.log.txt`. `src/log-upload-parts.lib.mjs` lists the parts
through the contents API and finds the last occurrence of the failure message
in the uploaded file with a bounded backward scan. Part N holds bytes
`[N·100 MiB, (N+1)·100 MiB)`, so that byte offset gives the part. The comment
gets:

```
- [Part 1 of 2: `sanitized.part-00.log.txt`](…)
- [Part 2 of 2: `sanitized.part-01.log.txt`](…) — ⚠️ **contains the failure**
```

Tests: `tests/test-issue-2296-log-parts.mjs`.

## Error results labelled as success (E)

`isSuccessfulClaudeResult` (`src/claude.stream-events.lib.mjs`) requires
`is_error !== true`. The log line now reads
`Detected error from Claude CLI (error result, is_error: true, subtype: success, …)`.
The cost of such a result is kept only as a fallback.

Tests: `tests/test-issue-2296-is-error-result.mjs`.
