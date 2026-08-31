# Case Study — Issue #1887: AI does not fix inherited CI/CD failures under `--auto-restart-until-mergeable`

> **Executive summary.** When `--auto-restart-until-mergeable` is enabled and a pull
> request's CI/CD stays red, the solver restarts the AI for every iteration until the
> PR becomes mergeable. In PR [`lefinepro/kefine#170`](https://github.com/lefinepro/kefine/pull/170)
> the only red check (`E2E Tests`) was **pre-existing breakage inherited from another
> PR (#168)**. The AI correctly diagnosed this, but — because nothing in the prompt told
> it that fixing inherited/repository-wide breakage was in scope — it chose to **ask a
> human for a decision** instead of fixing it. With no human in the loop, the auto-restart
> kept firing and the run burned iterations and money ($16+ by iteration 2) without ever
> moving the PR toward mergeable. This case study reconstructs the timeline, identifies the
> root cause, and documents the prompt changes that raise the probability the AI fixes the
> CI/CD itself.

|                        |                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Issue**              | [link-assistant/hive-mind#1887](https://github.com/link-assistant/hive-mind/issues/1887)                                              |
| **Pull request (fix)** | [link-assistant/hive-mind#1888](https://github.com/link-assistant/hive-mind/pull/1888)                                                |
| **Triggering run**     | [`lefinepro/kefine#170`](https://github.com/lefinepro/kefine/pull/170) (issue [#166](https://github.com/lefinepro/kefine/issues/166)) |
| **Mode involved**      | `--auto-restart-until-mergeable` (also implied by `--auto-merge`)                                                                     |
| **Type**               | Prompt-engineering / agent-behavior bug                                                                                               |
| **Status**             | Fixed in PR #1888                                                                                                                     |

## Problem statement

`--auto-restart-until-mergeable` is designed to keep restarting the AI session until the
PR is mergeable (CI green, no conflicts, no uncommitted changes). The design assumes each
restart nudges the AI to make the PR mergeable. That assumption breaks when the AI decides
the failing check is **not its responsibility** — for example because the failure existed
before the PR or was introduced by a _different_ PR on the base branch. In that case the AI:

1. correctly proves the failure is pre-existing,
2. concludes it is "out of scope" for the current task,
3. posts a "needs a human decision" status and ends the session,
4. … and the auto-restart loop immediately starts another identical session, because CI is
   still red.

The result is a loop that cannot converge without a human, even though the _intent_ of
`--auto-restart-until-mergeable` is to reach a mergeable state autonomously.

## Timeline of events (reconstructed)

All times UTC, from the PR #170 comment history and the
[solution-draft log gist](https://gist.githubusercontent.com/konard/314ebfa6f3f1bf331371ef2057aa84d7/raw/8c11a19043f6b93e55aeb2ffa6f8a85d07637446/solution-draft-log-pr-1781124475151.txt)
(`data/` holds the saved excerpts):

| Time        | Event                                                                                                                                                                                                                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17:34       | `solve` starts on kefine issue #166 ("move the logout button"), opens PR #170 against `release`.                                                                                                                                                                                                                       |
| 17:40–17:41 | The newly-added sign-out e2e test passes on `chromium` and `mobile-chromium`.                                                                                                                                                                                                                                          |
| 17:46       | First working session ends; PR opened. `--auto-restart-until-mergeable` mode goes active.                                                                                                                                                                                                                              |
| 18:19       | **Auto-restart iteration 1** — "Reason: CI failures detected". `E2E Tests` is red.                                                                                                                                                                                                                                     |
| 19:04       | Maintainer (@Payel-git-ol) comments confirming placement; still no decision on E2E.                                                                                                                                                                                                                                    |
| 19:05       | Iteration-1 session ends with the fix committed.                                                                                                                                                                                                                                                                       |
| 19:30       | **Auto-restart iteration 2** — "Reason: CI failures detected" again.                                                                                                                                                                                                                                                   |
| 20:47       | AI posts **"Status — feature complete; E2E blocker is inherited, needs a human decision"** — it proves the 61 E2E failures are identical on the `release` base (`5893882`, run `27292145950`) and on the PR (run `27298783487`), adds **zero** new failures, and asks the maintainer to pick a path instead of fixing. |
| 20:48       | Iteration-2 log posted ($16.27 spent). Without a human reply, the loop would keep restarting up to the 5-iteration safety limit.                                                                                                                                                                                       |

See `data/pr-170-comment-timeline.txt` and `data/ai-decision-comments.md` for the raw records.

## Root cause

The prompts the AI received during auto-restart **did not make fixing inherited /
repository-wide breakage in scope.** Concretely (captured verbatim in
`data/auto-restart-prompt-before-fix.txt`):

- The auto-restart feedback only said:

  > `Ensure you comply with all CI/CD check requirements, and they pass.`

  A reasonable agent reads "comply with … _your_ CI/CD requirements" as "don't add new
  failures", which the PR already satisfied. Nothing said "fix failures you did not cause."

- The base system prompt had **no** statement telling the AI to (a) fix failing CI even when
  the breakage looks pre-existing/inherited, or (b) treat the whole repository as in scope to
  keep the default branch clean unless the user restricts the scope.
- `--auto-restart-until-mergeable` itself never communicates to the model that _it_ is the
  loop — so the model has no reason to know that "ask a human and stop" leads to an infinite
  restart rather than a graceful handoff.

So the AI did the locally-reasonable thing (escalate a genuinely large, arguably out-of-scope
test migration) which is globally wrong under this flag (it cannot converge).

This is **not** a logic bug in the restart machinery — the restart logic worked exactly as
designed. It is a **prompt/scope-communication** gap.

## The fix (PR #1888)

Two complementary, non-forcing nudges (the issue explicitly asked for "no forcing", using the
project's traditional `When x, do y.` phrasing, "or both"):

1. **Auto-restart feedback prompt** (`buildAutoRestartInstructions()` in
   `src/solve.restart-shared.lib.mjs`, shared by every auto-restart and watch iteration of
   every tool) now states that any failing CI/CD check must be fixed _even if it looks
   pre-existing/inherited/unrelated_, explains that the session **auto-restarts until
   mergeable so leaving it unaddressed loops indefinitely**, and says repository-wide breakage
   is in scope unless explicitly restricted — while still allowing the AI to attempt its best
   fix and _then_ leave a clear comment if a human decision is truly needed.

2. **System prompt** (`buildSystemPrompt()` for all six tools: claude, codex, gemini, qwen,
   agent, opencode) gains two `When x, do y.` statements:
   - _When CI or CD checks are failing … work to make them pass even if the failure looks
     pre-existing, inherited from another branch, or caused by a change unrelated to your
     task … only ask for human help after you have attempted a fix and are still blocked._
   - _When you find errors … anywhere in the codebase, keep the default branch in a clean and
     working state by fixing them. Unless the user explicitly restricts the scope, assume the
     scope of all fixes is the entire repository …_

Tests: `tests/test-issue-1887-ci-fix-prompt.mjs` asserts both nudges are present in the
auto-restart prompt and in every tool's system prompt (16 assertions).

See [`analysis.md`](./analysis.md) for the deep technical analysis,
[`requirements.md`](./requirements.md) for the requirement-by-requirement breakdown,
[`solutions.md`](./solutions.md) for considered alternatives, and
[`existing-components.md`](./existing-components.md) for related prior art in this repo.

## Why "no forcing"

The issue author was explicit: _"we should increase the probability by explaining in system
prompt, but no forcing."_ A hard gate (e.g. refusing to end a session while CI is red) was
deliberately **not** chosen because there are legitimate cases where a human decision really is
required (genuinely unrelated infra outages, secrets the agent cannot set, policy decisions). A
hard block would replace one bad loop with another. Instead the change shifts the agent's
_default_ toward fixing, while preserving the escape hatch of "attempt a fix, then ask".
