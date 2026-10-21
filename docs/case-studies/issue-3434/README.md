# Case study: issue #3434, "Failed run marks a placeholder [WIP] pull request ready for review at run end"

The issue text is in [`data/issue-3434.md`](data/issue-3434.md).

## Timeline (UTC, from the issue)

| Time                | Event                                                                                                                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-13 21:12:14 | Hive Mind 2.35.8 created [Godmy/stylist-svelte#6](https://github.com/Godmy/stylist-svelte/pull/6) as a draft, with the `[WIP]` title and the "Work in Progress" placeholder body from `solve.auto-pr`.                                |
| 21:44:49            | `❌ Claude command failed with exit code 137`: the cgroup OOM killer ended 27 processes.                                                                                                                                              |
| 21:45:36            | The "🚨 Solution Draft Failed … exit code 137" comment was posted.                                                                                                                                                                    |
| 21:45:37–38         | The run-end restore (#2312) logged `PR #6 was left in draft by a working session (…); restoring its pre-run state at run end` and converted the PR to ready for review. This run had created the PR, so there was no "pre-run state". |
| 2026-10-15 21:03:07 | The same restore ran on [links-games/master-plan#2](https://github.com/links-games/master-plan/pull/2). That PR had a real title and was ready before the run, so restoring it was correct.                                           |

## Requirements

| #   | Requirement                                                                                                | Status | Where                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | At run end, a PR whose title still starts with `[WIP]` stays a draft, with a one-line log reason           | Done   | `src/pr-draft-state.lib.mjs:241-253` (reason `placeholder_pr`)                                                                                              |
| 2   | The same when the body still matches `PR_BODY_PLACEHOLDER_PATTERNS`                                        | Done   | same block, using `hasPRBodyPlaceholder`                                                                                                                    |
| 3   | One `gh pr view --json title,body` read before `ensurePullRequestIsReady(... force: true)`                 | Done   | `src/pr-draft-state.lib.mjs:270` (`getPullRequestPlaceholderState`)                                                                                         |
| 4   | Move the placeholder helpers to a small shared module, so `pr-draft-state` does not import `solve.results` | Done   | `src/pr-placeholder.lib.mjs` (no dependencies), imported and re-exported by `src/solve.results.lib.mjs:73-74`                                               |
| 5   | A real title on a PR that was ready before the run is still restored to ready (#2312 unchanged)            | Done   | the restore continues as before when neither placeholder is found                                                                                           |
| 6   | A `gh` failure does not crash the run                                                                      | Done   | a failed read keeps the draft (reason `placeholder_check_failed`) and logs a warning (`src/pr-draft-state.lib.mjs:243-247`)                                 |
| 7   | Tests next to the #3211 / #3330 ones                                                                       | Done   | `tests/issue-3434-placeholder-pr-stays-draft.test.mjs`; the fake `gh` of `tests/deliberate-draft-restarts-ai-2312.test.mjs` now answers the title/body read |

## Root cause

`restoreDeliberateDraftsAtRunEnd` (#2312) restores every PR that a working session left in draft. A PR this run created is restored to "ready", since it would have been made ready on success. The #1162 placeholder checks (`hasPRTitlePlaceholder` / `hasPRBodyPlaceholder`) ran only on the success path, inside `verifyResults`. On the failure path, nothing looked at the title or body before `ensurePullRequestIsReady(... force: true)`. Earlier fixes (#3211 `no_session_changes`, #3330 `session_effect_unverified`) handled other "ready would be a false claim" cases, but not this one.

## Solution

- `src/pr-placeholder.lib.mjs` holds `PR_TITLE_PLACEHOLDER_PREFIX`, `PR_BODY_PLACEHOLDER_PATTERNS`, `hasPRTitlePlaceholder` and `hasPRBodyPlaceholder`. `solve.results.lib.mjs` imports them and re-exports them for existing callers.
- `getPullRequestPlaceholderState` reads `title,body` with one `gh pr view`. It returns `{ ok, title, body }`, where `title` and `body` are booleans saying whether each still has placeholder text, or `{ ok: false, error }`. It never throws.
- In `restoreDeliberateDraftsAtRunEnd`, the existing skip reasons (`human_draft`, `no_session_changes`, `session_effect_unverified`, and the new `unreachable_submodule_pointer` from #3433) still come first. The placeholder read comes next:
  - a placeholder title or body means `placeholder_pr`, and the PR stays a draft;
  - a failed read means `placeholder_check_failed`: the PR also stays a draft, because staying a draft is the safe default and the failure comment already explains the run.

## Tests

`tests/issue-3434-placeholder-pr-stays-draft.test.mjs` (11 cases) checks that:

- the helper module has no imports and is re-exported;
- a placeholder title and body, title only, or body only keeps the PR a draft;
- a real title on a PR that was ready before the run is restored (#2312);
- a real title on a PR created by this run is made ready;
- three `gh` failure modes (non-zero exit, invalid JSON, a throwing `$`) cause no crash, keep the draft and log a reason;
- missing fields are handled;
- the existing skip reasons win without a `gh` call.

## Remaining limits

- The restore reads the PR once at run end. If a human writes the title while the run is ending, the PR can stay a draft until the next run.
- A PR whose description was rewritten while the `[WIP]` title was kept stays a draft. The issue asks for this, since a `[WIP]` title is itself a placeholder.

## Upstream notes

None. The cause is in Hive Mind only.
