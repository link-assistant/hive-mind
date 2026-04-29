---
'@link-assistant/hive-mind': patch
---

Fix `/merge` to correctly detect active CI runs on the default branch — issue
#1722.

The `/merge` command merged PR #1719 even though a CI/CD workflow run was
still in progress on `main`. The merge triggered a new run, which cancelled
the previous one. Verbose log:

```
[VERBOSE] /merge: Checking for active CI runs on link-assistant/hive-mind branch main...
[VERBOSE] /merge: Error checking active runs on main: stdout maxBuffer length exceeded
[VERBOSE] /merge: No active CI runs on main branch. Ready to proceed.
```

Two compounding root causes in
[`src/github-merge.lib.mjs`](./src/github-merge.lib.mjs)
`getActiveBranchRuns()` (and the parallel
[`src/github-merge-repo-actions.lib.mjs`](./src/github-merge-repo-actions.lib.mjs)
`getAllActiveRepoRuns()` introduced by issue #1503):

1. **No `maxBuffer` override on `gh api --paginate --slurp`.** Node's default
   `child_process.exec` buffer is 1 MB; the unfiltered `actions/runs` response
   on this repo's `main` was 12.7 MB, so `exec` rejected with
   `stdout maxBuffer length exceeded`.
2. **Fetch errors became "no active runs".** The `catch` block returned
   `hasActiveRuns: false`, which the caller (`waitForBranchCI`) interpreted as
   "branch CI is idle, ready to merge". A transient fetch/buffer/parse error
   was indistinguishable from genuine idleness.

Fix:

- **Server-side `?status=` filter**, looped over the active set
  (`in_progress`, `queued`, `waiting`, `requested`, `pending`) with run-id
  dedup. Response size scales with active-run count, not with historical-run
  count — typically a few KB instead of 12+ MB.
- **Raise `exec` `maxBuffer` to `githubLimits.bufferMaxSize`** (10 MB, env
  `HIVE_MIND_GITHUB_BUFFER_MAX_SIZE`) for all `gh` calls in
  `github-merge.lib.mjs` and `github-merge-repo-actions.lib.mjs`. The existing
  `githubLimits` infrastructure was already used in `github.batch.lib.mjs`;
  this just wires it into the `/merge` paths.
- **Stop swallowing fetch errors as "idle".** Errors now propagate. The
  surrounding `waitForBranchCI` / `waitForAllRepoActions` poll loops already
  retry on the next tick; the timeout-final check has its own try/catch that
  returns an explicit failure (instead of a false-positive "ready to merge").

Tests:
[`tests/test-active-branch-runs-buffer-1722.mjs`](./tests/test-active-branch-runs-buffer-1722.mjs)
shadows `gh` on `PATH` with a Node script that scripts active-run responses,
and asserts: (a) every call uses `?status=`, (b) duplicate runs across
statuses are deduplicated, (c) >1 MB responses are handled cleanly, (d)
`gh` failures throw rather than report idle, (e) `waitForBranchCI` keeps
polling on errors, (f) idle branches still resolve as ready,
(g) `getAllActiveRepoRuns` parity.

Documentation:
[`docs/case-studies/issue-1722/`](./docs/case-studies/issue-1722/README.md)
contains the timeline (with downloaded bot log, cancelled-run logs, run
metadata), facts, per-symptom root-cause analysis, and solution plan.
[`experiments/issue-1722-buffer-overflow.mjs`](./experiments/issue-1722-buffer-overflow.mjs)
is a minimal reproduction. No upstream report required — the fix lives
entirely in this repo.
