# Case study: issue #3570 — "CLAUDE execution failed with Claude command failed with exit code 1"

- Issue: https://github.com/link-assistant/hive-mind/issues/3570
- Pull request: https://github.com/link-assistant/hive-mind/pull/3571
- Failed run: solve of https://github.com/konard/konard.github.io/issues/7 → PR https://github.com/konard/konard.github.io/pull/8, failure comment https://github.com/konard/konard.github.io/pull/8#issuecomment-6275543294
- Versions: Hive Mind 2.39.2, Claude Code 2.1.303 (`claude-cli/2.1.303 (external, sdk-cli)`), model `opus` (`claude-opus-5-5`), Node v26.12.0
- Claude session: `84101e53-d3a4-4b69-a82a-b20b2819f791`

## Data in this folder

| File                                  | What it is                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `raw/solve-pr-8-sanitized.log.txt.gz` | The public failure log from the issue (`konard/public-logs/…/e711e967ce2618e8/sanitized.log.txt`, 26 MB, 140 625 lines), gzipped. The `anthropic-organization-id` and `anthropic-workspace-id` header values were replaced by `<redacted-org-id>` / `<redacted-workspace-id>` before committing (issue #2837). |
| `raw/failure-comment-6275543294.json` | The failure comment as returned by `gh api repos/konard/konard.github.io/issues/comments/6275543294`.                                                                                                                                                                                                          |
| `upstream-claude-code-issue.md`       | The report for Claude Code (reproduction, workaround, suggested fix), filed as https://github.com/anthropics/claude-code/issues/103820.                                                                                                                                                                        |

The session transcript (26.8 MB), the container and the private execution/bot logs listed in the first issue comment were not available to this PR; the transcript facts below come from that comment.

## Timeline (UTC, 2026-10-19)

| Time              | Event                                                                                                                                                                                                                                | Source                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 16:17:55          | `solve … --tool claude --verbose --attach-logs` starts (Hive Mind 2.39.2).                                                                                                                                                           | log line 1–8                          |
| 16:19:09          | Claude Code starts with `--output-format stream-json --verbose`; `ANTHROPIC_LOG: debug` because of `--verbose`.                                                                                                                      | log lines 283, 592                    |
| 16:19–18:51       | Normal work. `rate_limit_event`s on stdout report the 7-day window climbing.                                                                                                                                                         | log                                   |
| 18:51:17          | Claude Code auto-compacts the context (`compact_boundary`, `x-claude-code-context-compacted: auto`).                                                                                                                                 | log lines 138 610–138 724             |
| 18:51:19          | Background task `bfhe8t5w6` ends (`end_time` of its `task_updated` event).                                                                                                                                                           | log line ≈140 395                     |
| 18:51:36          | Request `log_3d9a7c` is sent; the server answers **404** at 18:51:37 (`date` header).                                                                                                                                                | log lines 139 700–139 724, 139 934    |
| 18:51:37–19:15:11 | **Claude Code writes nothing to stdout for 23.5 minutes.**                                                                                                                                                                           | log lines 139 724–139 725             |
| 19:15:11–19:17:19 | stdout resumes with events that are 25–38 minutes old (an assistant message created at 18:38:46, a 200 response with server `date` 18:39:23).                                                                                        | log lines 139 725–139 805             |
| ≈19:16:21         | The last API request starts (`durationMs: 135875` before the 429).                                                                                                                                                                   | debug block                           |
| 19:18:37          | Anthropic answers **429**: `anthropic-ratelimit-unified-7d-status: rejected`, `7d-utilization: 1.0`, `representative-claim: seven_day`, `unified-reset: 1792494000` (= 2026-10-20 11:00 UTC), `retry-after: 56482`.                  | `date` header of the debug block      |
| 19:19:48          | Claude Code writes `assistant isApiErrorMessage=true: "You've hit your weekly limit · resets 11am (UTC)"` to the session **transcript only**.                                                                                        | issue comment 1                       |
| 19:19:48          | stdout gets the 404 of `log_3d9a7c`: `response error (error; not retryable)`, `durationMs: 1432110`. Claude Code handled a response that arrived at 18:51:37 only ≈23.9 minutes after sending the request.                           | log lines 139 922–139 943             |
| 19:27:58          | solve receives the last `rate_limit_event`: `allowed_warning`, `seven_day`, `utilization 0.97`, `resetsAt 1792494000` — stale, written before the 429. It also receives `task_updated` for `bfhe8t5w6`, 37 min after its `end_time`. | log line 140 364                      |
| 19:29:46–19:30:12 | solve receives the `ANTHROPIC_LOG=debug` request dump and the 429 block (11.5 min after the 429), followed by a base64 body line.                                                                                                    | log lines 140 470–140 520             |
| 19:30:12.793      | `⚠️ Claude Code stopped background tasks when print mode exited: 1 task(s) [bfhe8t5w6], 0 synthetic tool result(s), 0 result event(s)`                                                                                               | log                                   |
| 19:30:12.800      | `❌ Claude command failed with exit code 1` — no limit, no reset time. `lastMessage` is the base64 line.                                                                                                                             | log line 140 523                      |
| 19:30:14          | Critical-error preservation pushes `recovery/issue-7-ede7c165bf5d`.                                                                                                                                                                  | log line 140 576                      |
| 19:31:16          | Failure comment "CLAUDE execution failed with Claude command failed with exit code 1" posted.                                                                                                                                        | `raw/failure-comment-6275543294.json` |
| 2026-10-20 11:00  | The weekly window resets. A parallel task on the same account (hive-mind#3531) that did get the limit message auto-resumed at 11:13:54; this one never did.                                                                          | issue comment 1                       |

Key excerpt of the debug block (`raw/…log.txt.gz`, lines 140 478–140 523, IDs redacted):

```
[2026-10-19T19:30:12.199Z] [STDOUT] [log_be123b] response error (error; no more retries left) {
[2026-10-19T19:30:12.245Z] [STDOUT]   status: 429,
[2026-10-19T19:30:12.293Z] [STDOUT]     "anthropic-ratelimit-unified-7d-reset": "1792494000",
[2026-10-19T19:30:12.296Z] [STDOUT]     "anthropic-ratelimit-unified-7d-status": "rejected",
[2026-10-19T19:30:12.305Z] [STDOUT]     "anthropic-ratelimit-unified-7d-utilization": "1.0",
[2026-10-19T19:30:12.316Z] [STDOUT]     "anthropic-ratelimit-unified-representative-claim": "seven_day",
[2026-10-19T19:30:12.322Z] [STDOUT]     "anthropic-ratelimit-unified-reset": "1792494000",
[2026-10-19T19:30:12.328Z] [STDOUT]     "anthropic-ratelimit-unified-status": "rejected",
[2026-10-19T19:30:12.348Z] [STDOUT]     date: "Mon, 19 Oct 2026 19:18:37 GMT",
[2026-10-19T19:30:12.358Z] [STDOUT]     "retry-after": "56482",
[2026-10-19T19:30:12.397Z] [STDOUT]   durationMs: 135875,
[2026-10-19T19:30:12.519Z] [STDOUT] Cfl40YOZK5u33blnr31i3MxYfHT5zEUjKBjXrhm2/98OPPp89fWvPn+j7hXMOJYumS72k3VC9m3n…
[2026-10-19T19:30:12.800Z] [ERROR] ❌ Claude command failed with exit code 1
```

## Requirements and where each one is met

| #   | Requirement (issue and comments)                                                                                                   | Implementation                                                                                                                                               | Verification                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| R1  | Download all logs and data to `docs/case-studies/issue-3570`                                                                       | `raw/` (log, failure comment)                                                                                                                                | this folder                                                                                              |
| R2  | Deep case study: timeline, requirements, root causes, solutions, research                                                          | this README                                                                                                                                                  | —                                                                                                        |
| R3  | Read the session transcript tail after a non-zero exit with no `result` event; treat an `isApiErrorMessage` usage limit as a limit | `src/claude.usage-limit-sources.lib.mjs` (`readClaudeTranscriptApiError`), wired in `src/claude.lib.mjs`                                                     | `tests/claude-usage-limit-sources-3570.test.mjs` "issue #3570 replay…"                                   |
| R4  | Keep the last `rate_limit_event` in non-interactive mode; `rejected` + `resetsAt` is a limit                                       | `createClaudeUsageLimitEvidence().observeEvent`                                                                                                              | "a rejected rate_limit_event with resetsAt identifies the limit"                                         |
| R5  | Fallback: the `ANTHROPIC_LOG=debug` 429 block                                                                                      | `observeRawLine` parses `[log_…] response error` blocks                                                                                                      | "with --verbose debug output…", "without a transcript, the debug 429 headers alone…"                     |
| R6  | Test: exit 1, no `result`, transcript weekly limit → `limitReached: true`, reset 11:00 UTC                                         | —                                                                                                                                                            | "issue #3570 replay: exit 1, no result event, weekly limit only in the transcript"                       |
| R7  | Cross-check and double-check **all** sources for Claude **and Codex** (comment 2)                                                  | Claude: five sources combined; Codex: `src/codex-rollout-usage-limit.lib.mjs` reads the rollout; OpenCode: `{"type":"error"}` records                        | `tests/codex-rollout-usage-limit-3570.test.mjs`, `tests/opencode-usage-limit-error-record-3570.test.mjs` |
| R8  | Add debug/verbose output where data was missing                                                                                    | `🔍 Usage-limit cross-check (issue #3570):` with one `✔`/`·` line per source; `⚠️ Usage limit found only in: …` warning when the tool's own output missed it | asserted in all three test files                                                                         |
| R9  | Debug/base64 dumps must not become the failure reason                                                                              | `observeRawLine(...).isDebugOutput` keeps them out of `lastMessage` and `stderrErrors`                                                                       | "issue #1924 server throttle stays a non-limit failure, and a base64 dump is not the reason"             |
| R10 | Do not turn the #1924 server throttle (`rejected` without `resetsAt`) into a usage limit                                           | `classifyClaudeRateLimitEvent`                                                                                                                               | same test as R9                                                                                          |
| R11 | Report upstream issues with a reproduction, workaround and suggested fix                                                           | `upstream-claude-code-issue.md`                                                                                                                              | https://github.com/anthropics/claude-code/issues/103820                                                  |
| R12 | Fix the same problem everywhere in the codebase                                                                                    | Claude, Codex, OpenCode; Gemini, Qwen and Agent reviewed (see below)                                                                                         | —                                                                                                        |

Out of scope here because they have their own issues, as listed in issue comment 1: #3572 (subagent worktrees committed as gitlinks), #3573 (screenshots dropped by preservation), #3434 (placeholder PR marked ready), #2837 (debug logging publishes account identifiers), #3125 (memory limit).

## Root causes

1. **Claude Code ended the session without telling stdout.** After the 429 it wrote the "weekly limit" API-error message to the transcript but emitted no assistant `is_api_error_message` event and no `result` event, then exited 1. Reported upstream as https://github.com/anthropics/claude-code/issues/103820 (`upstream-claude-code-issue.md`).
2. **Hive Mind trusted one source.** In print mode a usage limit was recognized only from the `result` event (`api_error === 'usage_limit_reached'`) and from `lastMessage` through `detectUsageLimit`. `rate_limit_event` was read only in interactive mode (`src/interactive-mode.lib.mjs`). The transcript and the debug 429 headers were never consulted.
3. **`lastMessage` was any non-JSON stdout line.** With `--verbose`, `ANTHROPIC_LOG=debug` writes request/response dumps to stdout, so the last line was a base64 image fragment. It became both the failure reason in the comment and the only text checked for a limit.
4. **The last `rate_limit_event` was stale.** It said `allowed_warning` at 0.97 because Claude Code does not emit a `rejected` event for the request that fails; the authoritative data is the 429 headers and the transcript.
5. **Claude Code stalled and its stdout lagged.** After the auto-compaction at 18:51:17 it wrote nothing for 23.5 minutes, then handled a 404 that the server had sent at 18:51:37 with `durationMs: 1432110`. Since `durationMs` is measured inside Claude Code, its own event loop processed the response about 24 minutes late; solve logged nothing in that gap because nothing arrived. The 429 block (server `date` 19:18:37) reached stdout 11.5 minutes later, and the process exited 1 right after it, without the `rejected` `rate_limit_event`, the synthetic assistant message and the `result` that Claude Code 2.1.304 emits on a normal usage-limit exit (see `upstream-claude-code-issue.md`, "Reproduction"). Because solve reads every source after the exit, the classification no longer depends on the timing.

The same single-source pattern existed elsewhere:

- **Codex** (`src/codex.lib.mjs`): a non-zero exit checked only `stderr`/`lastMessage`. `codex exec --json` emits only `thread.*`/`turn.*`/`item.*` events; the `token_count.rate_limits` snapshots that carry `used_percent` and `resets_at` exist only in the thread's rollout file.
- **OpenCode** (`src/opencode.lib.mjs`): `opencode run --format json` reports a failed step as a `{"type":"error"}` record and exits 1 (`packages/cli/src/run/noninteractive.ts`, `emit("error", …)` and `process.exitCode = 1`), but only the last stdout chunk was checked, so a trailing `step_finish` chunk hid the limit.

## Solution

### Claude (`src/claude.usage-limit-sources.lib.mjs`, `src/claude.lib.mjs`)

`createClaudeUsageLimitEvidence()` collects facts while the stream runs, and `resolveClaudeUsageLimit()` combines them on a failed exit:

1. `lastMessage` / the `result` event (the source used before);
2. the stream-json synthetic assistant message (`is_api_error_message`), even when it is not the last line;
3. the transcript tail `~/.claude/projects/<cwd slug>/<sessionId>.jsonl` (last 1 MB, skipping trailing non-conversation entries) — the entry with `isApiErrorMessage: true`;
4. the last `rate_limit_event` — `status: "rejected"` with `resetsAt` (a bare `rejected` stays the #1924 throttle);
5. the `ANTHROPIC_LOG=debug` 429 block — `anthropic-ratelimit-unified-status: rejected` with `anthropic-ratelimit-unified-reset` (epoch → `Oct 20, 2026, 11:00 AM` UTC).

Any source is enough. An epoch reset (from `rate_limit_event` or the 429 headers) is preferred over the text's "resets 11am", because it carries the date; the user-facing message keeps Claude Code's own text when a source has it. A limit makes the run `limitReached: true` with `limitResetTime` and `limitTimezone`, so the existing auto-resume, Telegram and PR-comment paths report "usage limit, resets …" instead of "exit code 1". In verbose mode every source is logged with `✔`/`·` and its reason; when only the side sources saw the limit, solve warns `⚠️ Usage limit found only in: …`.

Replaying the issue's sources (stale `allowed_warning` event, the debug 429 block, a base64 line and the transcript entry) now gives `limitReached: true`, reset `Oct 20, 2026, 11:00 AM` (UTC) and the message "You've hit your weekly limit · resets 11am (UTC)". With the transcript alone the reset is `11:00 AM` (UTC).

### Codex (`src/codex-rollout-usage-limit.lib.mjs`, `src/codex.lib.mjs`)

On a non-zero exit that was not caused by a signal, `resolveCodexExitUsageLimit()` reads the last turn of `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<thread id>.jsonl` (back to its `task_started`/`turn_started`) and combines:

1. `stderr / last message` (the source used before);
2. `rollout error event` — an `event_msg` `error` with `codex_error_info: usage_limit_exceeded` or usage-limit text (persisted by older Codex versions only);
3. `rollout rate_limits` — the newest `token_count.rate_limits`: a `primary`/`secondary` window at `used_percent >= 100` with `resets_at` is a limit; the latest reset wins (`5-hour`/`weekly` labels from `window_minutes`).

`rate_limit_reached_type` without a full window and reset stays a plain failure, a limit from an earlier turn is not reported again, and a killed process is never a usage limit. `limitTimezone` is now returned by the Codex runner too.

### OpenCode (`src/opencode.lib.mjs`)

Every non-recoverable `{"type":"error"}` record's text is kept and checked together with the last stdout chunk, with the same verbose per-source lines.

### Other runners

Gemini (`errorMessages` or all output), Qwen (all output) and Agent (`lastMessage`, `outputError`, full output) already check the full output on failure, so they did not need a change.

## Tests

| Test file                                               | Cases                                                                                                                                                                                 | Before the fix               | After    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------- |
| `tests/claude-usage-limit-sources-3570.test.mjs`        | 9: the issue replay (exit 1, no `result`, transcript-only weekly limit, reset 11:00 UTC), debug headers, rate_limit_event, synthetic message, #1924 throttle and base64 dump, parsers | replay and source tests fail | 9/9 pass |
| `tests/codex-rollout-usage-limit-3570.test.mjs`         | 7: weekly window at 100%, rollout error event, earlier-turn limit, below 100% / missing rollout, SIGKILL, classification, reader                                                      | 4 fail                       | 7/7 pass |
| `tests/opencode-usage-limit-error-record-3570.test.mjs` | 2: limit in an error record followed by another chunk; non-limit error record                                                                                                         | 2 fail                       | 2/2 pass |

Existing related suites still pass: `codex-process-exit-2745` (13), `codex-usage-limit-any-event-3215` (2), `fresh-resume-2888` (11), `claude-result-error-precedence-2687` (18).

## Online research and existing tools

- Claude Code headless output: https://code.claude.com/docs/en/headless — `stream-json` ends with a `result` event; nothing documents a session that ends without one.
- Earlier upstream reports of the same family, all closed: anthropics/claude-code#8126 and #1920 (missing `result` in stream-json), #39700 (stream-json hangs), #38673 (empty result when `overageStatus` is `rejected`), #49640 (`rate_limit_event` injected mid-line), #37012 and #77018 (expose rate limits in headless output). None covers a usage-limit exit whose message reaches only the transcript, so a new report was filed: https://github.com/anthropics/claude-code/issues/103820.
- Anthropic rate-limit headers (`anthropic-ratelimit-*`, `retry-after`): https://docs.anthropic.com/en/api/rate-limits. The `anthropic-ratelimit-unified-*` names are what Claude subscription traffic returned in this log.
- Anthropic TypeScript SDK logging: `ANTHROPIC_LOG=debug` prints request/response dumps through the SDK logger, which Claude Code routes to stdout in this setup.
- Node.js `process.exit()` warns that pending writes to `process.stdout` can be lost: https://nodejs.org/api/process.html#processexitcode — the reason solve cannot rely on the last stdout line.
- Codex (openai/codex): `codex-rs/rollout/src/policy.rs` (which `EventMsg`s are persisted: `TokenCount`, `TurnStarted`, `TurnComplete`; `Error` is not), `codex-rs/protocol/src/protocol.rs` (`TokenCountEvent`, `RateLimitSnapshot`, `RateLimitWindow { used_percent, window_minutes, resets_at }`, `CodexErrorInfo::UsageLimitExceeded`).
- OpenCode (anomalyco/opencode): `packages/cli/src/run/noninteractive.ts` emits `{"type":"error", …}` and sets `process.exitCode = 1`.
- Existing libraries: no library parses Claude Code transcripts, Codex rollouts and Anthropic rate-limit headers together. Hive Mind already had the needed pieces (`detectUsageLimit`, `resolveSessionTranscriptPath`, `findCodexRolloutFile`, `readLogTailText`), so the fix reuses them instead of adding a dependency.

## Uncertainties

- **Why Claude Code stalled and then dropped its final events is not known.** The log shows the stall (a 404 handled ≈24 minutes after the server answered, measured by Claude Code itself) and that solve was idle meanwhile. A local reproduction with Claude Code 2.1.304, a dummy subscription token and a mock API that answers every request with the reported 429 headers (`experiments/issue-3570/mock-weekly-limit-server.mjs`) did **not** lose the final events: stdout had the `rejected` `rate_limit_event` (`resetsAt` 1792494000), the "You've hit your weekly limit · resets 11am (UTC)" message and a `result` with `api_error: usage_limit_reached`, also with a background `sleep 120` task and with a reader that sleeps 30–60 s before draining 8 kB–300 kB of output. The loss therefore needs the long-session state (compaction, 26.8 MB transcript, a stalled event loop) that could not be recreated here; the upstream report asks for it to be checked.
- **No real Codex usage-limit rollout was captured.** The Codex fix follows the upstream source (persisted `token_count` with `rate_limits`); the tests use rollouts built from those types. If Codex stops persisting `rate_limits` before an exit, the rollout check simply finds nothing and the previous behavior remains.
- The transcript entry of the real session was not available here (it is on the server); its text and timestamp come from issue comment 1.
