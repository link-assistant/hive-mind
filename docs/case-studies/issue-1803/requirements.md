# Requirements from Issue #1803

Pulled directly from the issue body, restated as discrete requirements
so each can be checked off:

1. **Find and fix the regression.** `--auto-fork` mode is broken and was
   working recently — identify the root cause and ship a fix.
2. **Preserve evidence.** Download all logs and data related to the
   failure into `./docs/case-studies/issue-{id}/`.
3. **Write a deep case study** in that folder containing at least:
   - reconstructed timeline / sequence of events,
   - full list of requirements from the issue,
   - root causes for each problem found,
   - proposed solution plans for each requirement,
   - a search for known existing components / libraries that solve
     similar problems or could help in the solution.
4. **Add debug output / verbose mode** if the existing logs are
   insufficient to diagnose the root cause, so the next iteration has
   more signal.
5. **Report related issues upstream.** If the bug touches any other
   repo / project, open issues there with a reproducible example,
   workarounds, and a suggested fix. _(Status: not applicable — the bug
   is purely internal to `link-assistant/hive-mind`. The external
   evidence repo (`labtgbot/telegram-claude-agent`) was a victim, not a
   cause.)_
6. **Single PR.** Plan and execute everything in one pull request (this
   is PR #1804).
7. **Run to completion.** Iterate until every requirement is fully
   addressed; context auto-compacts and work can continue.

## Implicit requirements (derived)

- The fix must preserve the #1332 contract (forks whose name differs
  from the base repo name still work).
- The fix must not change `setupRepository`'s public signature
  (callers in `solve.repo-setup.lib.mjs` already pass `forkRepoName`).
- The fix must not regress lint (`max-lines: 1500` on
  `src/solve.repository.lib.mjs`).
- The fix should add an automated regression test so the doubled-prefix
  lookup can't silently come back.
