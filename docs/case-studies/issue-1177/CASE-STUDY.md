# Case Study: Issue #1177 - 'ready' Label Not Created by /merge Command

## Executive Summary

**Issue:** [#1177 - 'ready' was not created by /merge command](https://github.com/link-assistant/hive-mind/issues/1177)

**Date Reported:** 2026-01-25

**Status:** Resolved

**Root Cause:** Two bugs in the label creation code:

1. `checkReadyLabelExists()` incorrectly interpreted GitHub API's 404 JSON error response as the label existing
2. `createReadyLabel()` used bash-specific heredoc syntax (`<<<`) that fails in `/bin/sh`

**Resolution:** Fixed both bugs by:

1. Adding proper check for "Not Found" message in the API response
2. Using `gh api -f` flags instead of heredoc for passing JSON fields

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

### 2.1 Bug #1: Incorrect 404 Response Handling

The `checkReadyLabelExists()` function had a critical bug in how it handled GitHub API responses.

**Original code:**

```javascript
export async function checkReadyLabelExists(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/labels/${READY_LABEL.name} 2>/dev/null || echo ""`);
    if (stdout.trim()) {
      const label = JSON.parse(stdout.trim());
      // BUG: Assumes any JSON response means label exists!
      return { exists: true, label };
    }
    return { exists: false, label: null };
  } catch (error) {
    return { exists: false, label: null };
  }
}
```

**The problem:** When a label doesn't exist, the GitHub API returns a 404 response with JSON body:

```json
{ "message": "Not Found", "documentation_url": "...", "status": "404" }
```

The code only checked `if (stdout.trim())` - since this returns truthy (the error JSON), it incorrectly concluded the label existed.

**Evidence from debugging:**

```javascript
// Test output:
stdout: "{\"message\":\"Not Found\",\"documentation_url\":\"...\",\"status\":\"404\"}"
stdout.trim(): "{\"message\":\"Not Found\",...}"
// Code incorrectly returns: { exists: true, label: errorJson }
```

### 2.2 Bug #2: Shell Incompatibility

The `createReadyLabel()` function used bash-specific heredoc syntax:

**Original code:**

```javascript
const { stdout } = await exec(`gh api repos/${owner}/${repo}/labels -X POST -H "Accept: application/vnd.github+json" --input - <<< '${labelData}'`);
```

**The problem:** The `<<<` (here-string) syntax is bash-specific and fails in `/bin/sh`:

```
/bin/sh: 1: Syntax error: redirection unexpected
```

Node.js `child_process.exec()` uses `/bin/sh` by default, not bash.

### 2.3 Impact Analysis

| Bug    | Effect                              | Result                              |
| ------ | ----------------------------------- | ----------------------------------- |
| Bug #1 | Label check always returns "exists" | Label creation skipped              |
| Bug #2 | Label creation command fails        | Label not created even if attempted |

These bugs meant the `/merge` command could never successfully create the `ready` label, even though the code appeared to have this functionality.

## 3. Resolution

### 3.1 Fix for Bug #1: Proper 404 Detection

**Fixed code:**

```javascript
export async function checkReadyLabelExists(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/labels/${READY_LABEL.name} 2>/dev/null || echo ""`);
    if (stdout.trim()) {
      const label = JSON.parse(stdout.trim());
      // Check if the response is an error (404 Not Found returns JSON with "message" field)
      if (label.message === 'Not Found' || label.status === '404') {
        return { exists: false, label: null };
      }
      // Valid label has a 'name' field
      if (label.name) {
        return { exists: true, label };
      }
      // Unknown response format, treat as not found
      return { exists: false, label: null };
    }
    return { exists: false, label: null };
  } catch (error) {
    return { exists: false, label: null };
  }
}
```

### 3.2 Fix for Bug #2: Shell-Compatible Command

**Fixed code:**

```javascript
export async function createReadyLabel(owner, repo, verbose = false) {
  try {
    // Use gh api with -f flags to pass fields directly (avoids shell heredoc compatibility issues)
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/labels -X POST -H "Accept: application/vnd.github+json" -f name="${READY_LABEL.name}" -f description="${READY_LABEL.description}" -f color="${READY_LABEL.color}"`);
    const label = JSON.parse(stdout.trim());
    return { success: true, label, error: null };
  } catch (error) {
    return { success: false, label: null, error: error.message };
  }
}
```

### 3.3 Verification

After applying the fixes, testing confirmed:

1. `checkReadyLabelExists()` correctly returns `{ exists: false }` when label doesn't exist
2. `createReadyLabel()` successfully creates the label
3. The `ready` label is now present in the repository

## 4. Industry Research: How Other Systems Handle This

### 4.1 GitHub Native Merge Queue

- **Approach:** Manual addition to queue by users with write access
- **Readiness:** PR must pass all branch protection checks
- **Source:** [GitHub Docs - Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)

### 4.2 Bors-NG (Deprecated)

- **Approach:** Review-driven - PRs marked "bors r+" are queued
- **Readiness:** Requires human reviewer approval via comment
- **Source:** [bors-ng/bors-ng](https://github.com/bors-ng/bors-ng)

### 4.3 Bulldozer (Palantir)

- **Approach:** Configurable triggers (labels, comments, patterns)
- **Readiness:** All required status checks pass + required reviews provided
- **Auto-label:** No - relies on triggers set by humans/workflows
- **Source:** [palantir/bulldozer](https://github.com/palantir/bulldozer)

### 4.4 Automerge-Action (pascalgn)

- **Approach:** Label-based (`automerge` label)
- **Readiness:** Checks pass + reviews provided + label present
- **Auto-label:** No - label must be applied manually or via other workflows
- **Source:** [pascalgn/automerge-action](https://github.com/pascalgn/automerge-action)

### 4.5 MergeQueue.com

- **Approach:** SaaS product for merge queue management
- **Features:** Fast forwarding, auto-rebasing, custom validations
- **Source:** [MergeQueue.com](https://mergequeue.com/)

### 4.6 Key Insight

**None of the major tools automatically label PRs as "ready."** The common pattern is:

1. PRs meet certain conditions (CI passes, reviews approved)
2. A human or automation workflow explicitly adds a "ready" label or command
3. The merge queue processes labeled items

## 5. Other Considered Solutions (For Future Reference)

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
    message += 'Suggested PRs that appear ready to merge:\n';
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

## 6. (Obsolete) Original Recommendations

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

## 7. Existing Libraries & Tools That Could Help

| Library/Tool       | Use Case                       | Link                                               |
| ------------------ | ------------------------------ | -------------------------------------------------- |
| GitHub REST API    | PR status checks, labels       | [API Docs](https://docs.github.com/en/rest)        |
| GitHub GraphQL API | Batch queries for PR data      | [GraphQL Docs](https://docs.github.com/en/graphql) |
| @octokit/rest      | Node.js GitHub API client      | [npm](https://www.npmjs.com/package/@octokit/rest) |
| gh CLI             | Used in current implementation | [GitHub CLI](https://cli.github.com/)              |

## 8. Files and Data Collected

All raw data and evidence has been saved to:

- `docs/case-studies/issue-1177/raw-data/issue-1177.json` - Original issue data
- `docs/case-studies/issue-1177/raw-data/issue-1143.json` - Related feature request
- `docs/case-studies/issue-1177/raw-data/pr-1144.json` - Implementation PR data
- `docs/case-studies/issue-1177/screenshot.png` - User's screenshot showing the issue
- `docs/case-studies/issue-1177/related-issues-search.txt` - Related issues search results
- `docs/case-studies/issue-1177/related-prs-search.txt` - Related PRs search results
- `docs/case-studies/issue-1177/issue-1143.txt` - Original feature request text
- `docs/case-studies/issue-1177/pr-1144.txt` - Implementation PR description

## 9. Key Takeaways

1. **API Error Response Handling:** GitHub API returns JSON error bodies for 404 responses. Code must check for error indicators (`message: "Not Found"`) rather than just checking if response is non-empty.

2. **Shell Compatibility:** Node.js `child_process.exec()` uses `/bin/sh` by default, not bash. Avoid bash-specific features like heredocs (`<<<`). Use alternative approaches like `gh api -f` flags.

3. **Testing Edge Cases:** The label creation code was never tested in a repository that didn't already have the label, which allowed these bugs to go undetected.

4. **Debug Output:** Adding verbose logging helped identify the root cause by showing the actual API responses being received.

5. **Original Analysis vs Reality:** Initial analysis incorrectly attributed the issue to "user expectation mismatch" when the actual cause was implementation bugs. Always test assumptions with actual code execution.

## 10. References

- [GitHub - Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)
- [GitHub - bors-ng/bors-ng](https://github.com/bors-ng/bors-ng)
- [GitHub - palantir/bulldozer](https://github.com/palantir/bulldozer)
- [GitHub - pascalgn/automerge-action](https://github.com/pascalgn/automerge-action)
- [MergeQueue.com](https://mergequeue.com/)

---

_Case study compiled: 2026-01-25_
_Author: AI Issue Solver_
