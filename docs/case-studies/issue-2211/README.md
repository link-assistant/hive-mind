# Case study — issue #2211: no changes to the pull request were actually merged

- Issue: https://github.com/link-assistant/hive-mind/issues/2211
- Pull request: https://github.com/link-assistant/hive-mind/pull/2215
- Reported from: https://github.com/konard/audio-decomposer/pull/3#issuecomment-5470780416
- Raw evidence: [`data/`](./data) (issue/PR JSON, diffs, conversation comments, commit lists, file contents)
- Reproduction script: [`../../../experiments/issue-2211/reproduce-placeholder-not-detected.mjs`](../../../experiments/issue-2211/reproduce-placeholder-not-detected.mjs)
- Regression tests: [`../../../tests/test-placeholder-not-merged-2211.mjs`](../../../tests/test-placeholder-not-merged-2211.mjs)
- Date of the run under study: **2026-08-30**, 18:38–19:28 UTC

## 1. What happened, in one paragraph

`konard/audio-decomposer#1` ("Make a prototype") was solved twice by hive-mind. Both
runs produced a pull request, both pull requests were auto-merged, and **the complete
diff of both was hive-mind's own `.gitkeep` placeholder** — the file the solver writes
purely so that an empty branch has something to open a pull request from. Nothing was
implemented, the issue is still open, and the placeholder is now a permanent part of
`main`. Two independent defects had to line up for that:

1. **The placeholder was reverted after the merge, not before it.** On PR #3 the
   revert commit is timestamped **four seconds after** the merge commit. It landed on a
   branch nobody would ever look at again while the placeholder went to `main`.
2. **The empty-pull-request detector could not see this placeholder.** It recognised a
   placeholder the solver _created_, but the solver _appends_ to an existing one — and
   an append looks like an ordinary file modification. So the watch loop measured
   "1 file changed, 2 insertions, 1 deletion", concluded the pull request had content,
   and merged it instead of restarting the AI, which is exactly the safety net issue
   #2119 built for this situation.

Per the issue, the Codex refusal to implement anything is out of scope here and is
tracked in [#2190](https://github.com/link-assistant/hive-mind/issues/2190).

## 2. Timeline of events

All times UTC, 2026-08-30. Sources: [`data/audio-decomposer/`](./data/audio-decomposer)
— `issue-1.json`, `pr-2.json`, `pr-3.json`, the two `*-conversation-comments.json`
files, and the three commit lists.

| Time         | Event                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 08-28 08:05  | `konard/audio-decomposer` created from the `link-foundation/rust-ai-driven-development-pipeline-template` template — **including that template's already-polluted `.gitkeep`** |
| 18:38:27     | Issue #1 "Make a prototype" opened                                                                                                                                             |
| **18:52:16** | `3f884dad Initial commit with task details` — `.gitkeep` gains `# Updated: 2026-08-30T18:52:16.784Z`                                                                           |
| 18:52:26     | PR #2 opened from `issue-1-5ccb5a772fbc`                                                                                                                                       |
| 18:57:20     | Solution draft log posted ($1.94, GPT-5.6 Sol via Codex)                                                                                                                       |
| 18:59:36     | `🔄 Auto-restart 1/5` — CI failures                                                                                                                                            |
| 19:06:03     | The AI reports a configuration-only fix: "No repository files were changed"                                                                                                    |
| **19:09:11** | **PR #2 merged.** `.gitkeep` on `main` now carries the 18:52:16 line                                                                                                           |
| 19:09:14     | `416a1a2d Revert "Initial commit with task details"` — 3 seconds late, on the merged-away branch                                                                               |
| **19:20:07** | `798387a0 Initial commit with task details` — second run, `.gitkeep` gains `# Updated: …19:20:07.327Z`                                                                         |
| 19:20:18     | PR #3 opened from `issue-1-ead1e9e3d5f7`                                                                                                                                       |
| 19:25:23     | Working session summary: "This is an architectural change: the repository currently contains only the generic Rust sum template" — a design proposal, no code                  |
| 19:25:41     | Solution draft log posted ($1.60)                                                                                                                                              |
| **19:28:09** | **PR #3 merged** (`2bf2374e`)                                                                                                                                                  |
| 19:28:11     | `🎉 Auto-merged … All CI checks have passed` posted on PR #3                                                                                                                   |
| **19:28:13** | `79fb66bf Revert "Initial commit with task details"` — **4 seconds after the merge**                                                                                           |
| 09-05 12:32  | The human verdict on PR #3: "I need actual delivery here."                                                                                                                     |

The four-second gap is the whole of root cause 1, and it is reproducible from
[`data/audio-decomposer/branch-issue-1-ead1e9e3d5f7-commits.json`](./data/audio-decomposer/branch-issue-1-ead1e9e3d5f7-commits.json)
and [`data/audio-decomposer/main-commits.json`](./data/audio-decomposer/main-commits.json)
without any log files.

## 3. What was actually merged

`gh pr diff 3` in full ([`data/audio-decomposer/pr-3.diff`](./data/audio-decomposer/pr-3.diff)):

```diff
diff --git a/.gitkeep b/.gitkeep
index 0addba9..6f02f6b 100644
--- a/.gitkeep
+++ b/.gitkeep
@@ -1,3 +1,4 @@
 # .gitkeep file auto-generated at 2026-08-20T05:02:39.661Z for PR creation at branch issue-136-1491df405bd1 for issue https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/136
 # Updated: 2026-08-22T18:48:37.899Z
-# Updated: 2026-08-30T18:52:16.784Z
\ No newline at end of file
+# Updated: 2026-08-30T18:52:16.784Z
+# Updated: 2026-08-30T19:20:07.327Z
\ No newline at end of file
```

PR #2's diff is the same shape one line earlier. Note the header line: it still names
`issue-136` of the _template_ repository. `.gitkeep` on `konard/audio-decomposer@main`
after the merge ([`data/audio-decomposer/gitkeep-on-main-after-merge.txt`](./data/audio-decomposer/gitkeep-on-main-after-merge.txt)):

```
# .gitkeep file auto-generated at 2026-08-20T05:02:39.661Z for PR creation at branch issue-136-1491df405bd1 for issue https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/136
# Updated: 2026-08-22T18:48:37.899Z
# Updated: 2026-08-30T18:52:16.784Z
# Updated: 2026-08-30T19:20:07.327Z
```

### 3.1 The leak is systematic, not a one-off

The template repository the project was generated from shows the same file still
accumulating ([`data/template-repo/gitkeep-on-main.txt`](./data/template-repo/gitkeep-on-main.txt),
read 2026-09-05):

```
# .gitkeep file auto-generated at 2026-08-20T05:02:39.661Z for PR creation at branch issue-136-1491df405bd1 for issue .../issues/136
# Updated: 2026-08-22T18:48:37.899Z
# Updated: 2026-08-28T10:38:14.973Z
# Updated: 2026-08-28T21:04:13.530Z
# Updated: 2026-09-02T07:47:08.699Z
# Updated: 2026-09-03T19:33:41.943Z
# Updated: 2026-09-05T09:16:18.154Z
# Updated: 2026-09-05T09:28:16.738Z
```

Eight solver-generated lines on the default branch, each from a different merged pull
request, and every timestamp matches an `Initial commit with task details` in
[`data/template-repo/gitkeep-commit-history.txt`](./data/template-repo/gitkeep-commit-history.txt).
The most recent, `2026-09-05T09:28:16`, rode in on PR #152 — a pull request that _did_
implement something, which shows the bug is not limited to empty pull requests: whenever
a run reaches the merge, the placeholder rides along.

That file is also self-reinforcing. Because it is never cleaned up, the next run takes
the `fileExisted && existingContent` branch of `src/solve.auto-pr.lib.mjs` and appends
instead of creating — which is precisely the shape the detector could not recognise. One
missed cleanup guarantees every later cleanup is missed as well.

## 4. Requirements from the issue

| #   | Requirement (from the issue text)                                                                                          | Where it is addressed                                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Bug 1: "we didn't revert change to `.gitkeep` file"                                                                        | §6.1 — cleanup moved before the watch loop, plus an in-loop guard                                                                              |
| R2  | Bug 2: "we didn't catch the situation, where no changes to pull request and didn't start the auto-restart/resume sequence" | §6.2 — the detector now recognises the appended placeholder                                                                                    |
| R3  | Codex refusal is out of scope (tracked in #2190)                                                                           | Not touched here                                                                                                                               |
| R4  | Download all logs and data about the issue into this repository                                                            | [`data/`](./data)                                                                                                                              |
| R5  | Compile it under `./docs/case-studies/issue-2211`                                                                          | This document                                                                                                                                  |
| R6  | Reconstruct the timeline/sequence of events                                                                                | §2                                                                                                                                             |
| R7  | List each and every requirement                                                                                            | This table                                                                                                                                     |
| R8  | Find the root cause of each problem                                                                                        | §5                                                                                                                                             |
| R9  | Propose solutions and solution plans per requirement                                                                       | §6                                                                                                                                             |
| R10 | Check known existing components/libraries that solve a similar problem                                                     | §7                                                                                                                                             |
| R11 | If the data is insufficient, add debug output / verbose mode for the next iteration                                        | §8 — the data was sufficient; the new `placeholderSections` figure and the `🧹 Placeholder in diff:` log line make a recurrence self-reporting |
| R12 | Report issues to other affected repositories with reproductions, workarounds and fix suggestions                           | §9                                                                                                                                             |
| R13 | Apply the requirements to the _entire_ codebase — fix every place with the same issue                                      | §6.3                                                                                                                                           |

## 5. Root causes

### RC-1 — the cleanup ran after the merge loop (R1)

`src/solve.mjs` called

```js
await startAutoRestartUntilMergeable(...);   // blocks until merged, or gives up
...
await cleanupClaudeFile(tempDir, branchName, claudeCommitHash, argv);
```

The ordering is deliberate: commit `50e3e433` (2026-04-01) moved `cleanupClaudeFile()`
_after_ the completion signals for issue
[#1516](https://github.com/link-assistant/hive-mind/issues/1516), because running it
earlier pushed a cleanup commit while `verifyResults()` was still deciding whether the
work was done. That reasoning covers "after `verifyResults()`". It does not cover "after
the loop whose entire job is to merge the branch". With `--auto-merge`, the loop can only
finish by merging, so the cleanup was structurally guaranteed to be too late — the four
seconds in §2 are not a race that sometimes goes the other way.

### RC-2 — the placeholder detector only knew the "created" shape (R2)

`src/pull-request-changes.lib.mjs` (added for issue
[#2119](https://github.com/link-assistant/hive-mind/issues/2119)) matched a placeholder
by a single _added_ line:

```js
const PLACEHOLDER_CONTENT_PATTERNS = new Map([
  ['.gitkeep', [/^\+#\s*\.gitkeep file auto-generated at .+ for PR creation at branch /m]],
  ['CLAUDE.md', [/^\+Issue to solve: \S+/m, /^\+Your prepared branch: \S+/m]],
]);
```

`src/solve.auto-pr.lib.mjs` only writes that line when the file does not exist yet. When
it does exist it appends:

```js
finalContent = `${existingContent.trimEnd()}\n# Updated: ${timestamp}`; // .gitkeep
finalContent = `${trimmedExisting}\n\n---\n\n${taskInfo}\n\nRun timestamp: ${timestamp}`; // CLAUDE.md
```

In that diff the auto-generated line is _context_, not an addition, so no pattern
matched, the section counted as a real file change, `hasChanges` was `true`, and
`isEmptyPullRequest` was `false`. The `📭 The pull request's net diff is empty` restart
path from #2119 — which was already wired to `shouldRestart = true` — was never reached.

RC-1 and RC-2 feed each other: RC-1 leaves the placeholder in the repository, which
forces the append path, which is the blind spot of RC-2.

Verified with [`experiments/issue-2211/reproduce-placeholder-not-detected.mjs`](../../../experiments/issue-2211/reproduce-placeholder-not-detected.mjs),
replaying the archived diffs through `measureDiff()`:

| Diff  | Before the fix                                          | After the fix                                            |
| ----- | ------------------------------------------------------- | -------------------------------------------------------- |
| PR #2 | `filesChanged: 1, +2, -1` → `hasChanges: true` (merged) | `filesChanged: 0` → `hasChanges: false, placeholderOnly` |
| PR #3 | `filesChanged: 1, +2, -1` → `hasChanges: true` (merged) | `filesChanged: 0` → `hasChanges: false, placeholderOnly` |

`filesChanged: 1` is also exactly what GitHub reported for those pull requests
(`data/audio-decomposer/pr-3.json` → `"files": [".gitkeep"]`), so the pre-fix numbers
were not a measurement error — the measurement was faithful and the _classification_ was
wrong.

## 6. Solutions

### 6.1 R1 — revert the placeholder before anything can merge it

Primary fix: `cleanupClaudeFile()` moves from after `startAutoRestartUntilMergeable()`
to immediately before it, still after `verifyResults()` so the #1516 invariant holds.
The pull request the watch loop then looks at is the pull request as it really is.

Defense in depth: `revertPlaceholderBeforeMerge()` in
`src/solve.auto-merge-guards.lib.mjs`. If the loop ever sees `placeholderSections > 0`
in its own measurement — a session that crashed before the cleanup, a `--auto-continue`
resume from a different working directory, a restart inside the loop — it reverts the
placeholder once and re-measures instead of merging it.

Both orderings are pinned by tests: `tests/test-premature-finish-signaling-1516.mjs`
(which asserted the _old_ ordering and now asserts the invariant that actually belongs
to #1516) and `tests/test-placeholder-not-merged-2211.mjs`.

### 6.2 R2 — recognise the placeholder in every shape it can take

`measureDiff()` no longer pattern-matches added lines. For a section touching a known
placeholder path it reconstructs both sides of the file from the hunks, removes the lines
hive-mind itself generates (the `.gitkeep` header and `# Updated:` lines; the CLAUDE.md
task block and `Run timestamp:`), and calls the section a placeholder only when what is
left is identical on both sides _and_ at least one generated line was involved. That
covers created, appended, re-appended, and appended-to-a-repository-owned file, while a
genuine edit to either file still counts as work — all eight combinations are asserted in
`tests/test-placeholder-not-merged-2211.mjs`.

With `hasChanges: false`, the existing #2119 machinery does the rest: the pull request
is not mergeable, `buildEmptyPullRequestBlocker()` names the placeholder, and
`shouldRestart = true` starts the auto-restart/resume sequence the issue asks for.

### 6.3 R13 — every place that answers "does this pull request contain changes?"

`getPullRequestChangeStats()` is the single such place, and all three of its callers
inherit the fix:

| Caller                                                            | What it does with the answer                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/solve.results.lib.mjs:766` (`verifyResults`, PR description) | Renders `formatChangeSummary()` — no longer claims "1 file(s) modified"  |
| `src/solve.results.lib.mjs:1329` (working session summary)        | No longer reads as a report of completed work                            |
| `src/solve.auto-merge.lib.mjs:329` (watch loop)                   | Refuses to merge, restarts the AI, and now reverts the placeholder first |

The ordering fix needs no counterpart elsewhere: `startAutoRestartUntilMergeable()` has
exactly one call site (`src/solve.mjs:1227`), and the other `cleanupClaudeFile()` call
sites — `solve.escalate.lib.mjs`, `solve.auto-ensure.lib.mjs`,
`solve.keep-working.lib.mjs` and `solve.mjs:1073` — belong to paths that never reach a
merge, so none of them could publish the placeholder.

### 6.4 Options considered and not taken

- **Never commit a placeholder; open the pull request from an empty commit**
  (`git commit --allow-empty`). This removes the class of bug rather than the bug, and it
  is what `docs/case-studies/issue-828-helm-chart-release-failure.md` already does to
  initialise a `gh-pages` branch. It is a larger change than this issue asks for and it
  interacts with `--auto-continue` (which needs _unique_ content on each run — see the
  comment above the `timestamp` in `src/solve.auto-pr.lib.mjs`), so it is written down
  here as a follow-up rather than done here.
- **Match the placeholder by path alone.** Rejected: a repository may legitimately own a
  `.gitkeep` or a `CLAUDE.md`, and hiding real edits to them would be a worse failure
  than the one being fixed. `tests/test-placeholder-not-merged-2211.mjs` asserts both
  directions.
- **Fix it only in the watch loop.** Rejected: the same wrong answer is published in the
  pull request description and used by `verifyResults()`.

## 7. Existing components and prior art (R10)

- **`git revert` / `git commit --allow-empty`** — hive-mind already uses the former in
  `cleanupClaudeFile()` (with a manual-revert fallback for conflicts); the latter is the
  standard way to open a pull request with no file changes and is the basis of §6.4.
- **`gh pr diff`** — the _net_ diff between base and head. This is the right primitive
  and hive-mind was already using it; per-commit `additions`/`deletions` from the API
  would have counted the placeholder commit and its revert as four changed lines.
- **Unified-diff parsers (`parse-diff`, `gitdiff-parser`, `diff`)** — evaluated, not
  adopted. The measurement is deliberately single-pass and copy-free for issue
  [#2135](https://github.com/link-assistant/hive-mind/issues/2135) (a 500 MB diff must
  not be materialised as an object tree), and the reconstruction needed here is ~25 lines.
- **`.gitattributes export-ignore` / `.gitignore`** — cannot help: the file must be
  committed for the pull request to exist, and issue
  [#1825](https://github.com/link-assistant/hive-mind/issues/1825) already handles the
  case where the target repository gitignores it.
- **Prior hive-mind work in this area** — #1436/#2160 (verify the cleanup actually
  removed the file), #1791 (do not revert a placeholder the user has since edited),
  #1516 (do not clean up before results are verified), #2119 (an empty pull request is
  not a result). This issue is the missing edge of that set: cleanup must also happen
  before the _merge_, and the placeholder must be recognisable after it has been
  appended to.

## 8. Debug output (R11)

The archived data was sufficient to identify both root causes without any new tracing —
the commit timestamps prove RC-1 and the diffs prove RC-2 — so no speculative logging was
added. What was added makes a recurrence self-reporting rather than silent:

- `getPullRequestChangeStats()` returns `placeholderSections`, so "a placeholder is still
  in this diff" is a fact any caller can act on instead of a pattern each caller re-guesses.
- The watch loop logs `🧹 Placeholder in diff: reverting the solver placeholder file
before it can be merged` at warning level whenever the primary fix has failed, which
  names the surviving path directly in the run log.
- The pre-existing `⚠️ PR is empty: only the solver placeholder file is in the diff`
  warning now actually fires for the appended shape.

## 9. Reports to other repositories (R12)

Both affected repositories were reported, each with the raw evidence, a reproduction, a
workaround and the code-level fix:

| Repository                                                     | Issue                                                                                              | State on the default branch     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| `konard/audio-decomposer`                                      | [#4](https://github.com/konard/audio-decomposer/issues/4)                                          | `.gitkeep` holds 4 solver lines |
| `link-foundation/rust-ai-driven-development-pipeline-template` | [#158](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template/issues/158) | `.gitkeep` holds 8 solver lines |

The pollution is a symptom of the defect fixed here rather than a defect of theirs, so
both issues say the same thing about the remedy: `git rm .gitkeep` (or truncating it to
empty) is a one-line change, but it is only durable once this fix is released —
otherwise the next run recreates the file and the accumulation restarts. Both also warn
against the obvious wrong workaround, gitignoring the file, which hive-mind refuses with
a root-cause message ([#1825](https://github.com/link-assistant/hive-mind/issues/1825)).
`konard/audio-decomposer#1` stays open: PR #2 and #3 closed nothing.

The exact state of both repositories is archived under [`data/`](./data) with timestamps,
so the cleanup can be verified afterwards.
