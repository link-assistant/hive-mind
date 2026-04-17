# Case Study: Issue #1625 — `--auto-attach-solution-summary` did not attach a summary

- **Issue**: [link-assistant/hive-mind#1625](https://github.com/link-assistant/hive-mind/issues/1625)
- **Pull Request**: [link-assistant/hive-mind#1626](https://github.com/link-assistant/hive-mind/pull/1626)
- **Related Issue**: [#1263](https://github.com/link-assistant/hive-mind/issues/1263) (original feature)
- **Observed on external PR**: [Jhon-Crow/godot-topdown-MVP#1846](https://github.com/Jhon-Crow/godot-topdown-MVP/pull/1846)
- **Tool**: `codex` (OpenAI `gpt-5.4`) with `--auto-attach-solution-summary --attach-logs --verbose`

## Summary

`--auto-attach-solution-summary` is supposed to post the AI's final message as a
"Solution summary" comment **only when the AI itself did not already post any
comment during the session**. On the external PR observed in the issue, the AI
produced no comments between the session-start and session-finish markers,
yet the solution summary was still not attached. The log confirmed the exact
reason:

```
[2026-04-17T17:45:46.739Z] [INFO] 🔍 Checking if AI created any comments during session (--auto-attach-solution-summary)...
[2026-04-17T17:45:47.403Z] [INFO] ℹ️  AI created comments during session, skipping solution summary attachment
```

## Timeline (external PR)

All comments posted by the tool account (`konard`) on the external PR
between the user's last feedback and the next round of work:

| Time (UTC)           | Comment body header            | Source                                              |
| -------------------- | ------------------------------ | --------------------------------------------------- |
| 2026-04-17T01:12:31Z | User feedback (by `Jhon-Crow`) | human                                               |
| 2026-04-17T17:38:42Z | 🤖 **AI Work Session Started** | `startWorkSession()` in `src/solve.session.lib.mjs` |
| 2026-04-17T17:45:57Z | 🤖 Solution Draft Log          | `attachLogToGitHub()` in `src/github.lib.mjs`       |
| 2026-04-17T17:48:20Z | ✅ Ready to merge              | `src/solve.auto-merge.lib.mjs`                      |

Note: between 17:38:42Z (session start) and 17:45:57Z (log upload) there were
**no** AI-authored comments. The solution summary should have been attached
during that window.

## Root Cause

`checkForAiCreatedComments()` in [`src/solve.results.lib.mjs`](../../../src/solve.results.lib.mjs)
returns `true` if it finds _any_ comment posted by the current GitHub user
(`gh api user --jq .login`) after `referenceTime`. Unfortunately, the tool
(solve.mjs) itself posts its bookkeeping comments under the **same** GitHub
user account as the AI would if it decided to comment via a tool call.

Flow of events that reproduces the bug:

1. `prepareFeedbackAndTimestamps()` computes `referenceTime` as the most recent
   issue/comment/PR timestamp **before** the session (e.g. the user's last
   feedback at 01:12:31Z).
2. `startWorkSession()` posts `🤖 AI Work Session Started` at 17:38:42Z.
3. The AI agent does its work but posts no comments (the Codex session in this
   case produced file changes and command executions only).
4. `attachSolutionSummary` logic calls `checkForAiCreatedComments(referenceTime, …)`.
5. The check finds the `AI Work Session Started` comment — posted by the
   tool, but authored by the current user and created after `referenceTime` —
   and returns `true`.
6. Solution summary attachment is **skipped** and the AI's final text (the
   `resultSummary` captured from the Codex JSON stream) is discarded.

## Fix

Introduced two new exports in `src/solve.results.lib.mjs`:

- **`TOOL_GENERATED_COMMENT_MARKERS`** — a list of text fragments that
  uniquely identify comments posted by solve.mjs itself: session start/end,
  resume/restart, log uploads, ready-to-merge, interactive session markers.
- **`isToolGeneratedComment(body)`** — returns `true` if a comment body
  contains any of those markers.

`checkForAiCreatedComments()` now:

- Rejects PR conversation / issue comments whose body matches any marker.
- Preserves the existing behavior for PR **review** (inline code) comments,
  because solve.mjs never posts those; the AI's only way to reach that surface
  is via explicit tool calls, so any such comment is genuinely AI-authored.
- Emits verbose diagnostics so the same class of bug can be debugged by
  inspecting the log:

  ```text
  🔎 Checking comments by 'konard' after 2026-04-17T01:12:31Z (PR #1846, issue #none)
     ⏭️  Skipped pr tool-generated comments: AI Work Session Started=1
     📨 PR conversation comments after referenceTime by 'konard' (excluding tool-generated): 0
     📝 PR review (inline) comments after referenceTime by 'konard': 0
  ```

## Verification

- New unit tests in `tests/test-solution-summary.mjs` cover:
  - Export surface for `isToolGeneratedComment` and `TOOL_GENERATED_COMMENT_MARKERS`.
  - Recognition of each session marker (`AI Work Session Started`,
    `Solution Draft Log`, `Auto-restart`, `Ready to merge`).
  - Negative cases: real AI comments, human feedback, empty/null/non-string input.
- Existing tests still pass (22 total, 0 failures).

## Data

Raw evidence preserved under `data/`:

- `external-pr-1846-comments.json` — full API response for all comments on
  the external PR that triggered this issue.
- `external-pr-1846-comments-summary.json` — compact timeline used to
  reconstruct the sequence of events above.
- `solution-draft-log-excerpt.txt` — the opening header and all grep-matched
  lines (`auto-attach`, `Checking if AI`, `No AI comments`,
  `AI created comments`, `Captured result summary`, `agent_message`) from the
  12.2 MB solution-draft log downloaded from the Gist linked in the external
  PR, including the exact log line that proves the incorrect decision. The
  full log is available via the Gist URL listed in the session-finish comment
  (`2026-04-17T17:45:57Z`) on the external PR.

## Prior Art / Related Components

- `checkForExistingComment` in `src/solve.auto-merge-helpers.lib.mjs` solved
  a related problem (deduplicating "Ready to merge") by scanning for
  **session-ending markers** ("Now working session is ended",
  "AI Work Session Completed") and narrowing the search scope. The marker
  set is similar in spirit to ours but serves a different purpose: ours
  must cover **all** tool-authored session bookkeeping, not only
  session-ending comments.
- `checkForNonBotComments` in the same file distinguishes bot vs human
  authorship but still treats the current user as a bot — exactly the
  ambiguity exploited in this bug when the current user is posting both
  tool and AI comments.

## Related Upstream / Third-party Issues

None identified. The bug is local to solve.mjs logic; no external library or
tool needs a change. The external PR
(`Jhon-Crow/godot-topdown-MVP#1846`) is only used as reproducible evidence
and does not need its own issue report.
