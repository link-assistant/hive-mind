# Issue 1900: Interactive Thinking Token Comment Noise

## Summary

Issue #1900 reported that interactive mode created large numbers of "Unrecognized Event" PR comments while solving an external PR. The main source was Codex system events with `type: "system"` and `subtype: "thinking_tokens"`. These events can arrive hundreds of times during one turn, so treating each one as an unknown event caused PR comment spam and hid more useful progress updates.

The fix groups consecutive `system.thinking_tokens` events into one editable "Thinking..." comment, throttles live edits, and finalizes the comment when the next non-thinking event arrives or the handler flushes. It also handles the lower-volume observed system lifecycle subtypes `status`, `compact_boundary`, and `task_updated` without falling through to the unrecognized-event renderer.

## Evidence

Raw investigation data is checked in under this directory:

- `raw/github/hive-mind-issue-1900.json`
- `raw/github/hive-mind-issue-1900-comments.json`
- `raw/github/hive-mind-pr-1908.json`
- `raw/github/lefinepro-kefine-pr-173.json`
- `raw/github/lefinepro-kefine-pr-173-conversation-comments.json`
- `raw/github/lefinepro-kefine-pr-173-review-comments.json`
- `raw/github/lefinepro-kefine-pr-173-reviews.json`
- `raw/github/lefinepro-kefine-pr-173.diff`
- `raw/github/lefinepro-kefine-pr-173-runs.json`
- `raw/logs/solution-draft-log-pr-1781180008338.txt`
- `raw/logs/solution-draft-log-pr-1781183077272.txt`
- `ci-logs/lefinepro-kefine-run-*.log`

The external PR was `lefinepro/kefine#173`, created on 2026-06-11 at 10:34:20 UTC and merged on 2026-06-11 at 13:25:07 UTC. Its conversation comments contained 1,095 comments. Among comments rendered as unrecognized events, the observed system subtypes were:

| Subtype            | Count | First observed       |
| ------------------ | ----: | -------------------- |
| `thinking_tokens`  |   732 | 2026-06-11T10:35:14Z |
| `status`           |     4 | 2026-06-11T11:03:12Z |
| `task_updated`     |     3 | 2026-06-11T12:10:20Z |
| `compact_boundary` |     2 | 2026-06-11T11:03:25Z |

Example event shapes from the captured comments:

```json
{
  "type": "system",
  "subtype": "thinking_tokens",
  "estimated_tokens": 50,
  "estimated_tokens_delta": 50,
  "uuid": "..."
}
```

```json
{
  "type": "system",
  "subtype": "compact_boundary",
  "compact_metadata": {
    "trigger": "auto",
    "pre_tokens": 117063,
    "post_tokens": 8499,
    "duration_ms": 84620
  }
}
```

## Root Cause

`src/interactive-mode.lib.mjs` already recognized several `system.*` subtypes used by Claude-style task events, but it did not recognize Codex lifecycle subtypes emitted during long turns. The fallback for unknown event types posts a public "Unrecognized Event" comment with raw JSON for debugging. That fallback is useful for new event discovery, but it is not acceptable for a high-frequency progress event.

The implementation also lacked a way to remember the GitHub comment ID returned by queued `postComment` calls. Grouping a stream of thinking events into one comment requires posting once and then editing that same comment. GitHub's REST issue-comments API supports both creating and updating PR conversation comments because PR conversation comments are issue comments; the handler already had a safe `editComment` path for PATCH updates.

Reference: [GitHub REST issue comments documentation](https://docs.github.com/rest/issues/comments).

## Behavioral Contract

The new behavior is:

1. Consecutive `system.thinking_tokens` events create one "Thinking..." comment.
2. Live updates edit that comment no more often than `CONFIG.MIN_THINKING_COMMENT_UPDATE_INTERVAL`.
3. The comment finalizes to "Thought for ..." when a non-thinking event arrives or `flush()` is called.
4. The raw JSON section contains the grouped array of thinking-token events for debugging.
5. `system.status` is verbose-log-only by default.
6. `system.compact_boundary` posts one context-compaction summary comment.
7. `system.task_updated` updates known pending tasks when possible and otherwise stays out of public PR comments.

## Test Evidence

The reproducing test was first run against the pre-fix behavior in a temporary worktree. The preserved log is `raw/logs/test-interactive-mode-before-fix-real.log`:

- Line 249: `Expected initial Thinking comment`
- Line 268: `Expected no unrecognized comments/edits, got 3`
- Lines 431-433: 111 passed, 2 failed

After the implementation, the same behavior is covered by `tests/test-interactive-mode-thinking-1900.mjs`. Final verification logs include:

- `raw/logs/test-interactive-mode-thinking-1900-after-fix.log`: 2 passed, 0 failed.
- `raw/logs/test-interactive-mode-after-fix.log`: 111 passed, 0 failed.
- `raw/logs/npm-lint.log`: `npm run lint` completed successfully.
- `raw/logs/npm-format-check.log`: `npm run format:check` completed successfully.
- `raw/logs/check-file-line-limits.log`: all checked files were within the 1,500-line limit.
- `raw/logs/npm-test.log`: all 243 selected default-suite test files passed.
