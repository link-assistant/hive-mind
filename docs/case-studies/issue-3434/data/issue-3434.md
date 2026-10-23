# #3434 Failed run marks a placeholder [WIP] pull request ready for review at run end (#2312 restore skips the #1162 placeholder check) [OPEN]

## Summary

When the AI tool fails (here: the Claude CLI was killed by the cgroup OOM killer, exit 137), the run-end restore from #2312 (`restoreDeliberateDraftsAtRunEnd`, `src/pr-draft-state.lib.mjs:206`) converts the pull request to **ready for review** even when the PR still has the `[WIP]` title and the placeholder description that `solve.auto-pr` created. The placeholder checks from #1162 (`hasPRTitlePlaceholder` / `hasPRBodyPlaceholder`, `src/solve.results.lib.mjs:83-94`) run only on the success path in `verifyResults`, so the failure path never sees them.

#3211 and #3330 already keep a PR in draft when the run changed nothing or the effect could not be verified. A PR whose title and description were never written is the same kind of false claim.

## Reproduction (real run, Hive Mind 2.35.8)

https://github.com/Godmy/stylist-svelte/pull/6, created by this run as a draft at 2026-10-13T21:12:14Z:

- 21:44:49 `❌ Claude command failed with exit code 137` (27 processes OOM-killed in the task cgroup).
- 21:45:36 "🚨 Solution Draft Failed … exit code 137" comment.
- 21:45:37–38, container log (`docker logs d5173fa1-9c62-4b9b-979f-5748624f3860`):
  ```
  🩹 PR #6 was left in draft by a working session (CLAUDE execution failed with Claude command failed with exit code 137); restoring its pre-run state at run end (…)
    📝 Converting PR:          To ready for review (run end (CLAUDE execution failed with Claude command failed with exit code 137))...
  ✓ Pull request Godmy/stylist-svelte#6 is marked as "ready for review"
  ```
  The PR timeline shows `ready_for_review` at 21:45:38. The PR had no pre-run state: this run created it as a draft.

The PR is still open, non-draft, titled `[WIP] Hive Mind refactoring`, with the "Work in Progress" placeholder body, and its only diff is screenshots plus submodule pointers to commits that do not exist upstream (#3433). Reviewers are asked to review something the AI never finished.

The same run-end restore also ran in https://github.com/links-games/master-plan/pull/2 (Codex OOM-killed, exit 137 → ready at 2026-10-15T21:03:07Z). There the title had been written and the PR was ready before the run, so that one matches #2312's design.

## Expected

At run end, a PR stays a draft (with a one-line log reason, like the existing `no_session_changes` and `session_effect_unverified` cases) when:

- its title still starts with `[WIP]`, or
- its body still matches `PR_BODY_PLACEHOLDER_PATTERNS`,

and the run ended with a tool failure. The failure comment already explains why.

## Workaround

None automatic; a human has to convert such PRs back to draft.

## Suggested fix in code

In `restoreDeliberateDraftsAtRunEnd` (`src/pr-draft-state.lib.mjs`), before `ensurePullRequestIsReady(... force: true)`, fetch `title,body` (one `gh pr view --json title,body,isDraft,state`) and skip with reason `placeholder_pr` when `hasPRTitlePlaceholder(title) || hasPRBodyPlaceholder(body)`. Move the two helpers to a small shared module so `pr-draft-state` does not import `solve.results`. Add a test next to the #3211 / #3330 tests: failed session + placeholder title → stays draft; failed session + real title on a PR that was ready before the run → restored to ready (unchanged #2312 behaviour).

Related: #2312, #3211, #3330, #1162, #2845 (item 2, log wording around the same restore).

## Comments
