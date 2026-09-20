# Case Study: Issue #1918 — `/merge` watch loop stuck for more than 1 hour

> **Status:** Root cause identified and fixed in PR #1919.
>
> **TL;DR:** On a **fork pull request** whose only repo workflows trigger on `push`
> (which never fires for fork commits in the base repo), an external check (CodeRabbit)
> reported CI status `success` while the repo's own PR-triggered workflows produced
> **0 workflow runs**. The auto-merge watch loop kept logging _"no workflow runs … (check
> 1/5)"_ but reset its safety-valve counter to `0` on every iteration because
> `ciStatus.status === 'success'`. The counter never reached `MAX_NO_RUNS_CHECKS`, so the
> safety valve never fired and `/merge` polled the same commit forever (73 minutes before
> a human killed it).

---

## 1. Summary

| Field                    | Value                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue                    | [#1918](https://github.com/link-assistant/hive-mind/issues/1918) — "CI/CD check stuck for more than 1 hour"                                                                             |
| Component                | `src/solve.auto-merge.lib.mjs` (watch loop) + `src/solve.auto-merge-helpers.lib.mjs` (`getMergeBlockers`)                                                                               |
| Affected feature         | `solve --auto-continue` / `/merge` auto-merge watch loop                                                                                                                                |
| Trigger scenario         | Fork PR + external-only check `success` + repo workflows that produce 0 runs for the commit                                                                                             |
| Observed symptom         | Watch loop repeats _"…0 workflow runs — likely race condition (check 1/5)"_ indefinitely                                                                                                |
| Stuck duration           | **73 minutes** (13:23:15Z → 14:36:23Z), **72 identical iterations**, then manual interruption                                                                                           |
| Real-world reproductions | [suenot/vasya#8](https://github.com/suenot/vasya/pull/8) (the captured logs), and reported [#9](https://github.com/suenot/vasya/pull/9), [#10](https://github.com/suenot/vasya/pull/10) |
| Root cause               | Caller reset `consecutiveNoRunsChecks` whenever `ciStatus.status !== 'no_checks'`, defeating the safety valve when status was `success` from external-only checks                       |
| Fix                      | Track a `noWorkflowRunsForCommit` flag in `getMergeBlockers` and only reset the counter when **not** still waiting for workflow runs (new pure helper `shouldResetNoRunsCounter`)       |

---

## 2. Data captured

All raw logs are stored under [`./logs/`](./logs/):

| File                                                                                 | Source gist                                                                                       | What it shows                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [`logs/before-stuck-pr-1781356866442.txt`](./logs/before-stuck-pr-1781356866442.txt) | [gist 28e096c9…](https://gist.githubusercontent.com/konard/28e096c913d048bb93a5aeb3bf263189/raw/) | The solve run that created `suenot/vasya#8` (issue suenot/vasya#1). Context before the hang. |
| [`logs/after-stuck-pr-1781361429724.txt`](./logs/after-stuck-pr-1781361429724.txt)   | [gist cff7c313…](https://gist.githubusercontent.com/konard/cff7c31382cdf274f11f4f10c437efe9/raw/) | The `/merge` watch run that got stuck on `suenot/vasya#8` and had to be killed manually.     |

> ⚠️ The logs were captured with `--attach-logs --verbose`. Token-like values are
> partially masked in the original gist (e.g. `a1a**********************************24a`).

### The PR in question (`suenot/vasya#8`)

Extracted verbatim from the captured GitHub API response in the log:

- **Base:** `suenot:master` (repo `suenot/vasya`, public, default branch `master`).
- **Head:** `konard:issue-1-d5192f2e83f0` on fork `konard/suenot-vasya` (`"fork": true`).
- **`author_association": "NONE"`** → external contributor / fork PR.
- **`"mergeable": true, "mergeable_state": "unstable"`** → mergeable but a status is missing/pending.
- **1 external check reported `success`**, **0 workflow runs** for the head SHA.

This is the canonical "external check passes, but the repo's own CI never ran for this
commit" shape that the watch loop is supposed to time out on — and didn't.

---

## 3. Timeline / sequence of events

All times UTC, from the captured logs.

| Time (Z)      | Event                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| 13:12:16      | `solve https://github.com/suenot/vasya/issues/1 … --auto … --verbose` starts (before-log).                      |
| 13:12:43      | Fork PR `suenot/vasya#8` created from `konard/suenot-vasya:issue-1-d5192f2e83f0`.                               |
| ~13:19        | AI solver finishes implementation, pushes commits, merges `master` into the branch.                             |
| 13:21:05      | before-log ends.                                                                                                |
| ~13:23        | `/merge` watch loop begins polling PR #8 (after-log).                                                           |
| **13:23:15**  | **First** _"CI status is 'success' (1 external checks) … 0 workflow runs — likely race condition (check 1/5)"_. |
| 13:25:20      | Iteration 2 — still _"check 1/5"_ (counter was reset to 0, re-incremented to 1).                                |
| 13:27 … 14:34 | 70 more identical iterations, ~125 s apart, **always "check 1/5"** — never 2/5, 3/5, etc.                       |
| **14:36:23**  | **Last** identical _"check 1/5"_ iteration (#72).                                                               |
| ~14:37:08     | Human interrupts the process. "Uploading interrupted session logs to Pull Request…".                            |

**Elapsed while stuck: 73 minutes / 72 iterations**, all reporting `check 1/5`. The
counter that is supposed to climb `1 → 2 → 3 → 4 → 5` and then trip the safety valve was
pinned at `1` the entire time.

---

## 4. Requirements (extracted from the issue)

The issue body asks for the following; each is addressed in this PR:

1. **Download all logs/data** related to the issue into `./docs/case-studies/issue-1918/`. → [`./logs/`](./logs/), this README.
2. **Deep case-study analysis** (incl. online research). → §3, §5, §6.
3. **Reconstruct the timeline / sequence of events.** → §3.
4. **List each and all requirements from the issue.** → this section.
5. **Find the root cause(s) of each problem.** → §5.
6. **Propose solutions / solution plans, checking known existing components/libraries.** → §6, §7.
7. **If not enough data, add debug output / verbose mode for the next iteration.** → §8 (verbose logging already existed and is what let us find the root cause first time; this PR keeps and slightly enriches it).
8. **If related to other repos, file issues there with repro + workaround + code-fix suggestions.** → §9 (conclusion: the bug is entirely inside hive-mind; `suenot/vasya` is only the _victim_ repo, so no upstream bug to file — documented below).
9. **Apply the fix to the entire codebase (fix every place the bug exists).** → §7 (audited; the reset logic lived in exactly one place, now centralized in a shared helper).
10. **Plan and execute everything in a single PR (#1919).** → this branch / PR.

---

## 5. Root cause analysis

### 5.1 The safety-valve mechanism (background)

`getMergeBlockers()` is called once per watch-loop iteration with a `checkCount`
argument. When a repo has PR-triggered workflows but **0 workflow runs** appear for the
head commit, GitHub may simply be slow to register runs (a real race condition that needs
waiting). To avoid both false positives ("ready to merge" too early) and infinite waits,
the design uses a **safety valve**:

- The watch loop keeps a per-SHA counter `consecutiveNoRunsChecks`.
- Each iteration it increments the counter and passes it as `checkCount`.
- Inside `getMergeBlockers`, once `checkCount >= MAX_NO_RUNS_CHECKS` (5), it stops waiting
  and concludes "CI was not triggered" (or trusts the external checks), letting the merge
  proceed or the loop exit.

For the valve to ever fire, **the counter must keep climbing across iterations for the
same commit.**

### 5.2 The bug

The watch loop reset the counter with this condition (`src/solve.auto-merge.lib.mjs`):

```js
// BEFORE (buggy)
if (ciStatus && ciStatus.status !== 'no_checks') {
  consecutiveNoRunsChecks = 0;
}
```

The intent was: _"if real CI checks exist, the no-runs counter is irrelevant — reset it."_
But `ciStatus.status` is `'success'` whenever **any** check passes — **including
external-only checks (CodeRabbit, CodeFactor, Codecov…)** that are unrelated to the repo's
own workflows.

Meanwhile, on the very same iteration, `getMergeBlockers` takes the
`ciStatus.status === 'success'` → "no workflow runs for this SHA" → "repo has PR-triggered
workflows" → `checkCount < MAX_NO_RUNS_CHECKS` branch and returns a `ci_pending` blocker
with the message _"…0 workflow runs — likely race condition (check N/5)"_.

So every iteration:

1. counter incremented to 1, passed as `checkCount=1`;
2. `getMergeBlockers` says "still waiting, check 1/5" (blocker present → don't merge);
3. caller sees `ciStatus.status === 'success'` → resets counter to **0**;
4. next iteration increments to 1 again → **GOTO 1**.

The valve threshold (5) was **never reachable**. Result: an infinite loop that pinned at
`check 1/5` for 73 minutes until a human intervened.

### 5.3 Why this specific PR triggered it

`suenot/vasya#8` is a fork PR by an external contributor (`author_association: NONE`).
The base repo's workflow(s) trigger on **`push`** (and/or require maintainer approval for
first-time fork contributors). A `push` event does **not** fire in the base repo for
commits that live on a fork, so **0 workflow runs** are ever produced for the PR's head
SHA in `suenot/vasya`. A separate external app (CodeRabbit) posted a passing check, which
made `ciStatus.status === 'success'`. That combination — **`success` from external-only
checks + 0 workflow runs forever** — is exactly the input the buggy reset mishandled.

This is closely related to the earlier fixes in **#1480** (workflow-run cross-validation),
**#1442/#1466** (CI-not-triggered detection), and **#1503** (per-SHA counter instead of
iteration count). #1503 introduced the per-SHA counter and the very reset line that #1918
now refines.

---

## 6. The fix

Centralize the reset decision in a small **pure, unit-testable** helper and make
`getMergeBlockers` tell the caller when it is still inside a "waiting for workflow runs"
state.

### 6.1 `getMergeBlockers` now reports `noWorkflowRunsForCommit`

`src/solve.auto-merge-helpers.lib.mjs`:

```js
export const getMergeBlockers = async (...) => {
  const blockers = [];
  // Issue #1918: true while we are still WAITING for PR-triggered workflow runs to register.
  let noWorkflowRunsForCommit = false;
  ...
  // set to true in each "keep waiting for workflow runs" branch, e.g. the success + 0-runs path:
  noWorkflowRunsForCommit = true;
  blockers.push({ type: 'ci_pending', message: `…0 workflow runs … (check ${checkCount}/${MAX_NO_RUNS_CHECKS})` });
  ...
  return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: false, noWorkflowRunsForCommit };
};
```

### 6.2 New pure helper `shouldResetNoRunsCounter`

```js
export const shouldResetNoRunsCounter = (ciStatus, noWorkflowRunsForCommit = false) => {
  // Still inside the no-workflow-runs safety-valve wait — the counter MUST keep climbing.
  if (noWorkflowRunsForCommit) {
    return false;
  }
  // Genuine CI checks exist (pending/success/failure backed by workflow runs).
  return Boolean(ciStatus && ciStatus.status !== 'no_checks');
};
```

### 6.3 The watch loop uses it

`src/solve.auto-merge.lib.mjs`:

```js
const { blockers, noCiConfigured, noCiTriggered, workflowRunConclusions, ciStatus, noWorkflowRunsForCommit } = await getMergeBlockers(owner, repo, prNumber, argv.verbose, consecutiveNoRunsChecks, prBranch);

// AFTER (fixed): do NOT reset while still waiting for workflow runs to register.
if (shouldResetNoRunsCounter(ciStatus, noWorkflowRunsForCommit)) {
  consecutiveNoRunsChecks = 0;
} else if (noCiConfigured || noCiTriggered) {
  // CI definitively determined — keep the counter as-is.
}
```

With the fix, the same fork-PR scenario climbs `1 → 2 → 3 → 4 → 5`, the safety valve fires
at iteration 5 (~5 × ~60–125 s ≈ a few minutes instead of forever), and `/merge` proceeds
to trust the available signal. The SHA-change reset from #1503 still works (a new push
resets the counter), and genuine CI (`pending`/`success` backed by real workflow runs)
still resets it.

---

## 7. Codebase-wide audit ("fix it in all places")

The reset logic existed in exactly **one** place — the auto-merge watch loop in
`src/solve.auto-merge.lib.mjs`. A repository-wide search for the pattern confirms there is
no second copy:

```
$ grep -rn "consecutiveNoRunsChecks\|status !== 'no_checks'" src/
src/solve.auto-merge.lib.mjs        (the watch loop — fixed)
src/solve.auto-merge-helpers.lib.mjs (getMergeBlockers + new helper)
```

The other `consecutiveNoRunsChecks = 0` assignments in the watch loop are **legitimate and
intentionally left unchanged**:

- on **SHA change** (new push → reset; issue #1503), and
- on **CI-mechanism disagreement** in the multi-mechanism consensus path.

Neither defeats the safety valve, because both correspond to genuinely new state. The fix
is therefore complete and centralized: the single reset decision now flows through
`shouldResetNoRunsCounter`.

---

## 8. Debug / verbose output

Verbose mode (`--verbose`) already emits the exact line that made this diagnosable:

```
[VERBOSE] /merge: PR #8 CI status is 'success' (1 external checks), but repo has
PR-triggered workflows with 0 workflow runs — likely race condition (check 1/5)
```

That output is what allowed the root cause to be pinpointed from the captured logs. It is
preserved. The key diagnostic signal of the bug is now also encoded as an automated
regression test (below), so the failure mode cannot silently return.

---

## 9. Related-repository assessment

The issue references external PRs ([suenot/vasya#8/#9/#10](https://github.com/suenot/vasya/pulls)).
After analysis, **the defect is entirely within `@link-assistant/hive-mind`** — `suenot/vasya`
is merely the _target_ repository whose (legitimate) fork-PR + push-triggered-workflow setup
exposed the watch-loop bug. There is **no bug to file against `suenot/vasya`**: a repo whose
workflows trigger on `push` and a fork PR producing 0 base-repo workflow runs is normal,
expected GitHub Actions behavior. The correct place to fix the hang is here, which this PR does.

(If anything, a _documentation_ note for users could suggest adding `pull_request` triggers
to workflows so fork PRs get CI — but that is advisory, not a bug report.)

---

## 10. Regression test

`tests/test-merge-stuck-no-workflow-runs-1918.mjs` imports the real
`shouldResetNoRunsCounter` helper and:

1. Asserts the helper returns `false` (do **not** reset) when `noWorkflowRunsForCommit` is
   true — even when `ciStatus.status === 'success'` (the exact #1918 input).
2. Asserts it still returns `true` for genuine CI checks when not waiting, and `false` for
   `no_checks`/`null` (preserving prior behavior).
3. Simulates the watch loop over repeated `success` + 0-runs checks for the **same SHA**
   and asserts the counter climbs to the safety valve (`>= 5`) — i.e. the loop terminates.
4. Reproduces the **old** buggy reset and asserts it stays pinned (valve never fires),
   proving the test actually captures the bug.
5. Guards the #1503 behaviors (SHA-change reset, real-CI reset) against regression.

Run:

```bash
node tests/test-merge-stuck-no-workflow-runs-1918.mjs
```

---

## 11. Existing components / prior art consulted

- **GitHub Actions semantics:** `push` events do not run in the base repo for fork
  commits; fork PRs use `pull_request`/`pull_request_target` and first-time contributors
  require manual approval (`action_required`). This is the documented behavior the watch
  loop must tolerate.
- **In-repo prior art:** #1480 (workflow-run cross-validation of `success`), #1442/#1466
  (CI-not-triggered detection), #1503 (per-SHA counter + extended CI-history valve). #1918
  is the natural completion of the #1503 safety valve: the valve existed but could be
  perpetually reset. No external library was needed; the fix is a 1-flag, 1-helper change
  to existing, well-tested code.
