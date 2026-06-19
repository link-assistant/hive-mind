---
'@link-assistant/hive-mind': patch
---

fix(auto-merge): treat timeout-cancelled CI as a failure and never finish a session with no log when `--attach-logs` is enabled (#1952)

A job that hits its `timeout-minutes` limit surfaces as a **check-run** with
conclusion `cancelled`, but the **parent workflow run** concludes `failure`.
`getDetailedCIStatus` only inspects check-runs, so the auto-merge loop saw the
lone `cancelled` check, posted a **"Cancelled CI/CD Requires Review"** comment and
stopped — even though the workflow run had failed and other jobs in it had failed
too. The cancelled branch of `getMergeBlockers` now cross-references the workflow
runs for the commit SHA via a new pure helper
`classifyCancelledCIByWorkflowRuns` (`src/cancelled-ci-rerun.lib.mjs`):

- a run still queued/in-progress → `ci_pending` (wait until **all** checks reach a
  terminal state before auto-restarting);
- any completed `failure`/`timed_out`/`startup_failure` run → `ci_failure` (the AI
  is restarted to fix it, instead of stopping for human review);
- otherwise → the original re-triggerable `ci_cancelled` flow (genuine manual
  cancellation). The "requires review" stop path is skipped whenever a `ci_failure`
  blocker coexists, and `startup_failure` is now counted as a failing run in the
  branch-health check too.

Separately, the same session finished with **no log attached** despite
`--attach-logs` being enabled, because every attach path in `solve.mjs` is
conditional and the stop-for-review exits can return before any iteration uploads.
`attachLogToGitHub` now records a process-global `logAttachedToGitHub` flag on
every successful upload, and a final safety net (`attachFinalLogIfMissing` in the
new `src/attach-logs-guarantee.lib.mjs`) attaches the cumulative session log at the
end of `solve.mjs` whenever `--attach-logs` is on, a PR exists, and nothing has
attached a log yet. A session can no longer finish with no log when `--attach-logs`
is enabled.

Adds `tests/test-cancelled-timeout-fail-1952.mjs` (13 tests) and
`tests/test-attach-logs-safety-net-1952.mjs` (9 tests), plus a deep case study in
`docs/case-studies/issue-1952/` reconstructed from the real-world trigger
(xlabtg/teleton-agent PR #670).
