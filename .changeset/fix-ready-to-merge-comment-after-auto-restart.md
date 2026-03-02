---
'@link-assistant/hive-mind': patch
---

fix: post "Ready to merge" comment after auto-restart sequence with --auto-restart-until-mergeable (Issue #1371)

When `--auto-restart-until-mergeable` was used after a regular auto-restart sequence (triggered by uncommitted changes), the "Ready to merge" comment was silently suppressed because `checkForExistingComment` found a matching comment from a previous `solve` run.

The deduplication logic in `watchUntilMergeable` now uses an in-memory flag (`readyToMergeCommentPosted`) scoped to the current session, rather than searching all PR comment history. This correctly prevents duplicate comments within a single run while allowing new notifications when a fresh `solve` invocation starts.
