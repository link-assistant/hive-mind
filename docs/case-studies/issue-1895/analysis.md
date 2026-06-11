# Analysis — Issue #1895

## 1. The question, answered (R-1, R-9)

> _"Does that mean that issue will be closed only when merged to main branch?"_

**Yes — when the closing reference comes from a pull request.** GitHub auto-closes
an issue from a PR only when **both**:

1. the PR body or title contains a closing keyword
   (`close`/`closes`/`closed`, `fix`/`fixes`/`fixed`, `resolve`/`resolves`/`resolved`)
   referencing the issue, **and**
2. the PR's **base branch is the repository's default branch**.

GitHub's own documentation states it explicitly:

> _"If you use a keyword to reference a pull request that is not on the default
> branch, the issue will not close when the pull request is merged into the
> non-default branch."_
> — GitHub Docs, "Linking a pull request to an issue → About linked issues and
> pull requests."

The same rule governs the **`closingIssuesReferences`** GraphQL connection: it is
populated only for closing references that GitHub considers active, i.e. PRs whose
base is the default branch. A PR stacked onto another feature branch therefore
shows an **empty** `closingIssuesReferences` even though its body literally says
`Fixes #N`.

(Closing keywords in **commit messages** behave slightly differently — a commit
that lands on the default branch can close an issue — but the PR-link mechanism,
which is what hive-mind inspects, is default-branch-gated as above.)

## 2. Root causes (R-2, R-6)

The single user-visible symptom ("linking failed AND issue not closed") is
actually **two independent defects** that share the same trigger (a PR whose base
is a non-default branch).

### Root cause #2a — misleading diagnostic

`src/solve.auto-pr.lib.mjs` verified the link by checking
`closingIssuesReferences` (via `closingIssueNumbersContain`). When empty, it
printed:

```
⚠️  ISSUE LINK MISSING: PR not linked to issue
    Expected: "Fixes #49" in PR body
    To fix manually: ... Ensure it contains: Fixes #49
```

This advice is **wrong** in the #1895 scenario: `Fixes #49` was already in the
body (verified — see [`data/meta-language-pr-65.json`](./data/meta-language-pr-65.json)).
The real reason for the empty connection is the non-default base branch, which the
old code never considered. A user following the advice would re-add a keyword that
is already there and see no change.

### Root cause #2b — no post-merge close fallback

None of the merge paths compensated for GitHub not auto-closing the issue. So when
PR #65/#66 merged into `issue-47-...`, issues #49/#50 were simply left open. The
PR was "closed" (merged) "without its issue to be closed as well" — the exact
wording of the issue title.

### Evidence

`gh api graphql` against `link-foundation/meta-language`
(saved verbatim in [`data/meta-language-graphql-evidence.json`](./data/meta-language-graphql-evidence.json)):

```json
{
  "defaultBranchRef": { "name": "main" },
  "pr65": { "baseRefName": "issue-47-76af108c0f24", "headRefName": "issue-49-3a3011bb1089", "merged": true, "closingIssuesReferences": { "nodes": [] } },
  "pr66": { "baseRefName": "issue-47-76af108c0f24", "headRefName": "issue-50-2b26543616e5", "merged": true, "closingIssuesReferences": { "nodes": [] } }
}
```

Both PRs: non-default base, merged, **empty** closing refs. Issues #49 and #50:
**OPEN**. Root cause confirmed beyond doubt.

## 3. Solution options and the chosen plan (R-7)

### Options considered

| Option                                                                           | Verdict                                                                                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Always create PRs against the default branch** (`main`)                     | Rejected as the _sole_ fix. It breaks the intentional stacked / sub-issue workflow where a child PR must merge into its parent branch. |
| **B. Detect the non-default-base case and explain it accurately** (diagnostic)   | ✅ Chosen — addresses root cause #2a. Cheap, always correct, no behavioral risk.                                                       |
| **C. Explicitly close the linked issue after a non-default-base merge** (action) | ✅ Chosen — addresses root cause #2b. Restores the user's expectation that merging the PR closes the issue.                            |
| **D. Re-target PRs to default branch automatically**                             | Rejected — would silently change merge semantics and could merge unreviewed parent-branch changes into `main`.                         |

### Chosen plan (B + C, applied everywhere — R-12)

1. **Shared library** `src/github-issue-auto-close.lib.mjs`:
   - `gitHubAutoClosesOnMerge(baseBranch, defaultBranch)` → `true`/`false`/`null`.
   - `classifyIssueLinkStatus({...})` → `{ hasClosingKeyword, autoCloses,
targetsNonDefaultBranch, requiresManualClose, reason }` with `reason ∈
{github-linked, missing-keyword, non-default-base-branch,
keyword-present-link-pending}`.
   - `buildNonDefaultBranchExplanation({...})` → shared human-readable lines.
   - `ensureLinkedIssueClosedAfterMerge({...})` → async post-merge fallback that
     closes the linked issue (with an explanatory comment) only when GitHub will
     not, and is a safe no-op otherwise (default base / already closed / no
     keyword / unknown branch).

2. **Diagnostic wiring** (`solve.auto-pr.lib.mjs`): when the link is absent,
   classify first. For `non-default-base-branch`, print **"ISSUE LINK DEFERRED"**
   plus the shared explanation instead of the misleading "ISSUE LINK MISSING".
   The genuine missing-keyword and fork cases keep their original guidance.

3. **Action wiring** in **every** merge path (R-12):
   - `solve.auto-merge.lib.mjs`: `watchUntilMergeable` (auto-merge) and
     `attemptAutoMerge` (one-shot) both call `ensureLinkedIssueClosedAfterMerge`
     after a successful merge.
   - `github-merge.lib.mjs` → `closeLinkedIssueIfNotAutoClosed` (extracted to
     `github-merge-issue-close.lib.mjs` to respect the 1500-line file limit),
     used by the `/merge` queue.
   - `telegram-merge-queue.lib.mjs`: calls it after "Successfully merged PR".

### Safety / idempotency

`ensureLinkedIssueClosedAfterMerge` and `closeLinkedIssueIfNotAutoClosed` both:

- **skip** when `baseBranch === defaultBranch` (GitHub handles it),
- **skip** when the PR body/title has no closing keyword,
- **skip** when the issue is already `CLOSED`,
- **skip** when branch info cannot be determined (leave it to GitHub),
- only then close the issue with `--reason completed` and an explanatory comment
  that links back to this issue.

All `gh` calls route through the repository's rate-limit-aware wrappers
(`ghWithRateLimitRetry` / `wrapDollarWithGhRetry`, issue #1726).

## 4. Verbose / debug output (R-10)

The root cause was fully determined, but per the issue we also strengthened
observability so any recurrence is self-diagnosing:

- `classifyIssueLinkStatus` returns a machine-readable `reason`.
- The solve path prints an explicit **"ISSUE LINK DEFERRED"** block naming the
  base branch, the default branch, and why the link/close will not happen.
- The fallback helpers emit `[auto-close] …` / `[VERBOSE] /merge: …` lines under
  `--verbose` for every decision (skip reason or explicit close).

## 5. Tests (R-14)

`tests/github-issue-auto-close.test.mjs` (14 cases) covers:

- `gitHubAutoClosesOnMerge` for default, non-default, and unknown inputs;
- `classifyIssueLinkStatus` for the #1895 non-default-base case, the
  default-base-pending case, the genuine missing-keyword case, the already-linked
  case, and cross-repo (fork) keywords;
- `buildNonDefaultBranchExplanation` content;
- `ensureLinkedIssueClosedAfterMerge` against a fake `$` exec: closes on
  non-default base, skips on default base / already-closed / no-keyword, and
  derives the issue number from the PR body when not supplied.
