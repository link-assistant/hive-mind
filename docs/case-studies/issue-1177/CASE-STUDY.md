# Case Study: Issue #1177 - 'ready' Label Not Created by /merge Command

## Executive Summary

**Issue:** [#1177 - 'ready' was not created by /merge command](https://github.com/link-assistant/hive-mind/issues/1177)

**Date Reported:** 2026-01-25

**Status:** Open

**Root Cause:** User expectation mismatch - the `/merge` command was designed to process PRs that already have the `ready` label, not to automatically identify and label PRs that are ready to merge.

## 1. Timeline of Events

### Phase 1: Feature Request (Issue #1143)
**Date:** 2026-01-20

The feature was originally requested in [Issue #1143 - Merge queue in hive-telegram-bot](https://github.com/link-assistant/hive-mind/issues/1143), which specified:
- Add `/merge` command that accepts repository link
- Check all issues with `ready` label
- If no such label configured, create it with description "Is ready to be merged"
- Sort all `ready` PRs by creation time and merge sequentially

### Phase 2: Implementation (PR #1144)
**Date:** 2026-01-20

[PR #1144 - Add experimental /merge command](https://github.com/link-assistant/hive-mind/pull/1144) implemented the feature with:
- `ensureReadyLabel()` - Creates the `ready` label if it doesn't exist
- `getAllReadyPRs()` - Fetches PRs with the `ready` label
- Sequential merge processing with CI/CD monitoring

### Phase 3: User Report (Issue #1177)
**Date:** 2026-01-25

User ran `/merge https://github.com/link-assistant/hive-mind` and received:
```
Merge Queue - link-assistant/hive-mind

No PRs with 'ready' label found

To use the merge queue:
1. Add the ready label to PRs you want to merge
2. Run /merge https://github.com/link-assistant/hive-mind again
```

**User's Expectation:** "As bot had access to this repository, it should have added the 'ready' [label] itself automatically, without need for user intervention."

## 2. Root Cause Analysis

### 2.1 Design Ambiguity in Original Requirements

The original issue (#1143) stated:
> "checks all issues with `ready` label (if no such label configured for the repository, and we have permissions to configure it should configure such label)"

This was interpreted as:
1. Create the `ready` **label definition** in the repository if it doesn't exist
2. Find items that already have this label

**But could be interpreted as:**
1. Create the label definition
2. Automatically identify PRs that are "ready to merge" and apply the label to them

### 2.2 Gap Analysis: Current vs Expected Behavior

| Aspect | Current Behavior | Expected Behavior (per user) |
|--------|-----------------|------------------------------|
| Label creation | Creates `ready` label definition | Same |
| Label assignment | Does NOT auto-assign | Should auto-detect and assign |
| Readiness detection | None | Detect PRs meeting merge criteria |

### 2.3 Technical Implementation Details

The current implementation in `src/github-merge.lib.mjs`:

```javascript
// Current: Only ensures label EXISTS in repository
export async function ensureReadyLabel(owner, repo, verbose = false) {
  const { exists } = await checkReadyLabelExists(owner, repo, verbose);
  if (exists) {
    return { success: true, created: false, error: null };
  }
  // Creates label if it doesn't exist
  const createResult = await createReadyLabel(owner, repo, verbose);
  // ...
}
```

**Missing functionality:** No code exists to:
1. Evaluate which PRs are "ready to merge"
2. Automatically apply the `ready` label to eligible PRs

## 3. Industry Research: How Other Systems Handle This

### 3.1 GitHub Native Merge Queue
- **Approach:** Manual addition to queue by users with write access
- **Readiness:** PR must pass all branch protection checks
- **Source:** [GitHub Docs - Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

### 3.2 Bors-NG (Deprecated)
- **Approach:** Review-driven - PRs marked "bors r+" are queued
- **Readiness:** Requires human reviewer approval via comment
- **Source:** [bors-ng/bors-ng](https://github.com/bors-ng/bors-ng)

### 3.3 Bulldozer (Palantir)
- **Approach:** Configurable triggers (labels, comments, patterns)
- **Readiness:** All required status checks pass + required reviews provided
- **Auto-label:** No - relies on triggers set by humans/workflows
- **Source:** [palantir/bulldozer](https://github.com/palantir/bulldozer)

### 3.4 Automerge-Action (pascalgn)
- **Approach:** Label-based (`automerge` label)
- **Readiness:** Checks pass + reviews provided + label present
- **Auto-label:** No - label must be applied manually or via other workflows
- **Source:** [pascalgn/automerge-action](https://github.com/pascalgn/automerge-action)

### 3.5 MergeQueue.com
- **Approach:** SaaS product for merge queue management
- **Features:** Fast forwarding, auto-rebasing, custom validations
- **Source:** [MergeQueue.com](https://mergequeue.com/)

### 3.6 Key Insight
**None of the major tools automatically label PRs as "ready."** The common pattern is:
1. PRs meet certain conditions (CI passes, reviews approved)
2. A human or automation workflow explicitly adds a "ready" label or command
3. The merge queue processes labeled items

## 4. Possible Solutions

### Solution 1: Auto-Label PRs That Meet Criteria (Complex)

**Description:** Add functionality to `/merge` to auto-detect and label PRs meeting merge criteria.

**Criteria for "Ready to Merge":**
- All required CI checks passing
- All required reviews approved
- No merge conflicts
- Not a draft PR
- Branch is up-to-date with base (or can be auto-rebased)

**Implementation:**
```javascript
async function autoLabelReadyPRs(owner, repo) {
  // Fetch all open PRs
  const allPRs = await fetchAllOpenPRs(owner, repo);

  for (const pr of allPRs) {
    // Check if PR already has 'ready' label
    if (hasReadyLabel(pr)) continue;

    // Check readiness criteria
    const ciStatus = await checkPRCIStatus(owner, repo, pr.number);
    const mergeableCheck = await checkPRMergeable(owner, repo, pr.number);
    const reviewStatus = await checkPRReviewStatus(owner, repo, pr.number);

    if (ciStatus.allPassed && mergeableCheck.mergeable && reviewStatus.approved) {
      await addLabelToPR(owner, repo, pr.number, 'ready');
      log(`Auto-labeled PR #${pr.number} as 'ready'`);
    }
  }
}
```

**Pros:**
- Fully automatic workflow
- Reduces manual intervention
- Matches user expectation

**Cons:**
- High complexity
- Risk of premature merging
- May conflict with human judgment on readiness
- Requires careful definition of "ready" criteria
- Could be noisy for large repos with many PRs

**Estimated Effort:** High (2-3 days)

### Solution 2: Suggest Ready PRs (Medium)

**Description:** When no `ready` PRs are found, analyze all open PRs and suggest which ones could be labeled.

**Implementation:**
```javascript
if (readyPRs.length === 0) {
  const suggestions = await findMergeablePRs(owner, repo);

  if (suggestions.length > 0) {
    message += "Suggested PRs that appear ready to merge:\n";
    for (const pr of suggestions) {
      message += `  - PR #${pr.number}: ${pr.title}\n`;
      message += `    CI: ${pr.ciStatus}, Reviews: ${pr.reviewStatus}\n`;
    }
    message += "\nTo add to merge queue, add the 'ready' label to these PRs.";
  }
}
```

**Pros:**
- Informative without being intrusive
- Maintains human control over labeling decisions
- Low risk
- Clear user guidance

**Cons:**
- Still requires manual label application
- Additional API calls for analysis

**Estimated Effort:** Medium (1 day)

### Solution 3: Provide `/merge --auto-label` Flag (Recommended)

**Description:** Add an optional `--auto-label` flag that enables automatic labeling when explicitly requested.

**Usage:**
```
/merge https://github.com/owner/repo --auto-label
```

**Implementation:**
1. By default: Current behavior (only process existing `ready` PRs)
2. With `--auto-label`: Scan PRs, auto-label those meeting criteria, then process

**Pros:**
- Backward compatible
- User explicitly opts into auto-labeling
- Clear intent from user
- Maintains safety by default

**Cons:**
- Additional flag complexity
- User must know about the flag

**Estimated Effort:** Medium (1-2 days)

### Solution 4: Improve Documentation & UX (Minimal)

**Description:** Enhance the response message to better explain the workflow.

**Current Message:**
```
No PRs with 'ready' label found

To use the merge queue:
1. Add the ready label to PRs you want to merge
2. Run /merge https://github.com/link-assistant/hive-mind again
```

**Improved Message:**
```
No PRs with 'ready' label found

The merge queue processes PRs that have been marked as 'ready' for merging.

How to use:
1. Review PRs that should be merged
2. Add the 'ready' label to each PR you want to merge
3. Run /merge https://github.com/link-assistant/hive-mind

Note: The 'ready' label indicates intentional approval for merging.
This prevents accidental merges of PRs that pass CI but aren't approved.
```

**Pros:**
- Zero code changes to merge logic
- Sets clear expectations
- Explains the rationale

**Cons:**
- Does not address the automation desire
- User workflow unchanged

**Estimated Effort:** Low (0.5 days)

### Solution 5: GitHub Actions Integration

**Description:** Provide a GitHub Actions workflow that auto-labels PRs meeting criteria.

**Example Workflow:**
```yaml
name: Auto-label Ready PRs
on:
  pull_request:
    types: [opened, synchronize, ready_for_review]
  pull_request_review:
    types: [submitted]
  check_suite:
    types: [completed]

jobs:
  auto-label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const { owner, repo } = context.repo;
            const pr = context.payload.pull_request;

            // Check all conditions
            const checks = await github.rest.checks.listForRef({
              owner, repo,
              ref: pr.head.sha
            });

            const allPassed = checks.data.check_runs.every(
              c => c.conclusion === 'success' || c.conclusion === 'skipped'
            );

            const reviews = await github.rest.pulls.listReviews({
              owner, repo,
              pull_number: pr.number
            });

            const approved = reviews.data.some(r => r.state === 'APPROVED');

            if (allPassed && approved && pr.mergeable) {
              await github.rest.issues.addLabels({
                owner, repo,
                issue_number: pr.number,
                labels: ['ready']
              });
            }
```

**Pros:**
- Decoupled from bot
- Real-time labeling as conditions are met
- Customizable per repository

**Cons:**
- Requires setup in each repository
- Not controlled by bot

**Estimated Effort:** Medium (1 day to create template)

## 5. Recommendation

### Short-term (Immediate)
Implement **Solution 4 (Improved Documentation)** to set correct expectations while planning further work.

### Medium-term (1-2 sprints)
Implement **Solution 3 (/merge --auto-label flag)** as it:
- Provides the desired automation
- Maintains backward compatibility
- Requires explicit user consent
- Is relatively safe

### Long-term
Consider **Solution 5 (GitHub Actions template)** as a complementary feature that repositories can opt into for real-time auto-labeling.

## 6. Existing Libraries & Tools That Could Help

| Library/Tool | Use Case | Link |
|-------------|----------|------|
| GitHub REST API | PR status checks, labels | [API Docs](https://docs.github.com/en/rest) |
| GitHub GraphQL API | Batch queries for PR data | [GraphQL Docs](https://docs.github.com/en/graphql) |
| @octokit/rest | Node.js GitHub API client | [npm](https://www.npmjs.com/package/@octokit/rest) |
| gh CLI | Used in current implementation | [GitHub CLI](https://cli.github.com/) |

## 7. Files and Data Collected

All raw data and evidence has been saved to:
- `docs/case-studies/issue-1177/raw-data/issue-1177.json` - Original issue data
- `docs/case-studies/issue-1177/raw-data/issue-1143.json` - Related feature request
- `docs/case-studies/issue-1177/raw-data/pr-1144.json` - Implementation PR data
- `docs/case-studies/issue-1177/screenshot.png` - User's screenshot showing the issue
- `docs/case-studies/issue-1177/related-issues-search.txt` - Related issues search results
- `docs/case-studies/issue-1177/related-prs-search.txt` - Related PRs search results
- `docs/case-studies/issue-1177/issue-1143.txt` - Original feature request text
- `docs/case-studies/issue-1177/pr-1144.txt` - Implementation PR description

## 8. Key Takeaways

1. **Requirement Ambiguity:** The original requirement "configure such label" was ambiguous - it meant "create label definition" but could be read as "apply label to items."

2. **Industry Standard:** No major merge queue tool auto-labels PRs. The pattern is always: human/workflow adds label -> tool processes labeled items.

3. **Safety Concern:** Auto-labeling PRs as "ready" without explicit human approval could lead to unwanted merges.

4. **User Expectation Gap:** Users may expect full automation, but the design intentionally requires human decision-making on what's "ready."

## 9. References

- [GitHub - Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [GitHub - bors-ng/bors-ng](https://github.com/bors-ng/bors-ng)
- [GitHub - palantir/bulldozer](https://github.com/palantir/bulldozer)
- [GitHub - pascalgn/automerge-action](https://github.com/pascalgn/automerge-action)
- [MergeQueue.com](https://mergequeue.com/)

---

*Case study compiled: 2026-01-25*
*Author: AI Issue Solver*
