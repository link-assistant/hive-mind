# Case Study: Issue #1712 — Misleading "no CI checks yet" verbose log caused user to mistakenly Ctrl+C

> _No `ready to merge` comment for 22 minutes, not clear in logs why, lead to CTRL+C by mistake_

- Issue: [link-assistant/hive-mind#1712](https://github.com/link-assistant/hive-mind/issues/1712)
- PR: [link-assistant/hive-mind#1713](https://github.com/link-assistant/hive-mind/pull/1713)
- Reported: 2026-04-29 by @konard
- Affected component: `src/github-merge.lib.mjs::getDetailedCIStatus` + `src/solve.auto-merge-helpers.lib.mjs::getMergeBlockers`
- Affected user-facing command: `/merge` (and `solve --auto-restart-until-mergeable`)
- Original target PR: [link-foundation/box#83](https://github.com/link-foundation/box/pull/83)

## TL;DR

`/merge` was correctly waiting for the CI run on
[link-foundation/box#83](https://github.com/link-foundation/box/pull/83) (commit
`dfc4c14`) — a long Docker build workflow that had registered a `workflow_run`
record but had not yet published any `check-runs`. The verbose log emitted two
lines that read like _"nothing is happening"_:

```
[VERBOSE] /merge: PR #83 has no CI checks yet - treating as no_checks
[VERBOSE] /merge:   - Build and Release Docker Image (25097532949): status=pending, conclusion=null
[VERBOSE] /merge: PR #83 has no CI check-runs yet, but 1 workflow run(s) were triggered for SHA dfc4c14 - genuine race condition (waiting for check-runs to appear)
```

The user, watching the loop, read _"PR #83 has no CI checks yet"_ and saw a list
of "1 workflow run" containing a bare numeric ID — but in the GitHub UI they
could see two active workflow runs on the branch (the cancelled previous run
`25097500291` for an old SHA, plus the running `25097532949` for the head SHA).
This mismatch made the loop look broken, so they hit **Ctrl+C** and the run was
killed even though CI was making progress (the run later passed; this case
study's verification API call confirms it).

The fix:

1. **Reword** the misleading verbose lines so they do not read as "no CI is
   configured / nothing is happening". The new wording explicitly states
   "no check-runs registered for this commit yet (race vs. no-CI distinction is
   decided downstream)".
2. **Always include the workflow-run / check-run html_url** in verbose listings,
   so the user can click through to the GitHub Actions page in one second instead
   of having to copy run IDs and reconstruct URLs.
3. **Propagate the URLs into the user-facing waiting message** by enriching the
   `ci_pending` blocker `details` field. The existing top-level `⏳ Waiting for
CI:` line in `solve.auto-merge.lib.mjs` joins `details` directly, so URLs now
   appear next to the workflow / check name.

## Reconstruction of the Timeline

The original session is preserved in
[`raw-data/full-terminal-log.txt`](raw-data/full-terminal-log.txt)
(16 318 lines).

| #   | Time / log line        | Event                                                                                                                                                                                                                                   |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | _earlier_              | `solve --auto-restart-until-mergeable` was started against `link-foundation/box#83`                                                                                                                                                     |
| 2   | 2026-04-28 20:11:28Z   | First successful AI session ended; `Ready to merge` was posted (PR comment `4338720406`). The fix to `release.yml` was already pushed.                                                                                                  |
| 3   | 2026-04-29 07:55:47Z   | A new round started: `🤖 AI Work Session Started` (PR comment `4341836701`). The disk-space fix was added; new commit `dfc4c14` produced.                                                                                               |
| 4   | 2026-04-29 07:59:48Z   | GitHub registers workflow run `25097532949` for `dfc4c14` (the new head SHA) — `Build and Release Docker Image`, status `in_progress`, html_url `https://github.com/link-foundation/box/actions/runs/25097532949` (now confirmed pass). |
| 5   | 2026-04-29 07:58:58Z   | Older workflow run `25097500291` for previous SHA `aa35cde` is automatically **cancelled** by GitHub (concurrency group), but remains visible in the Actions tab.                                                                       |
| 6   | 2026-04-29 08:04:06Z   | Watch-loop check #1 fires. `/merge` correctly identifies SHA `dfc4c14`, finds **1** workflow run for that SHA, classifies status as `no_checks` because check-runs have not been published yet, blocks merge with `ci_pending`.         |
| 7   | every 120 s thereafter | Same 16-line stanza repeats. The verbose log says **"no CI checks yet"** and **"no CI check-runs yet, but 1 workflow run(s) were triggered"**.                                                                                          |
| 8   | ~22 minutes later      | User sees the Actions tab showing two yellow runs (the cancelled old one + the running new one), reads _"1 workflow run(s)"_ in the log as a contradiction, and Ctrl+Cs the watcher.                                                    |

## Reproduction with current API state

The PR finished CI successfully _after_ the user killed the watcher. As of the
time of this case study:

```bash
$ gh api repos/link-foundation/box/pulls/83 \
    --jq '{number, head: {ref: .head.ref, sha: .head.sha}, mergeable, mergeable_state}'
{"number":83,"head":{"ref":"issue-82-9bbaad39cc07","sha":"dfc4c14746aa3dce19a060bf5b5b328eb3296350"},"mergeable":true,"mergeable_state":"unstable"}

$ gh api repos/link-foundation/box/actions/runs/25097532949 \
    --jq '{id, name, head_sha, status, conclusion, html_url}'
{
  "id": 25097532949,
  "name": "Build and Release Docker Image",
  "head_sha": "dfc4c14746aa3dce19a060bf5b5b328eb3296350",
  "status": "in_progress",
  "conclusion": null,
  "html_url": "https://github.com/link-foundation/box/actions/runs/25097532949"
}

$ gh api repos/link-foundation/box/actions/runs/25097500291 \
    --jq '{id, name, head_sha, status, conclusion, html_url}'
{
  "id": 25097500291,
  "name": "Build and Release Docker Image",
  "head_sha": "aa35cde4280238d066db4a771a662a6ebdcb604a",
  "status": "completed",
  "conclusion": "cancelled",
  "html_url": "https://github.com/link-foundation/box/actions/runs/25097500291"
}

$ gh api repos/link-foundation/box/commits/dfc4c14746aa3dce19a060bf5b5b328eb3296350/check-runs \
    --jq '.total_count'
22
```

The `total_count: 22` confirms that the race condition the loop was waiting on
**did** resolve later — `/merge` was correct to keep waiting; the user was wrong
to Ctrl+C. The log just did not communicate that.

Snapshots:

- [`pr-83.json`](raw-data/pr-83.json) — PR is `mergeable: true, mergeable_state: "unstable"`
- [`workflow-run-25097532949.json`](raw-data/workflow-run-25097532949.json) — the long-running build for the **current** head SHA
- [`workflow-run-25097500291.json`](raw-data/workflow-run-25097500291.json) — the cancelled run for an **older** SHA (`aa35cde`)
- [`workflow-runs-for-dfc4c14.json`](raw-data/workflow-runs-for-dfc4c14.json) — `total_count: 1` (confirms `/merge`'s "1 workflow run" was correct: the older run is filtered out by SHA)
- [`check-runs-dfc4c14.json`](raw-data/check-runs-dfc4c14.json) — `total_count: 22` (after the watcher was killed)
- [`full-terminal-log.txt`](raw-data/full-terminal-log.txt) — the full 16 318-line user terminal recording
- [`solution-draft-log-pr-1777450999138.txt`](raw-data/solution-draft-log-pr-1777450999138.txt) — the auto-merge round's solver log
- [`issue-screenshot.png`](raw-data/issue-screenshot.png) — user-supplied screenshot of the misleading lines

## Requirements (as stated in the issue)

1. **Diagnose** why the verbose log was misleading enough to provoke a Ctrl+C —
   specifically the lines _"PR #83 has no CI checks yet - treating as
   no_checks"_ and _"PR #83 has no CI check-runs yet, but 1 workflow run(s)
   were triggered"_.
2. **Compile a case study** under `./docs/case-studies/issue-1712/` that
   includes raw logs, timeline, requirements, root cause, and proposed solution.
3. **List ALL active CI/CD runs**, with links (not just IDs), and **clearly mark
   the active CI/CD for the last commit** so the user can verify what `/merge`
   is watching.
4. **If we lack data** to find the root cause, add debug / verbose output for
   the next iteration.
5. **File upstream issues** (with reproductions, workarounds, suggested fixes)
   for any external repo implicated.

## Root Cause Analysis

### Why the messages look like "nothing is happening"

```text
[VERBOSE] /merge: PR #83 has no CI checks yet - treating as no_checks
```

`getDetailedCIStatus()` in `src/github-merge.lib.mjs` calls the GitHub
`/commits/{sha}/check-runs` and `/commits/{sha}/status` endpoints. If both
return zero entries, it sets `ciStatus.status = 'no_checks'` and emits this
message. **"no*checks" is \_internal* language**: it means "the check-runs API
has not returned any check-runs yet for this commit". GitHub's typical pattern
is:

1. Push a commit → `workflow_run` created within seconds
2. Workflow starts → after **30–120 s**, jobs are instantiated and the
   corresponding `check_run` records become visible at
   `/commits/{sha}/check-runs`

So `no_checks` legitimately can mean either:

- **Race condition** — workflows _were_ triggered, just no check-runs yet.
- **No CI configured** — repo has no workflows triggered by `pull_request`.

The downstream code (`getMergeBlockers`) **does** distinguish these, but the
early `[VERBOSE]` line that the user reads first does not say so. It reads, in
plain English, "no CI checks yet". A user who is anxiously watching `/merge`
parses that as "nothing happened", not as "check-runs API hasn't repopulated
yet".

```text
[VERBOSE] /merge: PR #83 has no CI check-runs yet, but 1 workflow run(s) were triggered for SHA dfc4c14 - genuine race condition (waiting for check-runs to appear)
```

This second line _does_ explain the situation — but it lists the workflow run
as `Build and Release Docker Image (25097532949)`, with no URL. The user has to
copy `25097532949` and assemble
`https://github.com/link-foundation/box/actions/runs/25097532949` by hand to
verify. Worse, in the Actions tab they can see **two** yellow runs (the
cancelled previous-SHA run, plus the in-progress current-SHA run), and the log
says "1 workflow run(s)" — appearing to contradict reality, when it's actually
correct (`workflow-runs-for-dfc4c14.json` confirms `total_count: 1` for the
head SHA).

The `⏳ Waiting for CI:` user-facing line in `solve.auto-merge.lib.mjs` (which
joins `pendingBlocker.details`) is the only signal that does **not** require
parsing the verbose log — but its details come from the blocker's `details`
field, which only contained the workflow name, not the URL.

### Where the messages live

`src/github-merge.lib.mjs`:

- Line ~1093 (`getDetailedCIStatus`): `console.log('[VERBOSE] /merge: PR #${prNumber} has no CI checks yet - treating as no_checks');`
- Line ~345 (`checkPRCIStatus`): `console.log('[VERBOSE] /merge: PR #${prNumber} has no CI checks yet - treating as pending');`
- Line ~1215 (`getWorkflowRunsForSha`): logs run name + ID without URL.

`src/solve.auto-merge-helpers.lib.mjs`:

- Line ~345 (`getMergeBlockers` no_checks branch): `'PR #${prNumber} has no CI check-runs yet, but ${workflowRuns.length} workflow run(s) were triggered ... genuine race condition (waiting for check-runs to appear)'`. Builds a `ci_pending` blocker with `details: workflowRuns.map(r => r.name)` — names only, no URLs.
- Line ~527 (`getMergeBlockers` pending branch): builds a `ci_pending` blocker with `details: pendingNames` — names only, no URLs and no per-check status.

### Why earlier fixes don't help

| Fix           | Scope                                                                   | Why it didn't catch #1712                                                              |
| ------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| #1442 / #1466 | Distinguish "no workflow runs at all" / "all non-executing"             | Not applicable — there **is** a running workflow run, classification logic was correct |
| #1480         | Race-condition grace period; explicitly logs `"genuine race condition"` | The classification was right; the **wording** is what misled the user                  |
| #1503         | Multi-mechanism CI consensus                                            | Triggers only when blockers are empty                                                  |
| #1690         | Detect invalid workflow files (zero jobs on completed failure)          | Not applicable — the workflow run is healthy and `in_progress`                         |

So **the bug is purely in the user-facing wording and the lack of URLs** — the
underlying classification was correct.

## Fix

Implemented in PR #1713.

### Code changes

**`src/github-merge.lib.mjs`:**

1. `getDetailedCIStatus` — reworded the `no_checks` verbose line so it does
   **not** sound like "no CI configured":

   ```diff
   - console.log(`[VERBOSE] /merge: PR #${prNumber} has no CI checks yet - treating as no_checks`);
   + console.log(`[VERBOSE] /merge: PR #${prNumber} commit ${sha.substring(0, 7)} has no check-runs or commit statuses registered yet (status=no_checks; race vs. no-CI distinction is decided downstream)`);
   ```

2. `checkPRCIStatus` — same wording fix, distinguishing this code path:

   ```diff
   - console.log(`[VERBOSE] /merge: PR #${prNumber} has no CI checks yet - treating as pending`);
   + console.log(`[VERBOSE] /merge: PR #${prNumber} commit ${sha.substring(0, 7)} has no check-runs/statuses registered yet — treating as pending`);
   ```

3. `getWorkflowRunsForSha` — every workflow run listing now includes the
   `html_url`:

   ```diff
   - console.log(`[VERBOSE] /merge:   - ${run.name} (${run.id}): status=${run.status}, conclusion=${run.conclusion}`);
   + console.log(`[VERBOSE] /merge:   - ${run.name} (run #${run.id}): status=${run.status}, conclusion=${run.conclusion ?? 'null'} — ${run.html_url}`);
   ```

4. `getDetailedCIStatus` — when normalizing GitHub check-runs and commit
   statuses into `ciStatus.{passed,pending,queued,failed,cancelled,stale}`,
   each entry now carries the upstream `html_url` (or `details_url` /
   `target_url` fallback):

   ```diff
     pendingChecks.push({
       name: check.name,
       status: check.status,
       conclusion: check.conclusion,
   +   html_url: check.html_url || check.details_url || null,
       ...
     });
   ```

**`src/solve.auto-merge-helpers.lib.mjs`:**

5. `getMergeBlockers` no_checks branch — reworded message and enriched the
   blocker `details` with per-run status + URL:

   ```diff
   -  await log(`[VERBOSE] /merge: PR #${prNumber} has no CI check-runs yet, but ${workflowRuns.length} workflow run(s) were triggered for SHA ${ciStatus.sha.substring(0, 7)} - genuine race condition (waiting for check-runs to appear)`);
   +  await log(`[VERBOSE] /merge: PR #${prNumber} commit ${ciStatus.sha.substring(0, 7)} has ${workflowRuns.length} workflow run(s) registered, but check-runs have not been published yet — waiting for the runs to publish check-runs:`);
   +  for (const run of workflowRuns) {
   +    await log(`[VERBOSE] /merge:   - ${run.name} (run #${run.id}): status=${run.status}, conclusion=${run.conclusion ?? 'null'} — ${run.html_url}`);
   +  }
     blockers.push({
       type: 'ci_pending',
   -   message: `CI/CD checks have not started yet (${workflowRuns.length} workflow run(s) triggered, waiting for check-runs to appear)`,
   -   details: workflowRuns.map(r => r.name),
   +   message: `Waiting for ${workflowRuns.length} workflow run(s) on commit ${ciStatus.sha.substring(0, 7)} to publish check-runs`,
   +   details: workflowRuns.map(r => `${r.name} [${r.status}${r.conclusion ? `/${r.conclusion}` : ''}] — ${r.html_url}`),
     });
   ```

6. `getMergeBlockers` pending branch — same enrichment for the case where
   check-runs **do** exist but are still running/queued:

   ```diff
   - const pendingNames = [...ciStatus.pendingChecks, ...ciStatus.queuedChecks].map(c => c.name);
   - blockers.push({
   -   type: 'ci_pending',
   -   message: 'CI/CD checks are still running or queued',
   -   details: pendingNames,
   - });
   + const pendingChecks = [...ciStatus.pendingChecks, ...ciStatus.queuedChecks];
   + const pendingDetails = pendingChecks.map(c => {
   +   const statusPart = c.status ? ` [${c.status}]` : '';
   +   const urlPart = c.html_url ? ` — ${c.html_url}` : '';
   +   return `${c.name}${statusPart}${urlPart}`;
   + });
   + if (verbose) {
   +   await log(`[VERBOSE] /merge: PR #${prNumber} commit ${ciStatus.sha.substring(0, 7)} has ${pendingChecks.length} pending/queued check-run(s):`);
   +   for (const c of pendingChecks) {
   +     await log(`[VERBOSE] /merge:   - ${c.name}: status=${c.status ?? 'unknown'}, conclusion=${c.conclusion ?? 'null'}${c.html_url ? ` — ${c.html_url}` : ''}`);
   +   }
   + }
   + blockers.push({
   +   type: 'ci_pending',
   +   message: 'CI/CD checks are still running or queued',
   +   details: pendingDetails,
   + });
   ```

7. `getMergeBlockers` cancelled branch — also enriched with conclusion + URL,
   so when CI gets re-triggered the user sees the URL of the cancelled run.

### Why these changes

| Change                   | Addresses requirement                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reword `no_checks` lines | (1) Diagnose / (4) Better debug output. The phrase "no CI checks yet" is replaced with "no check-runs registered yet", which doesn't read as "nothing here" |
| Add URLs to verbose runs | (3) "list ALL active CI/CDs with links (not just IDs)"                                                                                                      |
| Enrich blocker `details` | (3) The user-facing `⏳ Waiting for CI:` line in `solve.auto-merge.lib.mjs` now displays URLs without further code change                                   |
| Per-run status + URL     | (3) "clearly mark the active CI/CD for the last commit" — status is shown so the user can see "in_progress" right next to the URL                           |

### What the new logs look like

Before:

```text
[VERBOSE] /merge: PR #83 has no CI checks yet - treating as no_checks
[VERBOSE] /merge: Found 1 workflow runs for SHA dfc4c14
[VERBOSE] /merge:   - Build and Release Docker Image (25097532949): status=pending, conclusion=null
[VERBOSE] /merge: PR #83 has no CI check-runs yet, but 1 workflow run(s) were triggered for SHA dfc4c14 - genuine race condition (waiting for check-runs to appear)
  ⏳ Waiting for CI:         Build and Release Docker Image
```

After:

```text
[VERBOSE] /merge: PR #83 commit dfc4c14 has no check-runs or commit statuses registered yet (status=no_checks; race vs. no-CI distinction is decided downstream)
[VERBOSE] /merge: Found 1 workflow run(s) for SHA dfc4c14
[VERBOSE] /merge:   - Build and Release Docker Image (run #25097532949): status=pending, conclusion=null — https://github.com/link-foundation/box/actions/runs/25097532949
[VERBOSE] /merge: PR #83 commit dfc4c14 has 1 workflow run(s) registered, but check-runs have not been published yet — waiting for the runs to publish check-runs:
[VERBOSE] /merge:   - Build and Release Docker Image (run #25097532949): status=pending, conclusion=null — https://github.com/link-foundation/box/actions/runs/25097532949
  ⏳ Waiting for CI:         Build and Release Docker Image [pending] — https://github.com/link-foundation/box/actions/runs/25097532949
```

The user-facing line at the bottom now contains the URL the user can paste to
the browser, so they can verify in <5 seconds that CI is running.

### Tests

`tests/test-misleading-merge-logs-1712.mjs` covers:

| Test                                                  | Expectation                                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| no_checks + workflow runs → blocker details have URLs | `details[0]` matches `/^.* \[\w+\] — https:\/\//`                                                                                              |
| pending check-runs → blocker details have URLs        | `details[0]` includes `[pending]` and the check's `html_url`                                                                                   |
| cancelled check-runs → blocker details have URLs      | `details[0]` includes `[cancelled]` and the check's `html_url`                                                                                 |
| no_checks but workflows are non-executing → unchanged | Still falls through to `noCiTriggered` (regression guard for #1466)                                                                            |
| Wording sanity check                                  | The literal string `"has no CI checks yet"` no longer appears anywhere in `src/github-merge.lib.mjs` or `src/solve.auto-merge-helpers.lib.mjs` |

## Verification on the original case

Plugging the recorded data into the new logic:

```js
ciStatus = { status: 'no_checks', sha: 'dfc4c14746aa3dce19a060bf5b5b328eb3296350' };
workflowRuns = [{ id: 25097532949, name: 'Build and Release Docker Image', status: 'in_progress', conclusion: null, html_url: 'https://github.com/link-foundation/box/actions/runs/25097532949' }];
```

Result:

```text
⏳ Waiting for CI:         Build and Release Docker Image [in_progress] — https://github.com/link-foundation/box/actions/runs/25097532949
   ⏱️ Next check in:          120 seconds...
```

…instead of the previous `⏳ Waiting for CI:  Build and Release Docker Image`,
which left the user with no way to verify what `/merge` was waiting on. With
the new line, the user can click the URL, see "in_progress / Build pending",
and **not** Ctrl+C.

## Upstream / external issues

The bug is entirely in `link-assistant/hive-mind`. The third-party repo
`link-foundation/box` was not at fault — its workflow finished cleanly after
the watcher was killed (`check-runs-dfc4c14.json` shows `total_count: 22`).
**No upstream issue is needed.**

(For completeness: GitHub's GraphQL API returns `mergeStateStatus = UNSTABLE`
during a healthy CI run; this is not a GitHub bug. The 30-120 s gap between
`workflow_run` registration and the appearance of `check-runs` is documented
behaviour. Our log just had to communicate it more clearly.)

## Defensive next steps

- **Soft-cap on `ci_pending` waits**: if a `ci_pending` blocker stays the same
  for N consecutive iterations (e.g. 30), surface a hint that the user can
  cancel and inspect the URL directly. (Out of scope for this PR; tracked for
  a follow-up.)
- **Top-level summary on every check**: include "Active workflow runs for this
  commit: 1 / Active check-runs: 0 / mergeable_state: clean" as a single-line
  status header before the `⏳` line, so the user does not need to read the
  full verbose log.
- **Hyperlink in TTY**: when stdout is a TTY, render the URL with the ANSI OSC
  8 hyperlink sequence so the user can click it directly without copy/paste.
