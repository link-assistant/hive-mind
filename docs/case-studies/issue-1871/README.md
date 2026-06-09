# Issue 1871 Case Study: `/stop <url>` Could Not Stop Immediately-Started Sessions

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1871

Pull request: https://github.com/link-assistant/hive-mind/pull/1872

The Telegram `/stop` command must support stopping a task by **issue URL**, **pull-request URL**, and **start-command session UUID**. The UUID flow (#524) and the queue-based URL flow (#1780/#1783) already existed, but `/stop <issue-or-pr-url>` reported **"No queued or running task found"** for tasks that had started executing immediately.

The screenshots in the issue show a `/codex <url> --max --auto-merge --tool codex` run that printed a session card with `Session: 40c5acd9-f9b4-4675-9812-2dffd99b2716` and `Isolation: screen`. A later `/stop` (replying to the issue URL) answered that no task was found, forcing the user to manually copy the UUID and run `/stop <UUID>`.

The root cause is that an immediately-started task never lives in the solve queue's `processing` Map — it is dispatched straight to a detached isolation session and only the **session-monitor** registry knows its `URL → UUID` mapping. The `/stop <url>` flow consulted only the queue, so it missed running sessions.

The fix makes `/stop <url>` also consult the session-monitor registry. When the queue has no record but a running isolation session for the URL is tracked, `/stop` recovers the start-command UUID and forwards CTRL+C via `$ --stop <uuid>` — exactly what the user previously had to do by hand.

## Evidence Collected

- `raw/issue-1871.json`: GitHub issue body and metadata (0 comments at collection time).
- `raw/issue-comments.json`: issue comments endpoint (empty).
- `raw/pr-1872.json`: the draft PR created for this fix.
- `raw/screenshot-1-stop-not-found.png`: `/stop` replying "No queued or running task found … try `/stop <UUID>`".
- `raw/screenshot-2-codex-session.png`: the original `/codex` session card showing `Session: 40c5acd9-…`, `Isolation: screen`, `Requested by: @drakonard`.

## Timeline

- (earlier) A `/codex https://github.com/link-foundation/python-ai-driven-development-pipeline-template/issues/18 --max --auto-merge --tool codex` is dispatched. The queue is empty, so the bot starts it **immediately** and posts a session card: `Session: 40c5acd9-f9b4-4675-9812-2dffd99b2716`, `Isolation: screen`.
- (later) The user runs `/stop` (replying to a message containing the issue URL). The bot extracts the URL, looks it up in the solve queue only, finds nothing, and replies `ℹ️ No queued or running task found for … try /stop <UUID>`.
- 2026-06-09 11:28:49 UTC: issue #1871 is opened (author: konard) requesting full `/stop` support by issue id, PR id, and session UUID.
- 2026-06-09: PR #1872 implements the session-monitor fallback for `/stop <url>` and adds regression coverage.

## Requirements From The Issue

1. Fully support stopping a task by **issue id (URL)**.
2. Fully support stopping a task by **pull-request id (URL)**.
3. Fully support stopping a task by **start-command session UUID**.
4. Compile all related logs/data into `docs/case-studies/issue-1871`.
5. Perform a deep case-study analysis: reconstruct the timeline, list every requirement, find the root cause of each problem, and propose solutions.
6. Search online/source material for additional facts.
7. Add debug/verbose output if data is insufficient to find the root cause.
8. Report related upstream issues (with reproducible examples, workarounds, and suggested fixes) if another project is involved.
9. Apply the fix to the entire codebase — every place that has the problem.
10. Plan and execute everything in a single pull request.

## Root Cause

### How `/stop <url>` worked before

`registerStartStopCommands` (in `src/telegram-start-stop-command.lib.mjs`) resolved a `/stop <url>` request **only** through the in-memory solve queue:

```js
const item = queue?.findByUrl?.(url); // queues + processing Map
```

`SolveQueue.findByUrl` checks the per-tool queues and the `processing` Map. A task is in `processing` **only while the queue consumer is launching it**. Two code paths bypass or quickly leave that Map:

1. **Immediate start (the reported case).** In `src/telegram-bot.mjs`, when `check.canStart && toolQueuedCount === 0`, the handler calls `executeAndUpdateMessage(...)` directly — the task is **never enqueued** and never enters `processing`.
2. **Queued start.** `SolveQueue.executeItem(...)` deletes the item from `processing` in its `finally` block as soon as the task is **dispatched** to a detached isolation/screen session. The long-running work then continues in the detached session.

In both cases, by the time the user runs `/stop <url>`, `findByUrl` returns `null` → the dispatcher reports `not-found`.

### Where the task actually lives

Detached sessions are tracked by the **session monitor** (`src/session-monitor.lib.mjs`) in its in-memory `activeSessions` Map, keyed by session name (the start-command UUID for isolation sessions). Each record stores `url`, `isolationBackend`, `sessionId`, `tool`, and `requesterUserId`. This is the authoritative registry of what is _running_, and it already powers `hasActiveSessionForUrlAsync`, `getRunningSessionItems`, and `/queue`. The `/stop <url>` flow simply never consulted it.

### Secondary bug: URL normalization order

`normalizeSessionUrl` stripped the trailing slash **before** the fragment, so `.../issues/18/#comment` normalized to `.../issues/18/` (with a dangling slash) and failed to match the bare `.../issues/18`. The fix strips the fragment first, then trailing slashes.

## The Fix

1. **`src/session-monitor.lib.mjs`** — new `findStoppableSessionByUrl(url, verbose)`:
   - Scans `activeSessions` for a still-running session whose `url` matches (using the corrected `normalizeSessionUrl`).
   - Returns `{ sessionName, sessionId, sessionInfo, isolationBackend, stoppable }`.
   - `stoppable` is true only for isolation-backed sessions whose start-command id is UUID-shaped (the value `$ --stop <uuid>` expects). Plain non-isolation screen sessions are reported as `stoppable: false`.
   - Fixed `normalizeSessionUrl` ordering (fragment before trailing slash).

2. **`src/telegram-start-stop-command.lib.mjs`** — the `/stop <url>` dispatcher now:
   - Looks up both the queue candidate **and** the running session (`lookupRunningSessionByUrl`, injectable for tests via `options.findRunningSessionByUrl`).
   - Authorizes with the session's `requesterUserId`, so the original task requester can stop their own immediately-started task in a group (consistent with #1783).
   - When the queue has no record but a stoppable session is tracked, forwards CTRL+C to its UUID — the previous manual `/stop <UUID>` step is now automatic.
   - Distinguishes "running but non-isolation (can't CTRL+C)" from "genuinely not found" in its replies.

3. **`src/telegram-bot.mjs`** — wires the real `findStoppableSessionByUrl` into `registerStartStopCommands`.

### Why this covers the whole codebase

All Telegram task launches — `/solve`, `/hive`, `/codex`, and the per-tool aliases — go through `trackSession`, so they all populate the same `activeSessions` registry regardless of whether they started immediately or via the queue. A single fix in the shared `/stop <url>` dispatcher therefore covers every launch path. The UUID flow (#524) was already complete and is unchanged.

## Existing Components Reused

- **`$ --stop <uuid>`** from [link-foundation/start](https://github.com/link-foundation/start) (`start-command` npm, v0.28.0) — the CTRL+C forwarding mechanism, already used by the UUID flow. No upstream change is required; the underlying stop primitive works correctly.
- **session-monitor `activeSessions`** registry — the authoritative URL→UUID map that already backs `/queue` and duplicate-session prevention.
- **`isStopTargetRequester` / `authorizeTargetedStop`** (#1783) — reused unchanged for requester-based authorization.

## Upstream Issues

None. This is a Hive Mind orchestration bug (the `/stop` URL lookup ignored the session-monitor registry). The `start-command` `$ --stop` primitive behaves correctly, so no issue was filed against link-foundation/start.

## Verification

- New regression test: `tests/test-issue-1871-stop-running-session-by-url.mjs` (20 assertions) — covers `findStoppableSessionByUrl` (isolation/non-isolation/missing/normalization) and the dispatcher (immediate-start stop, queue precedence, requester-in-group authorization, stranger rejection, non-isolation explanation, not-found, no-queue-but-tracked).
- Existing suites remain green: `test-issue-1780-stop-by-url.mjs` (29), `test-issue-1783-stop-improvements.mjs` (40), `test-issue-524-stop-uuid.mjs` (25), `test-telegram-stop-helpers.mjs`, `test-session-monitor-isolation.mjs` (8), `test-issue-1680-session-monitoring.mjs` (14).
  </content>
