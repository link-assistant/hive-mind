# Case Study: Issue #1722 — `/merge` failed to wait for CI/CD on default branch

- Issue: https://github.com/link-assistant/hive-mind/issues/1722
- PR: https://github.com/link-assistant/hive-mind/pull/1723
- Date: 2026-04-29
- Related prior fixes: [#1307](https://github.com/link-assistant/hive-mind/issues/1307), [#1503](https://github.com/link-assistant/hive-mind/issues/1503)

## Summary

The `/merge` command merged PR #1719 even though a CI/CD workflow run was still in progress on the default branch (`main`). The merge triggered a new run that automatically cancelled the previous one. This is exactly the class of bug `/merge` was designed to prevent (see issue #1307).

The verbose log shows the failure mode unambiguously:

```
[VERBOSE] /merge: Checking for active CI runs on link-assistant/hive-mind branch main...
[VERBOSE] /merge: Error checking active runs on main: stdout maxBuffer length exceeded
[VERBOSE] /merge: No active CI runs on main branch. Ready to proceed.
```

`getActiveBranchRuns()` swallowed a `stdout maxBuffer length exceeded` error and returned `hasActiveRuns: false`, which `waitForBranchCI()` interpreted as "all clear". The merge proceeded immediately.

## Timeline

All times UTC, 2026‑04‑29.

| Time     | Event                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11:45:14 | CI run **25106938272** ("Checks and release") starts on main `a0227b0` (push event)                                                                                                                 |
| ~11:45   | User triggers `/merge` in Telegram bot for `link-assistant/hive-mind`                                                                                                                               |
| ~11:45   | `/merge` first check (per HEAD SHA): correctly reports run is in progress: `1 CI run(s) still in progress on main (latest commit a0227b0)`                                                          |
| ~11:45   | `/merge-queue` calls `waitForBranchCI()` → `getActiveBranchRuns()`                                                                                                                                  |
| ~11:45   | `gh api "repos/.../actions/runs?branch=main&per_page=100" --paginate --slurp` returns ~12.7 MB; Node's `child_process.exec` default `maxBuffer` is 1 MB → throws `stdout maxBuffer length exceeded` |
| ~11:45   | Error caught and ignored; function returns `hasActiveRuns: false`                                                                                                                                   |
| ~11:45   | `/merge` reports `No active CI runs on main branch. Ready to proceed.` and merges PR #1719                                                                                                          |
| 11:46:32 | Merge commit `d34b459` pushed; new CI run **25106994311** starts                                                                                                                                    |
| 11:46:34 | Run 25106938272 cancelled (concurrency group of new push)                                                                                                                                           |

Sources:

- Telegram bot log: [`data/hive-telegram-bot.txt`](data/hive-telegram-bot.txt) (lines 30944–30988)
- Run metadata: [`data/run-25106938272-meta.json`](data/run-25106938272-meta.json), [`data/run-25106994311-meta.json`](data/run-25106994311-meta.json)
- Cancelled run logs: [`data/run-25106938272-cancelled.txt`](data/run-25106938272-cancelled.txt)

## Requirements (from the issue)

The issue explicitly lists:

1. `/merge` must correctly identify that CI/CD is still running on the default branch.
2. Download all logs and data into `./docs/case-studies/issue-1722/`.
3. Reconstruct timeline and sequence of events.
4. List all requirements.
5. Find the root cause(s).
6. Propose solution(s) for each requirement, including known existing components/libraries.
7. If data is insufficient, add debug output / verbose mode for the next iteration.
8. If the issue relates to another GitHub project, file an upstream issue with reproducible example, workaround, and fix suggestion.

## Root Cause Analysis

### Primary root cause: silent failure in `getActiveBranchRuns()`

File: `src/github-merge.lib.mjs`

```js
// src/github-merge.lib.mjs:686
export async function getActiveBranchRuns(owner, repo, branch = 'main', verbose = false) {
  try {
    const { stdout } = await exec(
      `gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=100" --paginate --slurp`,
    );
    const runs = JSON.parse(stdout.trim() || '[]')
      .flatMap(page => page.workflow_runs || [])
      .filter(run => run.status === 'in_progress' || run.status === 'queued')
      ...
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking active runs on ${branch}: ${error.message}`);
    }
    return {
      runs: [],
      hasActiveRuns: false,    // ← BUG: a fetch error becomes "no active runs"
      count: 0,
    };
  }
}
```

Two compounding bugs:

1. **No `maxBuffer` override.** `exec` is `promisify(child_process.exec)`. Node's default `maxBuffer` is **1 MB**. The repository's main branch has hundreds of historical workflow runs; `--paginate --slurp` aggregates them all. Measured response size on 2026-04-29: **~12.7 MB**. The exec promise rejects with `stdout maxBuffer length exceeded` long before parsing.
2. **Error → "all good".** The `catch` block returns `hasActiveRuns: false`, which the caller treats as a green light. A transient API/buffer/parse error is indistinguishable from "branch CI is idle".

### Why the first check worked but the second failed

`/merge-queue` performs two CI checks in sequence:

- **Check A** uses `gh api repos/.../commits/{HEAD_SHA}/check-runs` (small response, scoped to one commit). It correctly reported `1 CI run(s) still in progress on main`.
- **Check B** is `waitForBranchCI()` → `getActiveBranchRuns()` (above), querying _all_ workflow runs on the branch. It overflowed the buffer and returned the false negative.

### Why the cancellation happened

GitHub Actions uses a workflow concurrency group (`concurrency: ...` in `.github/workflows/...`). When the merge commit was pushed, the new run for `d34b459` cancelled the still-running run on `a0227b0`.

### Other places with the same pattern

`exec` without an explicit `maxBuffer` is used in many `gh api ... --paginate --slurp` calls in this codebase (grep `--paginate --slurp` against the source):

- `src/github-merge.lib.mjs` lines 316, 689, 845, 913, 927, 1067, 1222, 1310
- `src/github-merge-repo-actions.lib.mjs` lines 25, 83
- `src/github-merge-ready-sync.lib.mjs` line 69

All of these silently swallow exec errors and return empty/false defaults — meaning any of them can cause similar false negatives once a repo accumulates enough data. The same `getAllActiveRepoRuns` function in `github-merge-repo-actions.lib.mjs` is the basis for the issue #1503 "absolute safety mechanism" and is already vulnerable.

There is already a `githubLimits.bufferMaxSize` (default 10 MB, configurable via `HIVE_MIND_GITHUB_BUFFER_MAX_SIZE`) in `src/config.lib.mjs:101` used by `src/github.batch.lib.mjs`. It was simply never wired into the `/merge` paths.

Note: even 10 MB is **not enough** for the observed 12.7 MB response. The proper fix combines a higher buffer with **server-side filtering** so we never download all historical runs in the first place.

## Solution

Three independent improvements, all required:

### 1. Filter on the server side (`?status=...`)

GitHub's `GET /repos/{owner}/{repo}/actions/runs` accepts `status=` as a query parameter. We only ever care about non-completed runs (`in_progress`, `queued`, `pending`, `waiting`, `requested`). Querying each status and merging the results scales by _active_ run count, not historical run count. For an idle branch this is essentially zero bytes.

Verification (2026-04-29 on `main`):

- All runs (no filter): 12.7 MB
- `status=in_progress`: 1 result
- `status=queued`: 0 results

GitHub Actions API accepts these status filters: `completed`, `action_required`, `cancelled`, `failure`, `neutral`, `skipped`, `stale`, `success`, `timed_out`, `in_progress`, `queued`, `requested`, `waiting`, `pending`. We need only the active set.

### 2. Raise `exec` `maxBuffer` to a sane default

Use the existing `githubLimits.bufferMaxSize` (10 MB) for these `gh api` calls. Even with server-side filtering, this guards against unexpected growth.

### 3. Don't treat fetch errors as "no active runs"

A buffer overflow, network timeout, or parse error must not lead to `hasActiveRuns: false`. Either:

- Re-throw the error (so `waitForBranchCI` retries on the next poll), **or**
- Return an explicit error state that `waitForBranchCI` can distinguish from "idle".

Re-throwing is simpler and matches the existing retry loop in `waitForBranchCI` (which already has a `try/catch` around `getActiveBranchRuns` and a `continue` after `pollInterval`). This also ensures errors bubble into the verbose log every poll, rather than only the first.

### 4. Add a final verification before merge

As an extra defensive layer, before actually calling the merge API, do a per-PR-branch _and_ per-default-branch consensus check exactly as `checkCIConsensus` does for the PR. If either check fails (not just "not idle" but "errored"), abort and retry rather than merge.

## Reproducible example

```js
// experiments/issue-1722-buffer-overflow.mjs
import { promisify } from 'util';
import { exec as execCb } from 'child_process';
const exec = promisify(execCb);

const owner = 'link-assistant';
const repo = 'hive-mind';
const branch = 'main';

try {
  // Default maxBuffer = 1 MB. Repos with many historical runs blow past this.
  await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=100" --paginate --slurp`);
  console.log('OK — buffer was big enough this time');
} catch (e) {
  console.log('REPRODUCED:', e.message); // → "stdout maxBuffer length exceeded"
}
```

## Existing components and prior art

- **`githubLimits.bufferMaxSize`** in `src/config.lib.mjs` — already exists, already used in `src/github.batch.lib.mjs`. The fix is to use it consistently.
- **GitHub REST API `?status=` filter** — native server-side filtering, no third-party library required.
- **Octokit pagination** (`@octokit/plugin-paginate-rest`) — would solve this without spawning `gh`; out of scope for this fix but worth a follow-up.
- Issue #1307 introduced `waitForBranchCI`; this case study is the second-order failure of that mechanism. Issue #1503 introduced repo-wide active run checks (also vulnerable to the same pattern).

## Upstream issues to file

The bug is fully fixable in this repository — no upstream report required. The fix is documented in the PR.

## Files in this case study

- `README.md` — this document.
- `data/hive-telegram-bot.txt` — full bot log from the gist linked in the issue.
- `data/run-25106938272-cancelled.txt` — full job log of the run that was cancelled by the merge.
- `data/run-25106938272-meta.json`, `data/run-25106994311-meta.json` — workflow run metadata.
- `../../../experiments/issue-1722-buffer-overflow.mjs` — minimal reproduction.
