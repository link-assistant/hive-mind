# Issue 1780 Case Study: `/stop` should work both by issue/PR URLs and UUID

## Summary

Issue [#1780](https://github.com/link-assistant/hive-mind/issues/1780) asks
that the Telegram `/stop` command be able to identify the target task by
either:

1. an **issue / pull-request URL** found anywhere in the `/stop` message
   itself (`/stop https://github.com/owner/repo/issues/123`) **or**
2. an **issue / pull-request URL** found in the message that `/stop` is
   replying to (the bot's own `🛠 /codex …` echo or its `⏳ Waiting (codex
queue #2)` queue card both contain the issue URL), **or**
3. a **UUID** for tasks launched with `--isolation screen` (already supported
   for argument and reply since #524).

For URL/UUID modes the bot must:

- **Remove the task from the appropriate queue** when it has not yet started,
  and
- **Forward `CTRL+C` via `$ --stop <UUID>`** when the task is already
  executing in an isolated session (this part already worked for UUIDs, but
  was unreachable when the user only had the issue URL handy).

The user's expected ergonomics (from the screenshots in the issue):

> `/stop` as a reply to the `⏳ Waiting (codex queue #2)` card with
> `Issue: https://github.com/konard/vk-bot-desktop/issues/28` should remove
> the queued item.

Before this PR, replying with `/stop` to a queue card without manually
copy-pasting a UUID did nothing useful: the chat-pause flow rejects replies
on purpose (#1081), and the UUID mode had no UUID to find in the queue card
text. The user had to scroll back to the bot's own session-id message and
copy it by hand, which was the friction the issue calls out.

## Artifacts

- Issue data: [`raw/issue-1780.json`](raw/issue-1780.json)
- Issue screenshots:
  [`images/queue-screenshot.png`](images/queue-screenshot.png) — the
  `⏳ Waiting (codex queue #2)` card the user wants to reply to with
  `/stop`. Contains the issue URL.
  [`images/desired-usage.png`](images/desired-usage.png) — the user's
  intended invocation (a bare `/stop` reply to the queue card).
- Research source list:
  [`research-sources.json`](research-sources.json)

## Timeline

- **2026-04-26** — PR #1687 ships `/log <UUID>` and the
  `extractSessionIdFromText` helper that finds RFC-4122 v4 UUIDs anywhere in a
  message or its replied-to message.
- **2026-05-02** — PR for #524 ships `/stop <UUID>` reusing the same UUID
  helper. The dispatcher in `registerStartStopCommands` extracts a UUID from
  the `/stop` text or reply, then forwards `CTRL+C` to the matching session
  via `$ --stop <UUID>` (link-foundation/start#112). Bare `/stop` continues to
  pause the chat (#1081).
- **2026-05-XX** — User runs
  `/codex https://github.com/konard/vk-bot-desktop/issues/28 --think max
--auto-merge` while two Codex processes are already running. The bot
  enqueues the request and posts:
  > ⏳ Waiting (codex queue #2)
  > Issue: https://github.com/konard/vk-bot-desktop/issues/28
  > Reason: Codex weekly limit is 100% (waiting for current command), Codex
  > process is already running (1 processes)
- User replies `/stop` to that queue card hoping to cancel the queued item.
  Nothing happens because:
  1. the queue card's text contains the **issue URL**, not the session UUID
     (no UUID exists yet — the task has never been started), and
  2. `extractStopSessionId` only knows how to extract UUIDs.
- User opens issue #1780 with two screenshots and the expected ergonomics
  ("/stop as reply to a queue card should work using the URL").
- **This PR** — adds URL extraction to `/stop`, looks the URL up in the
  in-memory solve queue, cancels the queued item (or stops the running
  isolated session for `--isolation screen` runs), and documents the case
  study.

## Requirements (from issue #1780)

- **R1.** `/stop <issue-or-pr-url>` must look up the target task by URL and
  remove it from the queue or stop it if it is already running.
- **R2.** Replying with `/stop` to a message that contains an issue or PR URL
  (the bot's own queue card or the user's original `/codex …` command) must
  do the same — extract the URL from the replied-to message.
- **R3.** UUID mode must keep working for tasks started with
  `--isolation screen` (argument or reply). This was already shipped in #524;
  this PR must not regress it.
- **R4.** When the matched task is **queued** (not yet started), simply remove
  it from the queue and acknowledge.
- **R5.** When the matched task is **running** and was started with
  `--isolation screen` (or any isolation backend), forward `CTRL+C` via
  `$ --stop <UUID>` (the existing R3 path).
- **R6.** Compile data, screenshots and analysis into
  `docs/case-studies/issue-1780/`.
- **R7.** Reconstruct the timeline of events.
- **R8.** Find the root cause of each problem and propose a solution
  (including a check for known/existing components).
- **R9.** If diagnostics are insufficient to confirm the root cause, add
  debug output / verbose mode so the next iteration can find it.
- **R10.** If another repository is involved, file an issue there with
  reproducible examples, workarounds, and code-level suggestions.
- **R11.** Plan and execute everything in a single pull request (#1781).

## Reproducible example

The issue ships two minimum reproducers:

1. **Queue card reply.** Enqueue a task while a queue throttle is active so it
   stays in the `WAITING` state, then reply `/stop` to the
   `⏳ Waiting (codex queue #2)` card. Before this PR: nothing happens. After
   this PR: the queue item is cancelled and the bot acknowledges with
   `🗑 Removed queued task for <url> from <tool> queue.`
2. **Direct URL.** `/stop https://github.com/owner/repo/issues/123` should
   also cancel a matching queued item.

The unit-test layer reproduces both cases without a real Telegram bot. See
`tests/test-issue-1780-stop-by-url.mjs` (added in this PR), which:

- Constructs a minimal stub bot that records `bot.command('stop', …)`.
- Exercises `extractStopTarget()` for argument-mode URL, reply-mode URL,
  argument UUID still wins, mixed text, etc.
- Drives the `/stop` dispatcher with a stub `solveQueue` and asserts the
  queue's `cancel(id)` was called for queued items.
- Drives the `/stop` dispatcher with a stub `solveQueue` whose item is in
  `processing` and asserts that `stopIsolatedSession(uuid, …)` was called
  with the item's `sessionName`.

## Root Causes

### RC1. `extractStopSessionId` only looks for UUIDs

`src/telegram-start-stop-command.lib.mjs` — `extractStopSessionId(text,
repliedTo)` resolves a UUID from the `/stop` argument or the replied-to
message via the same RFC-4122 regex used by `/log`
(`src/telegram-log-command.lib.mjs`). When the user has no UUID at hand —
which is always the case for **queued** tasks because no isolation session
exists yet — the function returns `{ sessionId: null }` and the dispatcher
falls through to the chat-pause flow, which then immediately rejects the
message because it is a reply (#1081).

**Fix.** Generalize the resolver into `extractStopTarget(text, repliedTo)`
that returns either `{ kind: 'uuid', value, source }` or
`{ kind: 'url', value, source }`. URL extraction walks every whitespace-
separated word in the cleaned text and returns the first one that
`parseGitHubUrl()` (`src/github.lib.mjs`) recognises as `type === 'issue'`
or `type === 'pull'`. This reuses the same validator as the rest of the
bot. The dispatcher prefers UUIDs in
the argument (most specific), then UUIDs in the reply, then URLs in the
argument, then URLs in the reply, then falls back to the bare-stop / chat
pause flow. UUIDs win over URLs because UUIDs are globally unique whereas a
single issue URL can map to multiple in-flight requests if a user enqueues it
twice.

### RC2. The queue knows URLs, but `/stop` could not reach it

`SolveQueue.findByUrl(url)` already exists (added in #1080 to deduplicate
re-submissions), and it walks every per-tool queue plus the `processing`
map. The only missing wiring was passing `getSolveQueue` into
`registerStartStopCommands` so the `/stop` handler can call
`findByUrl(url)` → `cancel(id)` for queued items, and
`findByUrl(url).sessionName` → `stopIsolatedSession(uuid)` for processing
items.

**Fix.** Thread `getSolveQueue` (already available in `telegram-bot.mjs`)
into `registerStartStopCommands` as a new option `getSolveQueue` (defaults
to `null`, in which case the URL flow degrades gracefully to "Could not
find a queued task for that URL"). Tests inject a stub queue.

### RC3. Reply-mode rejection ordered before URL detection

The bare-stop flow rejects forwards/replies before any kind of target
detection (`#1081` made bare `/stop` reject reply messages so a stray reply
doesn't pause the chat). The UUID path already moved its detection before
that gate (#524). The same move is needed for URL detection so that a `/stop`
reply to the queue card is not silently dropped.

**Fix.** The new `extractStopTarget()` is called in the same place as
`extractStopSessionId()` — before the `isForwardedOrReply` gate.

## Solution plan

1. **Refactor** `extractStopSessionId()` into `extractStopTarget()` that
   returns the chosen target as `{ kind, value, source }`. Keep
   `extractStopSessionId` as a thin re-export so external callers and the
   existing test suite (`tests/test-issue-524-stop-uuid.mjs`) keep working.
2. **Wire `getSolveQueue`** into `registerStartStopCommands` via the shared
   command options bag in `src/telegram-bot.mjs` so the dispatcher can call
   `findByUrl()` / `cancel()`.
3. **Dispatcher behavior:**
   - **UUID target →** existing `$ --stop <UUID>` path (unchanged).
   - **URL target →** call `solveQueue.findByUrl(url)`:
     - If the item is still in any of the per-tool queues, call
       `solveQueue.cancel(item.id)` and acknowledge with
       `🗑 Removed queued task for <url> from <tool> queue.`
     - If the item is in `processing` and has a `sessionName` that looks like
       a UUID (i.e. it was started with `--isolation screen` / `tmux` /
       `docker`), forward to the same `$ --stop <UUID>` path.
     - If the item is in `processing` without a UUID-shaped session id (a
       legacy non-isolation start), reply with a clear "running task for that
       URL is not isolated, cannot be force-stopped" message and a hint to
       re-run with `--isolation screen` next time.
     - If no item matches, reply with "No queued or running task for that
       URL." and a hint to copy the session UUID instead.
4. **Tests:** Add `tests/test-issue-1780-stop-by-url.mjs` covering the new
   target resolver and the dispatcher branches with a stub queue.
5. **Verbose diagnostics:** Add `[VERBOSE]` log lines at every detection /
   dispatch branch so the next iteration can confirm the actual code path on
   real traffic without code changes (R9).
6. **Version bump** + CHANGELOG line.

## Existing components / libraries reused

- `parseGitHubUrl(url)` — `src/github.lib.mjs`. Validates a candidate
  string and returns `{ valid, type, normalized }`. The new
  `findFirstIssueOrPullUrl()` helper splits the cleaned text by whitespace
  and returns the first word the validator recognises as an issue or PR URL.
- `cleanNonPrintableChars(text)` — `src/telegram-markdown.lib.mjs`. Strips
  zero-width and control characters before tokenization so links pasted
  from rich Telegram clients still match.
- `SolveQueue.findByUrl(url)` — `src/telegram-solve-queue.lib.mjs`. Walks
  every tool queue plus `processing`.
- `SolveQueue.cancel(id)` — `src/telegram-solve-queue.lib.mjs`. Removes a
  queued item; reports false for processing items.
- `stopIsolatedSession(uuid)` — `src/isolation-runner.lib.mjs`. Wraps
  `$ --stop <uuid>` from
  [link-foundation/start#112](https://github.com/link-foundation/start/issues/112).
- `extractStopSessionId(text, repliedTo)` — preserved for backwards
  compatibility (still used by `tests/test-issue-524-stop-uuid.mjs`).

## Out-of-repo issues to file

After this PR ships, no upstream issue is required: the URL flow is fully
implementable inside `hive-mind` and reuses the existing
`link-foundation/start --stop` contract that already shipped for #524. We
verified that the upstream `$ --stop <uuid>` semantics are stable (see
[link-foundation/start#112](https://github.com/link-foundation/start/issues/112)
and the snapshot kept in
[`docs/case-studies/issue-1700/raw/start-status-output.txt`](../issue-1700/raw/start-status-output.txt)
for the related `$ --status` shape).

## Diagnostics added in this PR (R9)

`registerStartStopCommands()` now logs the following `[VERBOSE]` lines so a
real-traffic run produces a complete trace without code changes:

- `[VERBOSE] /stop: detected UUID <uuid> (source=argument|reply)` when the
  UUID branch wins.
- `[VERBOSE] /stop: detected URL <url> (source=argument|reply)` when the
  URL branch wins.
- `[VERBOSE] /stop: queue lookup for <url> → <action>` where `<action>` is
  one of `no-queue`, `not-found`, `cancel-queued`, `stop-running`,
  `running-not-isolated`.
- `[VERBOSE] /stop: cancelled queued item <id> for <url>` after a successful
  `cancel(id)`.
- `[VERBOSE] /stop: forwarding CTRL+C to running session <uuid> for <url>`
  before the `$ --stop <uuid>` call.
