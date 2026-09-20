# Case Study: Issue #1673 - Codex stream disconnect should auto-resume

## Summary

Issue #1673 reported a Codex CLI failure with this key message:

`stream disconnected before completion: An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID 00f1ff7f-106b-4f1e-a689-122e886fcaae in your message.`

Hive Mind already had a Codex retry path that preserves the Codex thread by setting `argv.resume` before retrying. The failure happened because the shared retry classifier did not recognize this OpenAI stream-disconnect message as retryable, so the existing resume retry branch was never reached.

## Source Data

- Issue: https://github.com/link-assistant/hive-mind/issues/1673
- PR: https://github.com/link-assistant/hive-mind/pull/1674
- Referenced log: `solution-draft-log-pr-1777065660519.txt`
- Original gist: https://gist.github.com/konard/eb9a3267b34f2e7f864f65e6fc8bba0f

The referenced log is 6115 lines and is stored in this directory for reproducible analysis.

## Timeline

| Time UTC            | Evidence            | Event                                                                                                  |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| 2026-04-24 21:18:05 | log lines 8-10      | `solve` started issue #1670 with `--tool codex`, `--attach-logs`, and `--verbose`.                     |
| 2026-04-24 21:20:58 | log lines 6003-6005 | Codex received an SSE error and `response.failed` with `server_error`.                                 |
| 2026-04-24 21:20:58 | log lines 6009-6014 | Codex emitted the stream-disconnect message and a JSON `error` event.                                  |
| 2026-04-24 21:20:58 | log lines 6036-6039 | Codex had resumable thread `019dc15c-00ca-7d82-92e4-572bb163213a`, then emitted `turn.failed`.         |
| 2026-04-24 21:20:58 | log lines 6096-6107 | Hive Mind summarized Codex error events and treated the run as a terminal failure instead of retrying. |

## Requirements

1. Preserve all available issue data under `docs/case-studies/issue-1673`.
2. Reconstruct the event sequence from the log.
3. Identify the root cause.
4. Search relevant official OpenAI information.
5. Reuse existing retry/resume components where possible.
6. Make the specific stream-disconnect case auto-resume so users do not need to retry manually.
7. Add a regression test that reproduces the problem before the fix.

## Root Cause

The root cause is in `src/tool-retry.lib.mjs`. `classifyRetryableError()` recognized capacity, overload, request-timeout, 503, and 500 messages, but not Codex's `stream disconnected before completion` transport failure.

`src/codex.lib.mjs` already does the correct follow-up behavior when a retryable Codex error is detected:

- parse `thread.started` into `sessionId`
- log the retry
- set `argv.resume = sessionId` when no resume is already active
- rerun `codex exec resume <session_id> --model <model>`

Because the message was classified as non-retryable, that existing path was skipped.

## Solution

Add `stream disconnected before completion` to the shared retry classifier with a non-capacity retry label. This keeps the current retry limits, backoff, model handling, and Codex resume behavior unchanged.

The regression test in `tests/test-codex-support.mjs` verifies two things:

- the exact issue message is classified as retryable and not as a capacity error
- a Codex JSON `thread.started` plus `turn.failed` stream disconnect is retried with `codex exec resume "thread_stream_1673" --model "gpt-5.5"`

## Related Components

- `src/tool-retry.lib.mjs`: shared transient error classification
- `src/codex.lib.mjs`: Codex JSON event parsing and retry loop
- `parseCodexExecJsonOutput()`: extracts `thread.started` into `sessionId`
- `executeCodexCommand()`: preserves sessions by setting `argv.resume` before retry

## External Research

Official OpenAI Codex CLI command-line docs say `codex exec` can optionally resume previous sessions, and the resume subcommand can resume by ID or use `--last` with an optional follow-up prompt:

- https://developers.openai.com/codex/cli/reference/

Official OpenAI API troubleshooting guidance treats small error rates as expected in production systems, recommends investigating by model/tier/project, and asks support requests to include relevant request IDs, timestamps, and error details:

- https://help.openai.com/en/articles/1000499-troubleshooting-api-errors-and-latency

## Upstream Reporting

No new upstream OpenAI Codex issue was filed from this case study. The available evidence shows a transient server-side or transport failure with a request ID, but the reproducible bug for this repository is Hive Mind's classifier gap. A high-quality upstream report would require a stable minimal reproduction of Codex itself failing to recover or persist the session; this log shows the session thread was present and usable by Hive Mind's existing resume path.
