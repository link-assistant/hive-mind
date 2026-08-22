# Case Study: Issue #1813 - Duplicate summary for Codex tool run

- Issue: https://github.com/link-assistant/hive-mind/issues/1813
- Pull request: https://github.com/link-assistant/hive-mind/pull/1815
- Branch: `issue-1813-ab79cdd78da8`
- Related incident: https://github.com/link-foundation/relative-meta-logic/pull/175
- Date investigated: 2026-05-16

## Summary

`--auto-attach-solution-summary` is supposed to post hive-mind's automated
working-session summary only when the AI tool did not create a PR/issue comment
during the session. In the reported Codex run, Codex did create a PR comment,
but its comment started with the same visible heading used by the automated
summary: `## Working session summary`.

The duplicate happened because `isToolGeneratedComment()` treated the visible
heading text as a tool-generated marker. `checkForAiCreatedComments()` therefore
filtered out the real Codex-authored comment and concluded that zero AI comments
had been posted. The post-processing step then attached a second summary with
nearly the same content.

The fix is to stop using the human-visible heading as automation proof. New
automated summaries include a hidden marker, while legacy automated summaries
are still recognized by their standard footer.

## Timeline

All times UTC, 2026-05-16.

| Time     | Event                                                                                                           | Evidence                                          |
| -------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 22:29:55 | hive-mind session starts for `link-foundation/relative-meta-logic` PR #175 / issue #97.                         | raw log, session start line                       |
| 22:41:10 | Codex posts PR comment `4468434117`, authored by `konard`, beginning with `## Working session summary`.         | `raw/comment-made-by-codex-4468434117.json`       |
| 22:41:34 | hive-mind logs that issue comments after session start by `konard`, excluding tool-generated comments, are `0`. | `raw/solution-draft-log-pr-1778971297930.txt`     |
| 22:41:34 | hive-mind posts duplicate automated summary comment `4468434861`.                                               | `raw/extracted-duplicate-comment-4468434861.json` |

## Requirements

1. Preserve the behavior added for issue #1728: automated working-session
   summaries must not count as AI-authored comments on later iterations.
2. Count a Codex-authored comment as AI-created even when it uses
   `## Working session summary` as a natural visible heading.
3. Keep legacy automated summary comments detectable so old comments do not
   regress duplicate-prevention behavior.
4. Add a regression test that fails before the fix and passes after it.
5. Save the incident data in this case-study directory for future debugging.

## Root Cause

`src/solve.results.lib.mjs` calls `checkForAiCreatedComments()` before posting an
automatic summary. That function collects PR conversation comments through the
same issue-comment data model GitHub uses for pull requests: user login,
creation timestamp, and body text are available for filtering.

The relevant filter is `isToolGeneratedComment()` in `src/tool-comments.lib.mjs`.
Before this fix, `TOOL_GENERATED_COMMENT_MARKERS` included
`Working session summary`. That marker was too broad because it is visible copy,
not automation metadata. Codex can write that phrase in a real comment.

As a result:

1. The Codex-authored comment matched the broad marker.
2. `checkForAiCreatedComments()` skipped it as tool-generated.
3. The auto-attach check saw no AI comments after the session start.
4. `attachSolutionSummary()` posted another `## Working session summary`.

## Fix

- Added `WORKING_SESSION_SUMMARY_AUTOMATION_MARKER` as hidden automation
  metadata for newly generated summary comments.
- Added `WORKING_SESSION_SUMMARY_AUTOMATED_FOOTER` and explicit legacy detection
  so previously posted automated summaries are still excluded.
- Removed the visible `WORKING_SESSION_SUMMARY_MARKER` from the generic
  tool-generated marker list.
- Updated `attachSolutionSummary()` to include the hidden marker on new
  automated comments.
- Added `tests/test-issue-1813-codex-summary-dedup.mjs` to assert that the
  visible heading alone is not tool-generated, while hidden-marker and
  legacy-footer comments are still tool-generated.

## External Reference

- GitHub REST docs, "Working with comments": pull request conversation comments
  are accessed through issue-comment endpoints because a pull request is an
  issue with code.
  https://docs.github.com/en/rest/guides/working-with-comments
- GitHub REST docs, "Issues": the REST API considers every pull request an
  issue, which explains why issue comment fields are used for PR conversation
  comments.
  https://docs.github.com/en/rest/issues/issues

## Saved Data

- `raw/issue-1813.json` - issue body and metadata.
- `raw/issue-1813-comments.json` - issue comments; empty at investigation time.
- `raw/solution-draft-log-pr-1778971297930.txt` - 55,854-line run log from the
  issue, with opaque Codex `encrypted_content` payloads redacted.
- `raw/pr-175-conversation-comments.json` - conversation comments from the
  related PR.
- `raw/comment-made-by-codex-4468434117.json` - Codex-authored comment that was
  mistakenly ignored.
- `raw/extracted-duplicate-comment-4468434861.json` - duplicate automated
  summary posted by hive-mind.
