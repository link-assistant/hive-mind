# Case Study: Issue #1728 — No working session summary on auto restart/resume

- Issue: https://github.com/link-assistant/hive-mind/issues/1728
- PR: https://github.com/link-assistant/hive-mind/pull/1729
- Date: 2026-04-29
- Related prior work: [#1263](https://github.com/link-assistant/hive-mind/issues/1263) (introduced `--attach-solution-summary` / `--auto-attach-solution-summary`), [#1571](https://github.com/link-assistant/hive-mind/issues/1571) (gated post-processing on auto-resume), [#1625](https://github.com/link-assistant/hive-mind/issues/1625) (centralised tool-comment markers and ID tracking)

## Summary

The `--auto-attach-solution-summary` feature, which posts a "Solution summary" comment using the AI's last message when the AI itself produced no comment during a working session, only runs at the **end of `solve.mjs`'s top-level flow**. It is **not invoked** when an iteration is run inside `--auto-restart-until-mergeable` (`src/solve.auto-merge.lib.mjs`) or `--watch` / temporary auto-restart (`src/solve.watch.lib.mjs`). Both of those modes call `executeToolIteration()` (from `src/solve.restart-shared.lib.mjs`), upload a log comment, and then move on — the `toolResult.resultSummary` returned by the AI is silently discarded.

This is exactly the gap reported in `link-foundation/box` PR #83: a working session was triggered (`Auto-restart triggered (iteration 1)`) and ended (`Auto-restart-until-mergeable Log (iteration 1)`), but no AI conclusions / summary appeared between them. The user has no visibility into what the AI actually decided or did inside that iteration.

The issue also asks for terminology unification: the user-facing comment header should be **"Working session summary"** rather than "Solution summary", because not every working session is a solution draft — many are continuation/restart iterations that are part of an in-progress solution.

## Timeline of the reproducing incident (link-foundation/box PR #83)

All times UTC, 2026-04-29.

| Time        | Event                                                                                                                                                                        | Source                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 14:58:56    | `🤖 AI Work Session Started` posted on PR #83 (`isContinueMode + autoContinue`)                                                                                              | comment id `4344938702`                                                                           |
| 15:13:49    | AI posts its own `## Solution summary` comment from inside that session                                                                                                      | comment id `4345042341`                                                                           |
| 15:13:58    | `🤖 Solution Draft Log` (cost + log gist) posted by `solve.mjs` post-processing                                                                                              | comment id `4345043806`                                                                           |
| 15:28:40    | `## 🔄 Auto-restart triggered (iteration 1)` — `--auto-restart-until-mergeable` decides to run another iteration because `Reason: CI failures detected; Uncommitted changes` | comment id [`4345164478`](https://github.com/link-foundation/box/pull/83#issuecomment-4345164478) |
| 15:28–16:06 | `executeToolIteration()` runs the AI tool inside the auto-restart loop. The AI eventually exits without posting any comment of its own.                                      | `src/solve.auto-merge.lib.mjs:596`                                                                |
| 16:06:10    | `## 🔄 Auto-restart-until-mergeable Log (iteration 1)` — log upload only; **no working session summary**                                                                     | comment id [`4345439482`](https://github.com/link-foundation/box/pull/83#issuecomment-4345439482) |

Saved sources:

- `data/issue-1728.json` — issue body
- `data/box-pr-83.json` — PR metadata
- `data/box-pr-83-comments.json` — full comment history of PR #83
- `data/comment-auto-restart-triggered-4345164478.json` — start-of-iteration comment
- `data/comment-auto-restart-log-4345439482.json` — end-of-iteration log comment (no AI conclusions in between)

## Requirements (extracted from the issue)

1. **Unify working session logic.** The summary-attachment behaviour must apply to _every_ working session, not just the top-level `solve.mjs` flow.
2. **Auto-attach last AI message when there's no AI comment.** If a working session ends without the AI posting any comment, post the AI's last message as an automated comment.
3. **Rename "Solution summary" → "Working session summary"** to be accurate (a session may be a continuation, restart or resume rather than the original solution draft).
4. **Compile case-study data into `./docs/case-studies/issue-1728/`.**
5. **Reconstruct the timeline / sequence of events.**
6. **List all requirements explicitly.** (this section)
7. **Find root causes.** (next section)
8. **Propose solutions and existing components.** (Solutions section)
9. **Add debug output / verbose mode** if data is insufficient for next iteration.
10. **File upstream issues** if the bug touches another repository — N/A here, the bug is fully inside `link-assistant/hive-mind`.

## Root cause analysis

### Where the summary is currently attached

`src/solve.mjs:1107-1140` is the only call site of `attachSolutionSummary` and `checkForAiCreatedComments`. It runs once, after the _parent_ solve flow's main tool execution returns. Auto-restart-until-mergeable and watch-mode iterations happen **after** this point (or replace it entirely when the parent process is the one doing the watching), so this call is bypassed for those iterations.

```js
// src/solve.mjs:1107
if (success && resultSummary && (argv.attachSolutionSummary || argv.autoAttachSolutionSummary)) {
  ...
  if (argv.autoAttachSolutionSummary) {
    const aiCreatedComments = await checkForAiCreatedComments(workStartTime, owner, repo, prNumber, issueNumber);
    if (!aiCreatedComments) {
      await attachSolutionSummary({ resultSummary, prNumber, issueNumber, owner, repo });
    }
  }
}
```

### Where iterations actually happen and discard the summary

`src/solve.auto-merge.lib.mjs:596-895` — `watchUntilMergeable()` calls `executeToolIteration()` and on success only attaches the _log_ (gist + cost), then loops. The `toolResult.resultSummary` returned by `executeClaude()` / `executeOpenCode()` / `executeCodex()` / `executeAgent()` is never consulted.

```js
// src/solve.auto-merge.lib.mjs:596
const toolResult = await executeToolIteration({ ... });
...
} else {
  // Success - capture latest session data
  ...
  // Attach log if enabled
  if (prNumber && shouldAttachLogs) {
    ...
    await attachLogToGitHub({ ... });
  }
  // ← BUG: nothing here looks at toolResult.resultSummary, so the AI's
  //   last message is dropped on the floor when no AI comment was posted.
}
```

`src/solve.watch.lib.mjs:235-410` has the symmetric gap for `--watch` / temporary auto-restart iterations.

### Why this is a _unification_ problem rather than a bug fix in one place

Every place the AI runs is a "working session". Today only one of them honours `--auto-attach-solution-summary`. The cleanest fix is therefore to factor the summary-attachment decision into a single helper that all three call sites use:

- `src/solve.mjs` (parent, end-of-run)
- `src/solve.auto-merge.lib.mjs` (auto-restart-until-mergeable iterations)
- `src/solve.watch.lib.mjs` (watch-mode / temporary auto-restart iterations)

### Why renaming "Solution summary" → "Working session summary" is correct

The original "Solution summary" header (added in #1263) was named when the only call site was the end of the solution draft. Now that the same comment will be posted at the end of _any_ iteration — including continuations and restarts that aren't really "the solution" — the more accurate label is **"Working session summary"**. The existing `--attach-solution-summary` / `--auto-attach-solution-summary` CLI flag names are kept (renaming flags is a breaking change with no benefit); only the user-facing comment header changes.

## Solution

### Implementation plan

1. **Extract the auto-attach decision into a helper** (`maybeAttachWorkingSessionSummary`) in `src/solve.results.lib.mjs`. It encapsulates: "if `--attach-solution-summary` is set, attach unconditionally; if `--auto-attach-solution-summary` is set, attach only when no AI comment was posted since the iteration's `workStartTime`."
2. **Rename the comment header** in `attachSolutionSummary` from `## Solution summary` to `## Working session summary`. Keep the function name and CLI flag names for backwards compatibility — this matches the issue's "it can be named `Working session summary`" guidance.
3. **Wire the helper into `solve.auto-merge.lib.mjs`** on every successful iteration: capture an `iterationStartTime` immediately before `executeToolIteration()`, then call `maybeAttachWorkingSessionSummary(...)` after the log upload using `toolResult.resultSummary` and `iterationStartTime`.
4. **Wire the same helper into `solve.watch.lib.mjs`** on every successful iteration, with the same iteration-scoped `workStartTime`.
5. **Replace the inline block in `solve.mjs:1107-1140`** with a call to the same helper, so all three call sites converge on identical behaviour.
6. **Tests**: add unit tests under `tests/` that simulate `executeToolIteration` returning a `resultSummary` and verify the helper posts the new "Working session summary" comment when `checkForAiCreatedComments` reports no AI comments, and skips when it does.

### Existing components reused

- `attachSolutionSummary` (already exists in `src/solve.results.lib.mjs:1195`) — the actual gh-comment posting.
- `checkForAiCreatedComments` (already exists, same file:1074) — already filters out tool-generated comments via `tool-comments.lib.mjs` markers, including `AUTO_RESTART_MARKER` and `AUTO_RESTART_UNTIL_MERGEABLE_LOG_MARKER`. No changes needed there.
- `postTrackedComment` (in `tool-comments.lib.mjs`) — used by `attachSolutionSummary`; ensures the new working session summary itself is tracked and won't be mistaken for AI-authored content on a later iteration.

No external library is needed; this is purely a wiring fix that consolidates already-shipped code.

### Backwards compatibility

- CLI flag names unchanged (`--attach-solution-summary`, `--auto-attach-solution-summary`, and `--no-auto-attach-solution-summary`).
- Default behaviour unchanged for the top-level flow (`--auto-attach-solution-summary` is still on by default per `src/solve.config.lib.mjs:506`).
- Only addition: the same default now also applies to auto-restart-until-mergeable and watch-mode iterations, so users who already opted in to the default get fuller coverage.
- Comment header renamed `## Solution summary` → `## Working session summary`. Existing tooling that scrapes for this header would need to update its match string. The marker constant `SOLUTION_SUMMARY_MARKER` (in `tool-comments.lib.mjs`) is also updated to match.

## Debug / verbose

`checkForAiCreatedComments` already emits verbose logs of every comment it counts and skips. The new helper logs `📝 Attaching working session summary...` / `ℹ️ AI created comments during session, skipping working session summary attachment` so the iteration's decision is easy to trace.

## Upstream issues

None. The bug is entirely in `link-assistant/hive-mind`.
