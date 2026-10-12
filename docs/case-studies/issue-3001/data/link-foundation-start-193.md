## Problem

`$ --resume <uuid> -- <command>` (docker-snapshot mode, start-command 0.35.4) **started the new container and then failed to save the execution record**. The container keeps running, but start-command no longer knows about it:

```
$ --resume deb9c2e9-8234-43ef-9648-e102f5d34ebd --output-format json -- solve https://github.com/link-assistant/router/issues/728 … --resume 01a1200a-…
error: Failed to acquire lock for database write
      at save (start-command/src/lib/execution-store.js:536:17)
      at resumeExecution (start-command/src/lib/execution-resume.js:493:9)
      at handleResumeQuery (start-command/src/lib/query-commands.js:60:11)
```

Afterwards:

- `docker ps`: `eec34a2b-…-resume-1-resume-2  Up 22 minutes` (the task is working fine).
- `$ --list`: the execution still says `"sessionName": "eec34a2b-…-resume-1", "status": "executed", "exitCode": 127, "resumeCount": 1`, the previous failed attempt.
- No completion watcher was attached, so the container's exit will never be written to the execution log, and `$ --status` / `--list` report the old attempt.

It happened to two of two resumes started at the same time (router#724 and router#728) while other `$` processes (another `$ --resume` blocked in a 10-minute `docker commit`, and the hive-mind bot polling `$ --list`/`--status`) were using the store.

Consequence: anything that relies on the record to decide whether a task is running treats it as dead. An automatic recovery script re-resumed both running tasks and had to be stopped before it launched duplicate solvers.

## Root cause

- [`resumeExecution`](https://github.com/link-foundation/start/blob/d7e83641815cc7e8e26757f77a6f61f22924c1a7/js/src/lib/execution-resume.js#L468-L494) runs the plan's steps (`docker commit`, `docker run`) first and only then calls `store.save(updated)` (L493). A save failure throws after the container is already running.
- [`LockManager.acquire`](https://github.com/link-foundation/start/blob/d7e83641815cc7e8e26757f77a6f61f22924c1a7/js/src/lib/execution-store.js#L227) gives up after `LOCK_TIMEOUT_MS = 30000` ([L54](https://github.com/link-foundation/start/blob/d7e83641815cc7e8e26757f77a6f61f22924c1a7/js/src/lib/execution-store.js#L54)). A store lock can be held for that long while another process is busy.

## Suggested fix

1. Write the "attempt N launching, session `<new name>`" record **before** `docker run` and only finalize it afterwards, so a crash or lock failure still leaves the record pointing at the new container.
2. Retry the save with backoff (well beyond 30 s) after a launch. If it still fails, stop/remove the just-started container, or print a machine-readable error naming it so the caller can recover. Today the error hides that the launch succeeded.
3. Never hold the store lock during long operations (`docker commit`/`run`). Check every writer for that.
4. `$ --status` / `--list` could reconcile `<sessionName>-resume-*` containers that exist in Docker but not in the record.

## Workaround

Detect running containers by name family (`<original>` / `<original>-resume-…`) instead of trusting the record.

---

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.

---

## Root cause found: a 0-byte `executions.lock` left by ENOSPC is never treated as stale, so every write fails forever

All four `$ --resume` runs on this host failed the same way, and so did every other write since 14:32 UTC. The cause is not contention.

```
$ ls -la ~/.start-command/          # inside the hive-mind root container, 16:25 UTC
-rw-r--r-- 1 box box 248912 Oct  9 14:27 executions.lino     ← last successful write
-rw-r--r-- 1 box box      0 Oct  9 14:32 executions.lock     ← empty, never removed
```

The disk was full at 14:32 UTC (concurrent `docker commit` snapshots, link-assistant/hive-mind#2889). The kernel logged `No space left on device` in that window.

`js/src/lib/execution-store.js` → `LockManager`:

1. `acquire()` creates the lock with `fs.writeFileSync(lockFilePath, JSON.stringify(lockData), { flag: 'wx' })`. On ENOSPC the file is **created** but its content is not written. The error is not `EEXIST`, so it is rethrown with `lockAcquired = false`, and `release()` does not unlink the file.
2. From then on, every `acquire()` sees the file and calls `readLockFile()`. `JSON.parse('')` throws, so it returns `null`.
3. `if (lockData && this.isLockStale(lockData))` → `lockData` is `null`, so the stale check (which would return `true` for `!lockData`) is **never called**, and the file is never removed.
4. `writeFileSync(..., {flag:'wx'})` → `EEXIST` → retry for `LOCK_TIMEOUT_MS` (30 s) → `Failed to acquire lock for database write`.

The same happens if the process is killed between creating and writing the file, or if the content is truncated.

Consequences seen here: `$ --resume` launched the container, then `store.save(updated)` threw. The record stayed `executed 137/127`, and **no completion watcher was started**, so the task's end will not be recorded either. `$ --status` reports these running tasks as finished. hive-mind's `/limits` and queue throttling rely on that (link-assistant/hive-mind issue to follow), and so does any `$ --list`-based recovery.

### Suggested fix

- In `acquire()`, treat an unreadable or empty lock as stale once it is older than a short grace period (for example, file `mtime` older than 2–5 s). Replace `if (lockData && this.isLockStale(lockData))` with `if (this.isLockStale(lockData, stat))`, and use `mtime` when there is no timestamp.
- Create the lock atomically with its content: write `executions.lock.<pid>.<rand>` first, then `fs.linkSync(tmp, lockFilePath)` (fails with `EEXIST` like `wx`) and unlink the temp file. A lock file then either has full content or does not exist. On any error after creation, unlink what was created.
- `$ --resume`: if saving the record fails after the container started, still start the completion watcher, retry the save, and print an explicit "running but untracked" warning with the container name (this issue's original report).
- Tests: an empty lock file, a truncated JSON lock, and an ENOSPC on write (inject `fs`) must not block later writers beyond the grace period.

Workaround: remove the empty `~/.start-command/executions.lock` (it is never a live lock once it is older than a few seconds).
