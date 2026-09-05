---
'@link-assistant/hive-mind': patch
---

Never merge hive-mind's own placeholder file, and restart when a pull request changes nothing.

`konard/audio-decomposer#1` was solved twice, both pull requests were auto-merged, and the complete diff of both was the `.gitkeep` hive-mind writes only so that an empty branch has something to open a pull request from. Two defects had to line up for that, and both are fixed here.

- **The placeholder is reverted before anything can merge it.** `cleanupClaudeFile()` ran after `startAutoRestartUntilMergeable()`, so with `--auto-merge` it was structurally guaranteed to be too late: on that pull request the revert commit is timestamped four seconds after the merge commit. It now runs before the watch loop and still after `verifyResults()`, which is the ordering issue #1516 actually asked for. As defense in depth, the watch loop reverts a placeholder that survived into its own diff — a crashed session, a resumed run — instead of merging it.
- **An appended placeholder is recognised as a placeholder.** The empty-pull-request detector matched an added `# .gitkeep file auto-generated at …` line, which the solver only writes when it *creates* the file; when the file already exists it appends `# Updated: <timestamp>` instead, and that reads as an ordinary modification. The diff was counted as real work, so the pull request looked mergeable and the auto-restart from issue #2119 never fired. The measurement now reconstructs both sides of the file and compares them with hive-mind's own generated lines removed, so created, appended and re-appended placeholders are all caught — while a genuine edit to a `.gitkeep` or `CLAUDE.md` the repository owns still counts as work.

The leak was not a one-off: `.gitkeep` on the default branch of `link-foundation/rust-ai-driven-development-pipeline-template` had accumulated eight solver-generated lines from eight merged pull requests, one of which also carried real changes. Each miss makes the next one certain, because a surviving file forces the append path that the detector could not see. The full reconstruction is in `docs/case-studies/issue-2211`.
