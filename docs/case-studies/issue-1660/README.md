# Case Study: Issue 1660 - Codex Error Events Were Treated As Success

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1660

Prepared PR: https://github.com/link-assistant/hive-mind/pull/1661

Related external PR: https://github.com/konard/p-vs-np/pull/544

The reported failure was not that `gpt-5.5-mini` exists in the hive-mind model catalog. The failure was that Codex emitted explicit JSON error events for that requested model, while `hive-mind` still marked the Codex run as successful because the Codex process exited with code 0.

The fix keeps `gpt-5.5-mini` available as requested, but changes Codex execution handling so structured Codex errors are fatal tool results.

## Evidence Saved

Raw GitHub and Gist evidence is saved in this directory:

- `data/issue-1660.json`
- `data/issue-1660-comments.json`
- `data/pr-1661.json`
- `data/pr-1661-review-comments.json`
- `data/pr-1661-reviews.json`
- `data/external-pr-544.json`
- `data/external-pr-544-comments.json`
- `data/external-pr-544-review-comments.json`
- `data/external-pr-544-reviews.json`
- `data/external-comment-4308923423.json`
- `data/external-pr-544-gist-urls.json`
- `evidence/external-comment-4308923423.md`
- `evidence/key-log-lines.txt`
- `evidence/gist-logs/*.txt`

The most relevant linked log from the issue is:

- `evidence/gist-logs/solution-draft-log-pr-1776985563392.txt`

Additional auto-restart and interruption logs are preserved beside it.

## Timeline

All times are UTC.

- 2026-04-23 17:02:20: Earlier successful `solve` session for `konard/p-vs-np#544` started with Claude.
- 2026-04-23 17:11:26: A solution summary was posted to external PR 544.
- 2026-04-23 17:13:59: External PR 544 was marked ready to merge.
- 2026-04-23 23:05:50: A new AI work session started on external PR 544 using Codex and requested model `gpt-5.5-mini`.
- 2026-04-23 23:05:59: Codex emitted structured JSON errors: `type=error` and `type=turn.failed`.
- 2026-04-23 23:05:59: The error message said the requested `gpt-5.5-mini` model was not supported with a Codex ChatGPT account.
- 2026-04-23 23:05:59: `hive-mind` logged `Codex error events observed: item=0, turn=1, stream=1`.
- 2026-04-23 23:05:59: `hive-mind` then logged `Codex command completed`, because the success path only treated the process exit code and auth errors as fatal.
- 2026-04-23 23:06:07: The session log was uploaded as if the solution draft had ended normally.
- 2026-04-23 23:08:12: Auto-restart-until-mergeable iteration 1 started because merge conflicts were still detected.
- 2026-04-23 23:10:26: Auto-restart iteration 2 started for the same merge-conflict condition.
- 2026-04-23 23:12:41: Auto-restart iteration 3 started.
- 2026-04-23 23:14:20: The session was interrupted by the user.
- 2026-04-23 23:13:29: Issue 1660 was opened to report that the Codex unsupported-model error was not treated as an error.

## Requirements From The Issue

- Preserve the model itself in the catalog.
- Treat all tool errors as errors.
- Stop the success path from continuing into auto-restart loops after Codex emits an error.
- Download logs and related data into `docs/case-studies/issue-1660`.
- Build a deep case-study analysis from the logs.
- Search online for additional facts.
- If root cause is unclear, add debug output or verbose mode for a future iteration.

The root cause was clear from the saved logs and parser state, so no new runtime debug flag was needed.

## Root Causes

1. Codex produced explicit structured errors but exited with code 0.

The relevant JSON stream contained both:

- `{"type":"error","message":"..."}`
- `{"type":"turn.failed","error":{"message":"..."}}`

2. `parseCodexExecJsonOutput` already captured these into `streamErrors` and `turnFailures`.

The parser was not the missing piece. It correctly counted error events and logged their presence in verbose output.

3. `executeCodexCommand` ignored those parsed errors in the success decision.

Before this fix, a zero exit code bypassed failure handling, even when `codexJsonState.itemErrors`, `codexJsonState.turnFailures`, or `codexJsonState.streamErrors` were non-empty.

4. Auto-restart logic trusted the successful tool result.

After the false success, mergeability checks continued and auto-restart-until-mergeable launched more Codex sessions. Each new session hit the same unsupported-model error.

## Solution Implemented

The implementation adds a Codex error summary helper and uses it before the success return path:

- Unwrap nested Codex error JSON so the human-readable model/access message is exposed.
- Treat any parsed Codex item error, turn failure, or stream error as `success: false`.
- Preserve usage-limit handling when the structured error is a usage-limit message.
- Return `errorInfo` and `result` so failure log uploads and auto-restart logging can show the specific error.
- Keep `gpt-5.5-mini` validation unchanged.

Regression coverage was added to `tests/test-codex-support.mjs`:

- Parser-level test for the unsupported ChatGPT-account model error.
- Execution-level test where Codex emits error JSON and exits with code 0. The expected result is now `success: false`.

## Alternatives Considered

- Remove or demote `gpt-5.5-mini`: rejected because the issue explicitly says to keep the model and wait for it to become available.
- Trust Codex process exit code only: rejected because the evidence shows Codex exited 0 after emitting explicit error events.
- Add broad text pattern matching across verbose logs: rejected because this repo already moved away from broad output pattern matching after false positives. Structured JSON events are the reliable signal here.
- Preflight every model by account type: useful as a future enhancement, but insufficient as the primary fix because access can change server-side and runtime Codex errors must still be fatal.

## Online Research Notes

OpenAI's current Codex CLI docs state that Codex CLI can be run locally from a terminal, can be authenticated with a ChatGPT account or API key, and is included in ChatGPT plans. Source: https://developers.openai.com/codex/cli

OpenAI's Codex automation cookbook shows `codex exec` used in GitHub automation flows that rely on downstream CI and PR creation. This supports treating machine-readable execution errors as workflow-fatal. Source: https://developers.openai.com/cookbook/examples/codex/autofix-github-actions

OpenAI's GPT-5.5 announcement says GPT-5.5 is rolling out in Codex and ChatGPT, and describes Codex availability separately from API availability. This supports keeping the model in the catalog while still respecting account-specific runtime errors. Source: https://openai.com/index/introducing-gpt-5-5/

## Result

The root cause is fixed in `src/codex.lib.mjs`. Codex structured error events now fail the tool result before the normal success return, preventing false success and subsequent auto-restart loops for the same failed execution.
