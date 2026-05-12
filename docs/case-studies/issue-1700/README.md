# Issue 1700 Case Study: /log and /terminal_watch reject real `$` isolation sessions

## Summary

Issue 1700 reports that the Telegram `/log` and `/terminal_watch` commands
reject sessions that were demonstrably launched with `$` isolation. The bot's
own session-finished message shows `🔒 Isolation: screen` and `📊 Session:
<uuid>`, yet replying with `/log` to that message returns:

> ❌ This command currently supports only sessions launched with `$` isolation
> (screen / tmux / docker).

The same session is healthy on the host (`$ --status <uuid>` returns
`status executed`, `logPath /tmp/start-command/logs/isolation/screen/<uuid>.log`,
and `options { isolated screen, isolationMode detached, ... }`).

The root cause is a parser/contract mismatch between the hive-mind bot and the
upstream [`link-foundation/start`](https://github.com/link-foundation/start)
package (the `$` CLI). The bot looked for the isolation backend at
`data.isolation` and `data.options.isolation`, but the published `$` CLI
actually reports it at `options.isolated`. Both JSON and `links-notation`
(default) output use that same field name.

The fix updates `parseSessionStatusOutput` to read `options.isolated` while
keeping the legacy field names as fallbacks, adds a regression test built
directly from the issue's `$ --status` capture, and emits a `[VERBOSE]`
diagnostic line at the rejection site so future contract drifts can be
diagnosed without code changes.

## Artifacts

- Issue data: `raw/issue-1700.json`
- Real `$ --status` capture from the issue: `raw/start-status-output.txt`
- Issue screenshots: `images/image1-codex-finished.png`,
  `images/image2-log-error.png`, `images/image3-terminal-watch-error.png`
- Research source list: `research-sources.json`

## Timeline

- 2026-04-25 — PR #1687 merged the original `/log` command (issue #1686). It
  introduced `parseSessionStatusOutput` with isolation extraction wired to
  `data.isolation` and `data.options.isolation`. Tests used hand-written
  fixtures with those names.
- 2026-04-26 ~20:45 UTC — User runs
  `/codex https://github.com/PavelChurkin/resource-based-economy-Article/issues/11 --think max`
  in Telegram. The bot dispatches it through `$ --isolated screen --detached
--session f9838e46-...`. Session id `a1df7de8-...` is created on host.
- 2026-04-26 ~21:01 UTC — Session finishes successfully. Bot posts
  `✅ Work session finished successfully` with `📊 Session: f9838e46-...` and
  `🔒 Isolation: screen`.
- 2026-04-26 — User replies `/log`. Bot replies
  `❌ This command currently supports only sessions launched with $ isolation
(screen / tmux / docker)`. `/terminal_watch` shows the same rejection.
- 2026-04-26 — User confirms on the host that `$ --status f9838e46-...` returns
  a normal record showing `options { isolated screen, isolationMode detached
}`, opens issue #1700 with the full text capture and three screenshots.
- This PR — Adds a regression test built from the captured output, fixes the
  parser contract, adds `[VERBOSE]` diagnostics for future regressions, and
  documents the case study.

## Requirements (from issue #1700)

R1. `/log` must accept sessions whose `$ --status` record shows isolation =
`screen`, `tmux`, or `docker`.

R2. `/terminal_watch` must accept the same sessions (it shares
`decideLogDestination`).

R3. Compile issue data and screenshots into
`docs/case-studies/issue-1700/`.

R4. Reconstruct the timeline of events.

R5. Find the root cause of each problem and propose a solution. Search online
sources for additional facts.

R6. If diagnostics are insufficient to confirm the root cause on a real host,
add debug output / verbose mode so the next iteration can find it.

R7. If another repository is involved, file an issue there with reproducible
examples, workarounds, and code-level suggestions.

## Reproducible example

The issue body contains the exact `$ --status` output for session
`f9838e46-7d7b-4d84-ad59-ff784668107a`. The minimum reproducer feeds that
captured text to `parseSessionStatusOutput` and then to `decideLogDestination`:

```javascript
import { parseSessionStatusOutput } from './src/isolation-runner.lib.mjs';
import { decideLogDestination } from './src/telegram-log-command.lib.mjs';

const realOutput = `a1df7de8-1228-4730-9e1c-63b9beec5f48
  uuid a1df7de8-1228-4730-9e1c-63b9beec5f48
  status executed
  exitCode 0
  command "solve https://github.com/.../issues/11 --tool codex"
  logPath /tmp/start-command/logs/isolation/screen/a1df7de8-1228-4730-9e1c-63b9beec5f48.log
  options
    isolated screen
    isolationMode detached
`;

const parsed = parseSessionStatusOutput(realOutput);
console.log(parsed.isolation); // before fix: null   after fix: "screen"

const decision = decideLogDestination({
  statusResult: parsed,
  sessionInfo: null,
  repoVisibility: { isPublic: true, visibility: 'public' },
  chatType: 'group',
});
console.log(decision.destination); // before fix: "reject"   after fix: "chat"
```

`tests/test-issue-1700-isolation-parsing.mjs` automates this and additionally
covers JSON output (`--output-format json` returns `options.isolated` as well).

## Root Causes

### Primary: parser/contract mismatch with upstream `$`

The hive-mind side expected the isolation backend at three locations, in
priority order:

1. JSON: `data.isolation` (top-level)
2. JSON: `data.options.isolation`
3. Text: a top-level field named `isolation`

The published [`link-foundation/start` 0.25.x](https://github.com/link-foundation/start)
populates none of those. It uses `options.isolated` in both JSON and the
default `links-notation` output. Concretely:

- `src/lib/status-formatter.js` formats records as `links-notation` by default
  with the indented block:
  ```
  options
    isolated <backend>
    isolationMode <mode>
  ```
- `src/lib/execution-store.js` `ExecutionRecord.toObject()` produces JSON with
  `options.isolated` (and `options.isolationMode`).
- `src/lib/args-parser.js` lists the supported `--output-format` values:
  `['links-notation', 'json', 'text']`. The hive-mind side passes
  `--output-format json`, so JSON is what comes back when the local `$`
  supports it.

Result: `parseSessionStatusOutput` returned `isolation: null` for every real
session. `decideLogDestination` rejected the result with the misleading
"only supports `$` isolation (screen / tmux / docker)" message.

### Why the existing `parseSessionStatusOutput` test passed

`tests/test-issue-1686-log-command.mjs` uses hand-written fixtures with field
names that look plausible (`options.isolation`, top-level `isolation` in the
text fixture). They never matched real `$` output, but the test author had no
real capture to compare against.

### Why `sessionInfo.isolationBackend` did not save the day

`decideLogDestination` falls back to `sessionInfo?.isolationBackend` when the
parsed status has no isolation field. That fallback is in-memory only
(`activeSessions` Map in `session-monitor.lib.mjs`). It is wiped on bot
restart, on screen detach reset, and is not populated when `/log` is replying
to a message about a session the current bot process never tracked. Once the
in-memory cache is cold, the only source of truth is `$ --status`, and the
parser was not extracting it.

### Secondary: rejection error message is misleading and undebuggable

When the rejection fires, the user sees a generic message and the bot logs
nothing. There is no way to tell whether the rejection was caused by:

- session id not found,
- session found but isolation field missing from the parsed record,
- session found and isolation field set but to a value not in the allow-list.

This made it harder than necessary to diagnose. The fix adds a `[VERBOSE]`
diagnostic at the rejection site that prints the parsed isolation, the
in-memory backend, and the first 240 characters of the raw `$ --status`
output, so the next regression can be triaged from a single bot log line.

## Solution Plan and Implementation

### R1, R2 — Fix the parser to read `options.isolated`

`src/isolation-runner.lib.mjs` `parseSessionStatusOutput`:

- JSON branch: prefer `data.isolation`, then `data.options.isolated`, then
  `data.options.isolation`. Lower-case the result.
- Text/links-notation branch: prefer `readField('isolated')`, fall back to
  `readField('isolation')`. The existing `^\s*<name>\s+...` regex already
  matches indented lines, so the `isolated screen` line under `options` is
  picked up regardless of indent depth.

This restores `decideLogDestination` to correctly return
`destination: 'chat'` (or `'dm'` for private repos) for real screen / tmux /
docker sessions. Both `/log` and `/terminal_watch` consume that decision.

### R3, R4, R5 — Case study folder

This file plus `raw/issue-1700.json`, `raw/start-status-output.txt`,
`images/`, and `research-sources.json` capture the issue data, the timeline,
the requirements, and the external research that confirmed the upstream field
names.

### R6 — Verbose diagnostics

`src/telegram-log-command.lib.mjs` and
`src/telegram-terminal-watch-command.lib.mjs` now log a `[VERBOSE]` line at
the rejection site:

```
[VERBOSE] /log rejected session <id>: reason="..." parsedIsolation=null
sessionInfoBackend=null rawHead="<first 240 chars of $ --status output>"
```

That line is enough to identify any future contract drift — for example, if
upstream renames `isolated` to `isolationBackend`, the raw head will show the
new field and the fix is a one-line addition.

### R7 — Upstream considerations

The published `$` contract is documented and stable; the bug is on the
hive-mind side, not in `link-foundation/start`. The mismatch is internal to
this repository's parser, so no upstream issue is necessary. We do however
keep the legacy `data.isolation` and `data.options.isolation` fall-backs so
the parser stays robust against future upstream renames.

## Regression Test

`tests/test-issue-1700-isolation-parsing.mjs` (added to the `default`
suite via `@hive-mind-test-suite default`):

- Feeds the exact captured `$ --status` text from the issue and asserts that
  `parseSessionStatusOutput` returns `isolation: 'screen'`.
- Builds the JSON shape that `link-foundation/start` 0.25.x produces and
  asserts the same.
- Calls `decideLogDestination` with the parsed records and asserts
  `destination: 'chat'` and `isolationBackend: 'screen'` (which were `'reject'`
  / `null` before the fix).
- Covers `tmux` and `docker` JSON variants.

The test fails on the unfixed code (8 of 14 assertions), and passes after the
fix. The pre-existing `tests/test-issue-1686-log-command.mjs` continues to
pass (45/45) because the new code keeps every legacy path.

## Verification

- `node tests/test-issue-1700-isolation-parsing.mjs` — 14/14 pass after fix.
- `node tests/test-issue-1686-log-command.mjs` — 45/45 pass.
- `node tests/test-isolation-runner.mjs` — 15/15 pass.
- `node tests/test-extract-isolation-from-args.mjs` — 26/26 pass.
- `node tests/test-isolation-screen-fallback-1545.mjs` — 5/5 pass.
- `npm test` — 65/65 default-suite test files pass.
- `npm run lint` — clean.

## Follow-Up Notes

The verbose diagnostic at the rejection site uses
`statusResult.raw.slice(0, 240)`. If a future regression shows a different
field name in that slice, the parser will need a tiny addition to the
`isolationCandidate` chain — that is the single hot spot for upstream
contract changes.
