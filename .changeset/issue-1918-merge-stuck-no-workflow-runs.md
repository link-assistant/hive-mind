---
'@link-assistant/hive-mind': patch
---

fix(auto-merge): stop `/merge` from hanging forever on fork PRs with external-only `success` checks (#1918)

The `/merge` auto-merge watch loop could spin on the same commit indefinitely
(observed 73 minutes, 72 identical iterations, before a human killed it). It
happened on a **fork pull request** whose only repo workflows trigger on `push`
(which never fires for fork commits in the base repo) while an external app
(CodeRabbit) reported CI status `success` with **0 workflow runs** for the head
SHA.

Root cause: the watch loop reset its consecutive "no workflow runs" safety-valve
counter (`consecutiveNoRunsChecks`) on every iteration whenever
`ciStatus.status !== 'no_checks'`. Because external-only checks make the status
`'success'`, the counter was pinned at `1` and never reached
`MAX_NO_RUNS_CHECKS`, so the valve that should have ended the wait never fired —
the loop logged `check 1/5` forever.

Fix: `getMergeBlockers()` now returns a `noWorkflowRunsForCommit` flag that is
true while it is still waiting for PR-triggered workflow runs to register, and a
new pure helper `shouldResetNoRunsCounter(ciStatus, noWorkflowRunsForCommit)`
only resets the counter when CI is **not** in that waiting state. The counter
now climbs `1 → 2 → … → 5`, trips the safety valve in a few minutes, and `/merge`
proceeds. The #1503 behaviors (reset on new push / on genuine CI runs) are
preserved and regression-guarded.

Added `tests/test-merge-stuck-no-workflow-runs-1918.mjs` and a full case study
with timeline, root-cause analysis, and the captured logs under
`docs/case-studies/issue-1918`.
