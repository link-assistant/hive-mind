# Case Study: Issue #1532 — `--interactive-mode` completely broken

## Summary

`--interactive-mode` stopped working entirely after commit `4b0beaf2` (March 21, 2026),
which replaced `command-stream`'s `$` template literal with `promisify(execFile)` for
GitHub API calls. The `input` option passed to `execFileAsync` was silently ignored,
causing `gh api --input -` to hang forever waiting for stdin data that never arrived.

## Timeline

| Date | Event |
|------|-------|
| 2025-12-03 | Interactive mode skeleton added (commit `8c92cd95`) |
| 2025-12-04 | Wire-up to claude.lib.mjs completed (commit `89568ece`) |
| 2026-03-21 | **BREAKING**: `execFileAsync` + `input` introduced (commit `4b0beaf2`, issue #1458) |
| 2026-03-28 | Activity timeout + diagnostics added (commit `3a1feea1`, issue #1472) |
| 2026-03-30 | Activity timeout increased to 1hr (commit `83ad9520`, issue #1510) |
| 2026-04-06 | Bug reported (issue #1532) |

## Root Cause

### The Bug: `promisify(execFile)` silently ignores the `input` option

In Node.js, only the **synchronous** variants of child process functions support
the `input` option:

- `execFileSync(cmd, args, { input })` — **works**
- `execSync(cmd, { input })` — **works**
- `spawnSync(cmd, args, { input })` — **works**
- `execFile(cmd, args, { input }, callback)` — **silently ignored**
- `promisify(execFile)(cmd, args, { input })` — **silently ignored**

When `input` is silently ignored, the child process's stdin pipe remains open but
no data is written. If the child reads from stdin (as `gh api --input -` does),
it blocks forever.

### The Deadlock Chain

1. Claude CLI outputs `system.init` NDJSON event
2. Stream loop reads it, calls `await interactiveHandler.processEvent(data)`
3. `processEvent` → `handleSystemInit` → `postComment` → `execFileAsync('gh', ['api', ..., '--input', '-'], { input: jsonPayload })`
4. `gh api --input -` waits for stdin data that never arrives (because `input` is ignored)
5. The `await` blocks the stream processing loop — no more events are read
6. Activity timeout fires after 1 hour, kills Claude CLI
7. But `gh api` process is a separate process tree — it survives
8. The Node.js event loop stays alive waiting for `gh api` to finish
9. User must CTRL+C to kill everything

### Evidence from the Log

```
[07:13:29.012Z] First event received (type: system) — stream is active
[08:13:29.112Z] No stream output for 3600s — force-killing
[12:56:33.499Z] Failed to post comment: Command failed: gh api ... (HTTP 400)
```

- Only ONE event was ever received (system.init)
- The `gh api` command ran from 07:13:29 to 12:56:33 (nearly 6 hours) before being killed by CTRL+C
- Claude CLI received a successful API response (status 200) at 07:13:30, but our code never read the next NDJSON events

### Proof of Concept

```javascript
// This HANGS — input is silently ignored
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
await execFileAsync('cat', [], { input: 'hello' }); // hangs forever

// This WORKS — sync version supports input
const { execFileSync } = require('child_process');
execFileSync('cat', [], { input: 'hello' }); // returns 'hello'
```

## Fix

Replaced `promisify(execFile)` with a custom `execFileAsync` function that uses
`spawn` from `child_process` and properly writes to the child's stdin pipe before
closing it.

Key differences:
- Uses `spawn()` which gives access to `child.stdin` for writing
- Writes `input` data to `child.stdin` and calls `child.stdin.end()`
- Collects stdout/stderr into buffers
- Resolves/rejects Promise based on exit code

## Files Changed

- `src/interactive-mode.lib.mjs` — Replaced `promisify(execFile)` with spawn-based `execFileAsync`
- `tests/test-interactive-mode.mjs` — Added 5 tests for stdin piping functionality

## Lessons Learned

1. **Node.js `child_process` API inconsistencies**: The `input` option is only
   supported by sync functions, but the async functions silently ignore it
   instead of throwing an error. This is a known Node.js footgun.

2. **Silent failures are the worst failures**: Because `gh api` hangs silently,
   there's no error message until the process is forcibly killed. Adding timeouts
   to the `gh api` calls would help detect this class of failure faster.

3. **Blocking `await` inside stream loops**: Even with the stdin fix, `await`-ing
   network I/O inside a stream processing loop can cause back-pressure issues.
   Future improvement: consider making `processEvent` fire-and-forget (non-blocking).
