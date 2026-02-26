# Case Study: Issue #1363 — `Ready to merge` as False Positive

## Overview

**Issue:** [`link-assistant/hive-mind#1363`](https://github.com/link-assistant/hive-mind/issues/1363)
**Fix PR:** [`link-assistant/hive-mind#1364`](https://github.com/link-assistant/hive-mind/pull/1364)
**Affected Command:** `--auto-restart-until-mergeable`
**Symptom:** "Ready to merge" comment posted on a PR while CI/CD checks were still running or hadn't started yet (false positive)
**Root Cause:** The fix for issue #1345 introduced a new edge case — repos with active CI workflows but WITHOUT required branch protection rules were incorrectly identified as "no CI configured"

---

## Related Issue

This is a follow-up to [issue #1345](https://github.com/link-assistant/hive-mind/issues/1345), which fixed an infinite loop in repos with no CI at all. The fix for #1345 introduced a new false positive in a different scenario.

---

## Reproduction

**Referenced PR:** https://github.com/link-assistant/calculator/pull/82

**Command that triggered the bug:**
```
solve https://github.com/link-assistant/calculator/issues/36 \
  --model opus-4-6 \
  --attach-logs \
  --verbose \
  --no-tool-check \
  --auto-resume-on-limit-reset \
  --auto-restart-until-mergeable \
  --tokens-budget-stats
```

**Repository characteristics (link-assistant/calculator):**
- Has 3 active GitHub Actions workflows (including CI/CD Pipeline)
- Has NO branch protection rules on `main` branch
- Has NO required status checks configured in branch protection

---

## Timeline of Events

### 2026-02-26T19:13:35Z — Solve starts

The hive-mind AI solver was invoked on issue #36 in `link-assistant/calculator`. PR #82 already existed.

### 2026-02-26T19:13:52Z — PR #82 confirmed

The framework verified that PR #82 was open and ready for review.

### 2026-02-26T19:14:04Z — Claude session starts

Claude Opus 4.6 was invoked to implement date/time features (135 turns, ~23 minutes).

### 2026-02-26T19:32:34Z — Feature commit pushed (SHA: `3898e28`)

The feature commit was pushed. CI was triggered and ran from ~19:32:34Z to 19:35:31Z (all passed).

### 2026-02-26T19:37:22Z — Claude session ends

Claude finished all implementations. The framework begins post-session cleanup.

### 2026-02-26T19:37:32Z — CLAUDE.md revert commit pushed (SHA: `e0a064c`)

`cleanupClaudeFile()` pushed a commit reverting `CLAUDE.md`. This created a NEW HEAD SHA.

### 2026-02-26T19:37:47Z — `watchUntilMergeable` first check (FALSE POSITIVE)

The check ran on the NEW HEAD SHA (`e0a064c`):
1. `getDetailedCIStatus(e0a064c)` → `{ status: 'no_checks', checks: [] }` (CI for the new SHA hadn't started yet — ~10-30s delay)
2. `checkPRMergeable()` → `{ mergeable: true }` (GitHub returns `CLEAN` because there are NO required status checks in branch protection)
3. **OLD LOGIC**: `no_checks + MERGEABLE = no CI configured` → **FALSE POSITIVE**
4. "Ready to merge" comment posted: "No CI/CD checks are configured for this repository"

### 2026-02-26T19:37:57Z — CI for `e0a064c` finally starts

25 seconds after the false positive was posted, the first CI check for `e0a064c` started running.

### 2026-02-26T19:41:12Z — CI for `e0a064c` completes (all pass)

All 13 CI checks completed successfully — but the "Ready to merge" comment was already posted 3.5 minutes earlier.

### 2026-02-26T19:41:30Z — Issue #1363 filed

The bug was reported by the user who observed the false positive.

---

## Root Cause Analysis

### The Three-Way Ambiguity

When `getDetailedCIStatus()` returns `no_checks`, there are now THREE possible scenarios:

| Scenario | Repo has workflows? | Required checks? | `mergeStateStatus` | Correct action |
|----------|--------------------|-----------------|--------------------|---------------|
| **A** (issue #1345 target) | ❌ No | ❌ No | `CLEAN` | Treat as "no CI" → post "Ready to merge" |
| **B** (issue #1363 trigger) | ✅ Yes | ❌ No | `CLEAN` | Wait for CI to start → race condition |
| **C** (issue #1345 race) | ✅ Yes | ✅ Yes | `BLOCKED`/`UNKNOWN` | Wait for CI to start → race condition |

The fix for issue #1345 disambiguates **A** from **C** by checking `mergeStateStatus`. But it **cannot distinguish A from B** — both return `CLEAN` and `MERGEABLE: true`.

### Why `mergeStateStatus` Is Not Sufficient

GitHub's `mergeStateStatus: CLEAN` means:
- All REQUIRED status checks have passed (or there are none)
- No merge conflicts
- PR is not blocked by any required review

It does NOT mean "all CI checks have passed". If a repo has no required status checks in branch protection, `mergeStateStatus` will be `CLEAN` immediately after PR creation — regardless of whether CI workflows are running.

### The Race Condition Window

After pushing a commit to GitHub, there is a **~10-30 second delay** before GitHub registers CI check runs via the `/commits/{sha}/check-runs` API. This window is where the false positive occurs:

```
t=0s:  Commit pushed
t=0-25s: GitHub hasn't registered CI checks yet → /check-runs returns []
t=25s:   First CI check registered → /check-runs returns [{status: 'queued'}]
```

In the false positive case, `watchUntilMergeable` checked at exactly t≈15s into this window.

### The Compounding Factors

1. **`cleanupClaudeFile()` always runs at session end**: This creates a new HEAD SHA, re-triggering the race condition window for every solve session.

2. **No required branch protection = always `CLEAN`**: Without required status checks, GitHub's `mergeStateStatus` will never be `BLOCKED` due to pending CI — making the #1345 fix unable to detect this scenario.

3. **Fast first check**: The `watchUntilMergeable` loop runs its first check immediately (before the first `watchInterval` delay), making it more likely to hit the race condition window.

---

## The Fix

**File:** `src/github-merge.lib.mjs` (new function) and `src/solve.auto-merge.lib.mjs` (updated logic)

### New Function: `getActiveRepoWorkflows`

Added to `github-merge.lib.mjs`:

```javascript
export async function getActiveRepoWorkflows(owner, repo, verbose = false) {
  const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/workflows" --jq '[.workflows[] | select(.state == "active")] | map({id: .id, name: .name, state: .state})'`);
  const workflows = JSON.parse(stdout.trim() || '[]');
  return {
    count: workflows.length,
    hasWorkflows: workflows.length > 0,
    workflows,
  };
}
```

This queries the GitHub Actions workflows API to check whether ANY active workflows exist in the repo — regardless of whether they've started for a specific commit.

### Updated Logic: `getMergeBlockers` (Third Discriminator)

Before (issue #1345 fix — only 2-way check):
```javascript
if (ciStatus.status === 'no_checks') {
  const earlyMergeStatus = await checkPRMergeable(owner, repo, prNumber, verbose);
  if (earlyMergeStatus.mergeable) {
    return { blockers, ciStatus, noCiConfigured: true }; // ← FALSE POSITIVE for repos with workflows but no required checks
  } else {
    blockers.push({ type: 'ci_pending', ... });
  }
}
```

After (issue #1363 fix — 3-way check):
```javascript
if (ciStatus.status === 'no_checks') {
  const earlyMergeStatus = await checkPRMergeable(owner, repo, prNumber, verbose);
  if (earlyMergeStatus.mergeable) {
    // NEW: Check if the repo actually has workflows before concluding "no CI"
    const repoWorkflows = await getActiveRepoWorkflows(owner, repo, verbose);
    if (repoWorkflows.hasWorkflows) {
      // Repo HAS workflows → race condition, not "no CI configured"
      blockers.push({
        type: 'ci_pending',
        message: `CI/CD checks have not started yet (${repoWorkflows.count} workflow(s) configured, waiting for checks to appear)`,
        details: repoWorkflows.workflows.map(wf => wf.name),
      });
    } else {
      // Repo has NO workflows → truly "no CI configured"
      return { blockers, ciStatus, noCiConfigured: true };
    }
  } else {
    blockers.push({ type: 'ci_pending', ... });
  }
}
```

### Decision Tree After Fix

```
getDetailedCIStatus() returns 'no_checks'
  └─ checkPRMergeable() → MERGEABLE?
     ├─ YES:
     │   └─ getActiveRepoWorkflows() → hasWorkflows?
     │      ├─ YES: Race condition! Wait for CI to start → ci_pending blocker
     │      └─ NO:  Truly no CI → noCiConfigured=true, no blockers
     └─ NO: Race condition (merge blocked or unknown) → ci_pending blocker
```

---

## Solutions Considered

### Solution 1 (Implemented): Check Repository Workflows API

**Pros:**
- Accurate: directly queries whether CI is configured
- Works regardless of branch protection settings
- Provides useful info (workflow names) in the blocker message

**Cons:**
- One extra API call per `no_checks + MERGEABLE` occurrence
- Relies on GitHub's workflows API being available

### Solution 2: Add a startup delay before first check

Wait 60 seconds after session end before the first `watchUntilMergeable` check.

**Pros:** Simple implementation

**Cons:**
- Arbitrary delay (may be too short or too long)
- Slows down all cases, including ones where CI starts quickly
- Doesn't fix the root cause — if delay is < ~30s, same race condition possible

### Solution 3: Use previous SHA's checks as proxy

If the previous HEAD SHA had CI checks, assume the new SHA will too.

**Pros:** Leverages existing CI history

**Cons:**
- Doesn't work for newly created PRs or first commits
- More complex state tracking

### Solution 4: Retry `no_checks` several times before concluding "no CI"

Add N retries with short delay when `no_checks + MERGEABLE` is seen.

**Pros:** Simple, no extra API calls

**Cons:**
- Arbitrary retry count/delay
- Only partially fixes the issue — if N is too small, still races

### Solution 5: Require explicit flag to enable "no CI configured" shortcut

Only skip CI waiting if user passes `--allow-no-ci` or similar flag.

**Pros:** Conservative, opt-in

**Cons:**
- Breaking change for existing users
- Doesn't solve the root cause

---

## External Libraries and References

### GitHub API References

- [Check Runs API](https://docs.github.com/en/rest/checks/runs): `/repos/{owner}/{repo}/commits/{sha}/check-runs`
- [Merge State Status](https://docs.github.com/en/graphql/reference/enums#mergestatus): GraphQL enum for PR mergeability
- [Workflows API](https://docs.github.com/en/rest/actions/workflows): `/repos/{owner}/{repo}/actions/workflows`
- [Branch Protection API](https://docs.github.com/en/rest/branches/branch-protection): `/repos/{owner}/{repo}/branches/{branch}/protection`

### Related GitHub Issues

- [Issue #1345](https://github.com/link-assistant/hive-mind/issues/1345): Original "stuck on no CI checks" fix
- [Issue #1339](https://github.com/link-assistant/hive-mind/issues/1339): PR mergeability UNKNOWN state handling
- [Issue #1314](https://github.com/link-assistant/hive-mind/issues/1314): CI billing limits handling

### Known GitHub Behavior

GitHub's `mergeStateStatus` values and their meanings:
- `CLEAN`: Ready to merge (no required checks missing, no conflicts)
- `BLOCKED`: Blocked by branch protection (required checks failing/pending, or required reviews missing)
- `BEHIND`: Branch is behind base branch
- `DIRTY`: Has merge conflicts
- `UNSTABLE`: Has failing required checks
- `UNKNOWN`: GitHub is still computing (async calculation)

For repos with NO branch protection, `mergeStateStatus` is **always `CLEAN`** as long as there are no merge conflicts — even if CI checks are still running.

---

## Impact

### Affected Repositories

Any repository that:
1. Has GitHub Actions workflows configured (CI/CD)
2. Has NO required status checks in branch protection rules (or no branch protection at all)
3. Uses hive-mind's `--auto-restart-until-mergeable` flag

### Severity

**High** — posts a false "Ready to merge" notification on the PR, potentially misleading users into thinking CI has passed when it hasn't actually completed yet.

### Frequency

This affects any repository where branch protection doesn't enforce CI checks as required. This is a common setup — many public repositories have CI workflows but don't enforce them via branch protection.

---

## Evidence

### Primary Evidence

- **Calculator PR #82**: https://github.com/link-assistant/calculator/pull/82
- **False positive comment**: Posted at 19:37:47Z saying "No CI/CD checks are configured for this repository" — but 3 workflows exist
- **CI completion**: 13 checks completed between 19:37:57Z and 19:41:12Z — after the false positive
- **Full solution log**: `./full-solution-log.txt` (48,313 lines, 4.5MB)
- **Calculator PR data**: `./calculator-pr-82.json`
- **Calculator workflows**: `./calculator-workflows.json`
- **Branch protection**: `./calculator-branch-protection.json`

### Key Log Evidence

From `full-solution-log.txt` (end of file):
```
19:37:34Z  PR is already ready for review
19:37:47Z  ✅ PR IS MERGEABLE!
19:37:47Z  📬 "Ready to merge" comment posted: "No CI/CD checks are configured for this repository"
```

From GitHub Actions (after session ended):
```
19:37:57Z  First CI check started for SHA e0a064c
19:41:12Z  All CI checks completed (all PASS)
```

**Gap: 25 seconds** between the false positive and the first CI check registration.

---

## Test Coverage

New test file: `tests/test-false-positive-ready-to-merge-1363.mjs`

Tests cover:

1. `no_checks + MERGEABLE + has workflows` → race condition, `ci_pending` blocker (NOT `noCiConfigured`)
2. `no_checks + MERGEABLE + no workflows` → truly no CI configured, `noCiConfigured=true`
3. `no_checks + NOT MERGEABLE` → always race condition (same as before)
4. Workflow blocker includes workflow names in `details`
5. Backward compatibility: old behavior preserved for repos without workflows
6. False positive scenario exactly matching issue #1363
