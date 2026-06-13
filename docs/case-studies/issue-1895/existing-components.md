# Existing Components & Prior Art — Issue #1895

Per requirement R-8, this surveys the existing in-repo components reused (rather
than reinventing) and the external references that informed the fix.

## In-repo components reused

| Component                                                    | What it provides                                                                                          | How it is used here                                                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/github-linking.lib.mjs`                                 | `getGitHubLinkingKeywords()`, `prClosesIssue(text, issue, owner, repo)`, `extractLinkedIssueNumber(body)` | `classifyIssueLinkStatus` uses `prClosesIssue` to detect the keyword; the fallback derives the issue via `extractLinkedIssueNumber`. |
| `src/pr-issue-linking.lib.mjs`                               | `parseClosingIssueNumbers`, `closingIssueNumbersContain`, `ensureIssueLinkInPullRequestBody`              | The solve path already used `closingIssueNumbersContain` to detect the empty-link condition; we branch off it.                       |
| `src/github-rate-limit.lib.mjs`                              | `ghWithRateLimitRetry`, `wrapDollarWithGhRetry`                                                           | All new `gh` calls are wrapped for rate-limit safety (issue #1726), matching the rest of the merge subsystem.                        |
| `src/github-merge.lib.mjs` → `getDefaultBranch(owner, repo)` | Resolves the repository default branch                                                                    | Reused by `closeLinkedIssueIfNotAutoClosed` instead of a second API path.                                                            |
| `src/solve.auto-pr-fork-diagnostic.lib.mjs`                  | Pattern for branch/fork-aware diagnostics                                                                 | Model for the "explain the real reason, don't give generic advice" approach.                                                         |

The new module `src/github-issue-auto-close.lib.mjs` deliberately composes these
rather than duplicating keyword regexes or default-branch lookups.

## Why a new module (and not an extension of an existing one)

The two existing linking libraries answer "**is** there a link?" (`prClosesIssue`,
`closingIssueNumbersContain`). Issue #1895 needs a third question — "**why** is the
link absent, and what should we do about it?" — which depends on branch topology,
not just text. Keeping that in a dedicated `github-issue-auto-close.lib.mjs`
keeps each file single-purpose and under the repo's 1500-line limit (the merge
helper was further split into `github-merge-issue-close.lib.mjs` for the same
reason — mirroring the existing Issue #1413 `github-merge-ready-sync` split).

## GitHub behavior references (R-9, online research)

- **GitHub Docs — "Linking a pull request to an issue":** closing keywords
  (`close/closes/closed`, `fix/fixes/fixed`, `resolve/resolves/resolved`) link a
  PR to an issue; **"if you use a keyword to reference a pull request that is not
  on the default branch, the issue will not close when the pull request is merged
  into the non-default branch."** This is the documented behavior reproduced in
  this case study.
- **GraphQL `PullRequest.closingIssuesReferences`:** populated from the active
  closing references GitHub recognizes; empty for non-default-base PRs — which is
  exactly why hive-mind's verification saw an empty connection.
- **`gh issue close --reason completed`:** the supported CLI to close an issue as
  completed with a comment, used by the fallback.

## External libraries evaluated

There is no third-party library that "closes the linked issue when GitHub won't",
because the behavior is platform-specific and the remediation (close via the API
when base ≠ default) is a few lines once the topology is known. The `gh` CLI plus
the repo's own rate-limit wrappers are sufficient and consistent with the rest of
the codebase, so no new dependency was added.

## Best practices (the issue asked to "brainstorm best practices")

1. **Prefer default-branch PRs for issue closure.** A PR intended to close an
   issue should target the default branch whenever possible; only then does GitHub
   link and auto-close it.
2. **For intentional stacked/sub-issue branches**, accept that GitHub will not
   auto-close, and close the issue explicitly after the merge (what this PR now
   does automatically) — or re-base/re-target the final PR onto the default
   branch before merging.
3. **Never advise "add Fixes #N" without checking it is actually missing** — the
   absence of a _registered_ link does not imply the absence of the _keyword_.
4. **Make the tooling self-diagnosing** — emit the base/default branch and the
   classification reason so the next occurrence is explainable from logs alone.
