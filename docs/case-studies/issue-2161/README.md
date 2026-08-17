# Issue 2161 case study: a 4-hour run ended with a provider sentence nobody could act on

## Executive summary

On 2026-08-14 a `/solve` run on
[link-assistant/formal-ai#933](https://github.com/link-assistant/formal-ai/issues/933)
ran for **4 h 13 min**, burned **$31.39** across **484 turns**, and ended with a
single line:

```
❌ CLAUDE execution failed with Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access
```

The account behind the Claude MAX subscription had lost access to Claude Code.
The Anthropic API answered **HTTP 403** with the machine-readable code
`oauth_org_not_allowed` and the header `x-should-retry: false`; Claude Code
turned that into a synthetic assistant message and ended the session with
`terminal_reason: "api_error"`.

Hive Mind did one important thing right — it auto-committed and pushed the
in-flight work — and three things wrong:

1. **It did not recognise the error class.** `classifyRetryableError()` had no
   branch for account/subscription blocks, so the failure fell through to the
   unlabelled default, and `detectUsageLimit()` (which handles "you hit your
   limit, wait until X") did not match either.
2. **It reported the provider's sentence verbatim and nothing else.** The PR
   comment and the terminal both said "CLAUDE execution failed with …" — no
   statement that the _account_ is blocked, no statement that the work was
   preserved, no statement of what to do.
3. **Nothing stopped the fleet.** `/hive` had no notion of "this failure will
   repeat for every issue", so subsequent issues would be picked up and fail the
   same way, minutes and dollars at a time.

Everything below is reconstructed from
[`data/solve-log.txt`](data/solve-log.txt) (133 170 lines, the full
`start-command` log of the failed run, downloaded from the gist that the run
itself attached to the pull request).

## Evidence

| File                                                               | What it is                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| [`data/solve-log.txt`](data/solve-log.txt)                         | Full `start-command` log of the failed session (`--verbose`, stream-json included)       |
| [`provider-error-strings.md`](provider-error-strings.md)           | Every provider error string/code behind the detector, with the binary each was read from |
| [`upstream-report-claude-code.md`](upstream-report-claude-code.md) | The one upstream defect found, written up as a reproducible report                       |

Run identity, from the log header (lines 1–10):

```
Execution ID: f01f01f9-b76b-4983-b4bf-69f4c42ab9ad
Timestamp:    2026-08-14 10:30:13.085
Command:      solve https://github.com/link-assistant/formal-ai/issues/933 --think high --auto-merge
              --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en
Session:      a6a65083-b02c-4652-a6c5-71090b1cf759   (docker, image konard/hive-mind-dind:2.12.2)
```

## Timeline (UTC, 2026-08-14)

| Time         | Log line      | Event                                                                                                                                                                                                                   |
| ------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10:30:13     | 1–10          | Run starts in a detached docker container; Claude session `c8ca8b76-2882-4070-80ac-8d28562272e2`                                                                                                                        |
| 10:31–14:43  | —             | 484 turns of normal work; 4 h 11 min of API time, `$31.389056`, 36.3 M cache-read tokens                                                                                                                                |
| **14:43:03** | **132905**    | `post https://api.anthropic.com/v1/messages?beta=true failed with status 403 in 341ms - error; not retryable`, `x-should-retry: "false"`                                                                                |
| 14:43:03.991 | 132930–132976 | Claude Code emits a synthetic `assistant` message: `model: "<synthetic>"`, text = the org-disabled sentence, `error: "oauth_org_not_allowed"`, `is_api_error_message: true`, `request_id: req_011Ce2pPpFrtD864x1cuhUHu` |
| 14:43:04     | 132977–133041 | `result` event: `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: 403`, **`subtype: "success"`**, `num_turns: 484`, `total_cost_usd: 31.38905599999999`, `duration_ms: 15050306`                     |
| 14:43:04     | 133046        | Hive Mind logs `⚠️ Detected error from Claude CLI (subtype: success)` — the generic path, no classification                                                                                                             |
| 14:43:11     | 133187–133193 | 7 modified files still uncommitted in the working tree                                                                                                                                                                  |
| 14:43:11     | 133194–133204 | `💾 Critical error (…) — auto-committing uncommitted changes…` → commit `c8cf2eee` **✅ this part already worked**                                                                                                      |
| 14:43:12     | 133210–133211 | Preserved work pushed to `issue-933-16103d89a214`                                                                                                                                                                       |
| 14:43:2x     | 133213–133235 | 12.5 MB failure log uploaded as a gist, `🚨 Solution Draft Failed` comment posted on formal-ai#1010                                                                                                                     |
| **14:43:41** | **133244**    | `❌ CLAUDE execution failed with Your organization has disabled Claude subscription access…`, exit code 1                                                                                                               |

The PR comment the operator actually saw
([formal-ai#1010 comment](https://github.com/link-assistant/formal-ai/pull/1010#issuecomment-5294622721)):

```
## 🚨 Solution Draft Failed
The automated solution draft encountered an error:
```

CLAUDE execution failed with Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access

```

```

Note what is missing from it: that the account is blocked rather than the tool
broken, that the work _was_ saved and pushed, and what to do next.

## Requirements, one by one

Transcribed from the issue body, each with its root cause and the change that
addresses it.

### R1 — Recognise the error as a cancelled/expired subscription and say so

**Root cause.** There was no detector. `src/tool-retry.lib.mjs`
(`classifyRetryableError`) enumerated capacity, overload, gateway, DNS, timeout
and usage-limit cases and fell through to a bare
`{isRetryable: false, isCapacity: false}` default with no label;
`src/usage-limit.lib.mjs` only matches reset-time wordings;
`formatToolExecutionFailure()` in `src/lib.mjs` concatenated whatever text
arrived into `"CLAUDE execution failed with …"`.

**Fix.** New `src/subscription-error.lib.mjs`: a single detector with two layers
— machine-readable codes (`SUBSCRIPTION_ERROR_CODES`, keyed by the codes the
CLIs actually emit) and verbatim provider strings (`MESSAGE_RULES`). It returns
a descriptor `{kind, code, label, reason, guidance, message, apiErrorStatus}`
and two renderers, `formatSubscriptionErrorReport()` (multi-line, for the
terminal/log) and `formatSubscriptionErrorSummary()` (one line, for exits, PR
comments and commit reasons).

Kinds: `org_subscription_disabled`, `account_no_access`, `login_required`,
`billing`, `plan_restricted`, `api_key_invalid`.

### R2 — Stop the task with an emergency commit

**Root cause.** None — this already worked (log lines 133194–133211,
`commitUncommittedChangesOnCriticalError()` in
`src/critical-error-commit.lib.mjs`). What was missing was that the commit
reason said "CLAUDE execution failed with …" instead of naming the block, and
that the report did not tell the operator the work had been saved.

**Fix.** `src/solve.mjs` now captures the result of the emergency commit,
passes `formatSubscriptionErrorSummary()` as its reason, and prints the report
_after_ the commit so it can state `💾 Uncommitted changes were auto-committed
and pushed before stopping.` (or that the tree was clean).

### R3 — `/solve` and `/hive` must recognise it specifically, including in Telegram

**Root cause.** Three separate gaps:

- `src/claude.lib.mjs` parsed the stream-json `result` event but never looked at
  `data.error` / `data.api_error_status` / `data.terminal_reason`;
- `src/hive.mjs` treated a non-zero child exit as an ordinary per-issue failure
  and moved on to the next issue;
- the Telegram completion message (`src/session-monitor.lib.mjs`) had extra
  sections for limits, kills, resume and disk — but nothing for access blocks.

**Fix.**

- `claude.lib.mjs` classifies on both the synthetic `assistant`
  (`is_api_error_message: true`) and the `result` event, using the code, the
  HTTP status and the terminal reason, and propagates `subscriptionError` on
  every failure return path. The transient-retry short-circuit is skipped for it.
- `solve.mjs` prints the report, preserves the work, and exits with a message
  prefixed by `🚫 SUBSCRIPTION/ACCESS BLOCKED`.
- `hive.mjs` scans worker stdout/stderr for that marker, calls
  `issueQueue.stop()` on the first sighting (in-flight workers still finish and
  auto-commit), explains why instead of printing `exited with code 1`, and exits
  non-zero.
- `session-monitor.lib.mjs` replays the block from the captured session log into
  the Telegram completion message as its **first** section
  (`buildSubscriptionBlockedExtraSection` →
  `src/subscription-block-telegram.lib.mjs`), translated for en/ru/zh/hi.

The marker string is the contract between the three processes — it is the only
thing `/hive` and the session monitor need to find in a child's output.

### R4 — Do the same for codex and every other tool, checked against their docs/source

**Root cause.** Each tool adapter has its own output parser, so a per-adapter fix
would be six fixes and would rot. But every adapter already funnels through two
chokepoints: `classifyRetryableError()` (for retry/fallback decisions) and the
`/solve` failure exit (for reporting).

**Fix.** Both chokepoints were patched instead of the six adapters, and the
detector was seeded with strings read out of the shipped binaries of Claude
Code 2.1.233, Codex 0.147.0, Qwen Code, Gemini CLI and opencode — see
[`provider-error-strings.md`](provider-error-strings.md). A subscription block is
now, for every tool: not retryable, not a capacity error (so
`maybeSwitchToFallbackModel()` never burns a fallback hop on it), labelled
`subscription access blocked`.

### R5 — Debug output / verbose mode where data was insufficient

The log had enough data to find the root cause _this_ time only because
`--verbose` was on and the raw stream-json was echoed. The classification now
logs, at verbose level, `code=… http=… terminal_reason=… request_id=… uuid=…`
for the error event, so the next occurrence is diagnosable from the marker line
alone without re-reading 133 k lines.

### R6 — Report upstream issues where applicable

One upstream defect was found and written up in
[`upstream-report-claude-code.md`](upstream-report-claude-code.md): the final
`result` event carries `subtype: "success"` while `is_error: true` and
`terminal_reason: "api_error"` (log lines 132977–133041). Hive Mind's own log
line `⚠️ Detected error from Claude CLI (subtype: success)` (line 133046) is the
symptom. It was already open upstream as
[anthropics/claude-code#79500](https://github.com/anthropics/claude-code/issues/79500)
(filed against v2.1.49 with a rate-limit trigger), so we added our 403 payload
there as a second data point
([comment](https://github.com/anthropics/claude-code/issues/79500#issuecomment-5314107723))
instead of filing a duplicate. Everything else Claude Code did was correct and, in fact, better than
what Hive Mind did with it: it returned a machine-readable code, marked the
response `x-should-retry: false`, and did not retry.

### R7 — Apply the fix everywhere the problem exists

The audit found exactly three places where a subscription block was mishandled —
the retry classifier, the Claude stream parser, and the `/solve` failure exit —
plus two places where it was invisible (`/hive` queue, Telegram). All five are
covered above. No tool adapter contains its own retry/abort decision that
bypasses `classifyRetryableError()`.

## Root causes, condensed

1. **A missing error class.** Errors were binned as _transient_ (retry) or
   _usage limit_ (wait); "the credentials are no longer accepted" is neither, and
   fell into the unlabelled default.
2. **Structured data thrown away.** Claude Code handed over
   `oauth_org_not_allowed` + HTTP 403 + `terminal_reason: api_error`; the parser
   only kept the prose.
3. **No fleet-level notion of a terminal condition.** `/hive` had per-issue
   failure handling only, so an account-level block would be re-discovered once
   per issue.

## Alternatives considered

| Option                                                                                     | Verdict                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend `src/usage-limit.lib.mjs`                                                           | Rejected: usage limits have reset times and _should_ wait; conflating them would make the bot wait forever for a reset that never comes                                            |
| Per-adapter detection in `claude.lib.mjs`, `codex.lib.mjs`, …                              | Rejected as the primary mechanism: six copies to keep in sync. Used only in `claude.lib.mjs`, where structured codes exist                                                         |
| An off-the-shelf error-classification library (`serialize-error`, `verror`, `error-cause`) | Rejected: they model error _wrapping_ and serialisation, not provider-specific semantics. Nothing on npm knows what `oauth_org_not_allowed` means                                  |
| Probe the provider before each run (`claude --version`, a 1-token request)                 | Rejected as a replacement, worth revisiting as an addition: it costs a request per run and cannot catch a block that happens mid-run (which is exactly what happened here, 4 h in) |

## What the operator sees now

Terminal / session log:

```
🚫 SUBSCRIPTION/ACCESS BLOCKED — CLAUDE: Subscription access disabled for this organization
   Provider said: Your organization has disabled Claude subscription access for Claude Code · …
   Error code: oauth_org_not_allowed (HTTP 403)
   Why this stops the run: The provider rejected the request because the organization/account
   behind the subscription is no longer allowed to use this CLI. …
   This is NOT a usage limit and NOT a transient API error — retrying, waiting for a reset
   or switching to a fallback model cannot fix it, so the task is stopped now.

   What to do:
     • Ask the organization/workspace admin to re-enable CLI access for this account.
     • Or switch this run to API-key billing instead of the subscription.
     • Once access is restored, resume with the session ID printed above — no work is lost.
   💾 Uncommitted changes were auto-committed and pushed before stopping.
   📁 Working directory: /tmp/gh-issue-solver-1786703450612
   🌿 Branch: issue-933-16103d89a214
   📌 Session ID: c8ca8b76-2882-4070-80ac-8d28562272e2
   ▶️  Resume after access is restored: solve … --resume c8ca8b76-2882-4070-80ac-8d28562272e2
```

Telegram gets the same content as the first section of the completion message,
and `/hive` stops the queue with the reason spelled out instead of
`solve exited with code 1`.

## Regression coverage

`tests/subscription-error-2161.test.mjs` (42 assertions) replays the exact
payload from `data/solve-log.txt`, asserts one case per provider string in
[`provider-error-strings.md`](provider-error-strings.md), guards the
false-positive set (transient auth, gateway upstream auth, usage limits, 529,
timeouts, empty input), and pins the wiring: the commit happens before the
report, the report before the exit, `/hive` stops the queue, and the Telegram
section is prepended to `extraSections`.
