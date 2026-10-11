---
'@link-assistant/hive-mind': minor
---

feat(prompts): nudge the AI to fix all CI/CD even when failures are inherited (#1887)

Under `--auto-restart-until-mergeable` (also implied by `--auto-merge`), the solver
restarts the AI session until the pull request is mergeable. If the AI decides a
failing CI/CD check is pre-existing or inherited from another branch and merely asks
a human for a decision instead of fixing it, the loop cannot converge without a
human and keeps restarting until the iteration limit — burning iterations and money
(observed in `lefinepro/kefine#170`).

To raise the probability the AI fixes the checks itself — without forcing it — this
adds soft `When x, do y.` guidance in two complementary places:

- The shared auto-restart feedback prompt (`buildAutoRestartInstructions()` in
  `src/solve.restart-shared.lib.mjs`, used by every tool and by watch mode) now says
  to fix any failing check even if it looks pre-existing/inherited/unrelated,
  explains that the session auto-restarts until mergeable so leaving a check
  unaddressed loops indefinitely, and frames repository-wide breakage as in scope
  unless the scope is explicitly restricted — while still allowing the AI to attempt
  its best fix and then leave a clear comment if a human decision is truly required.
- The base system prompt of all six tools (claude, codex, gemini, qwen, agent,
  opencode) gains two `When x, do y.` statements: fix failing CI/CD even when the
  failure looks pre-existing/inherited/unrelated, and keep the default branch clean
  by assuming the scope of all fixes is the entire repository unless the user
  explicitly restricts it.

Covered by `tests/test-issue-1887-ci-fix-prompt.mjs`. A deep case study is compiled
under `docs/case-studies/issue-1887/`.
