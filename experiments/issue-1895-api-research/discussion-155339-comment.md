+1 — this gap actively blocks automation.

We run an automated agent ([hive-mind](https://github.com/link-assistant/hive-mind)) that opens a PR per issue. When a PR is stacked onto a **non-default base branch** (e.g. a parent `issue-47-…` branch rather than `main`), there is currently **no API path** to create a PR↔issue link that GitHub recognizes:

- Closing keywords (`Fixes #N`) in the PR body are silently ignored for non-default-base PRs — `closingIssuesReferences` stays empty and the issue never auto-closes.
- The web-UI **Development** sidebar _can_ link them, but — as this discussion notes — there is no `linkPullRequestToIssue` / `addClosingIssueReference` mutation (nor any REST endpoint), and `createPullRequest`/`updatePullRequest` expose no linked-issue field.

Reproducible public example — PR #65 in `link-foundation/meta-language` has `Fixes #49` in its body but a non-default base:

```graphql
{
  repository(owner: "link-foundation", name: "meta-language") {
    pullRequest(number: 65) {
      baseRefName # "issue-47-…"  (non-default)
      closingIssuesReferences(first: 5) {
        nodes {
          number
        }
      } # []  ← no link registered
    }
    issue(number: 49) {
      timelineItems(first: 20, itemTypes: [CROSS_REFERENCED_EVENT]) {
        nodes {
          ... on CrossReferencedEvent {
            willCloseTarget
            source {
              ... on PullRequest {
                number
              }
            }
          }
        }
      }
    }
  }
}
# The cross-reference from PR #65 exists but willCloseTarget = false,
# i.e. GitHub itself records that the keyword was NOT honored as a closing link.
```

What we'd love, **either**:

1. a mutation to explicitly link an existing PR (and an existing branch) to an issue — the Development-sidebar action — and/or
2. honoring closing keywords / populating `closingIssuesReferences` for non-default-base PRs (see also [#112224](https://github.com/orgs/community/discussions/112224)).

Without it, automation has to bypass GitHub's linking entirely: rediscover the PR via a deterministic branch-name search and run an explicit post-merge `gh issue close`. An official API would remove a lot of fragile glue. (Reading the link back is also unsolved — [#179613](https://github.com/orgs/community/discussions/179613).)
