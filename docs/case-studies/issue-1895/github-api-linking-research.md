# GitHub API research — can we link a PR to an issue programmatically? (R-15)

> Driven by the maintainer's follow-up on PR #1896:
> _"We need to be able to do linking of pull requests to issues via API, as we can
> do it manually in web UI. Maybe we just missed that API? Or if it does not exist,
> we need to report all the issues."_

This document answers that question authoritatively, with live evidence, and
records the upstream reports we filed/supported.

## TL;DR

- **We did not miss an API. It does not exist.** There is **no** public GitHub API
  (REST _or_ GraphQL) to manually link an existing pull request to an issue the way
  the web UI **Development** sidebar does.
- The only API-reachable link mechanism is **closing keywords** (`Fixes #N`) in the
  PR body/commits — and GitHub honors those **only when the PR targets the default
  branch**. For a non-default base they are silently ignored (no closing reference,
  no auto-close).
- Even the manual Development-sidebar link (if an API existed) **still** only
  auto-closes on a default-branch merge — so an API alone would not remove our need
  for the post-merge close fallback; it would only restore _discoverability_.
- This is a known, unresolved platform gap. We **upvoted and added evidence** to the
  canonical upstream feedback (see "What we reported", below).

## 1. What the web UI does, and why there's no API for it

Anyone with write access can open a PR (or issue) and use the **Development**
sidebar to "Link an issue / pull request". The web client performs this with an
**internal, unpublished GraphQL mutation** that GitHub has never added to the
public schema.

### Proof by live schema introspection (`data/github-api-introspection.txt`)

The complete list of public mutations whose name matches `link|connect|clos|refer`:

```
closeDiscussion, closeIssue, closePullRequest,
createLinkedBranch, deleteLinkedBranch,
linkProjectV2ToRepository, linkProjectV2ToTeam,
unlinkProjectV2FromRepository, unlinkProjectV2FromTeam,
updateCheckSuitePreferences, updateSponsorshipPreferences
```

- There is **no** `linkPullRequestToIssue`, `addClosingIssueReference`,
  `connectIssue`, or equivalent.
- `createLinkedBranch` links a **newly created branch** to an issue — not a PR, and
  it cannot link an _existing_ branch (passing an existing name silently fails; see
  upstream #155339).
- `CreatePullRequestInput` fields: `repositoryId, baseRefName, headRefName,
headRepositoryId, title, body, maintainerCanModify, draft` — **no linked-issue
  field**.
- `UpdatePullRequestInput` fields: `baseRefName, title, body, state,
maintainerCanModify, assigneeIds, milestoneId, labelIds, projectIds` — **no
  linked-issue field**.

### REST API

There is likewise no REST endpoint to create the link. (There isn't even a clean
endpoint to _read_ the linked issues of a PR — see upstream #179613.)

## 2. The one API-reachable mechanism, and its hard limit

Closing keywords in the PR body are the only way the API can influence the link —
and GitHub honors them **only for default-branch PRs**. Quoting GitHub Docs
(_Using keywords in issues and pull requests_):

> "The special keywords in a pull request description are interpreted only when the
> pull request targets the repository's **default branch**. If the pull request
> targets **any other branch**, then these keywords are ignored, no links are
> created, and merging the PR has no effect on the issues."

And (_Linking a pull request to an issue_):

> "When you merge a linked pull request into the **default branch** of a repository,
> its linked issue is automatically closed."

That second sentence governs **manually linked** PRs too: even a Development-sidebar
link auto-closes only on a default-branch merge. So an API to create the link would
buy us **discoverability**, not auto-close on non-default merges.

## 3. Empirical confirmation on our own data

Refreshed live capture (`data/meta-language-evidence-refreshed.json`):

| PR  | base                    | merged | `closingIssuesReferences` | issue cross-ref `willCloseTarget` |
| --- | ----------------------- | ------ | ------------------------- | --------------------------------- |
| #65 | `issue-47-76af108c0f24` | ✅     | `[]` (empty)              | #49 ← **`false`**                 |
| #66 | `issue-47-76af108c0f24` | ✅     | `[]` (empty)              | #50 ← **`false`**                 |

Two things this proves:

1. The `Fixes #49` keyword in PR #65 **does** create a `CrossReferencedEvent` in
   issue #49's timeline — so the relationship is _visible/discoverable_ already —
   **but** GitHub itself stamps that cross-reference with **`willCloseTarget:
false`**: a machine-readable admission that the keyword was **not** honored as a
   closing link (because of the non-default base).
2. Issues #49/#50 were eventually closed — but by PR **#48** (a default-branch
   parent PR) and a later commit, **never by their own PRs #65/#66**. The PRs that
   were supposed to close them never did; only unrelated default-branch activity
   did, later. That is exactly the failure #1895 reports.

## 4. What this means for hive-mind (no code change required)

Because no link API exists, hive-mind already compensates with the two mechanisms
GitHub _does_ allow, both shipped in this PR:

| Need                              | GitHub-native (non-default base) | hive-mind compensation (this PR)                                                            |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------- |
| **Discover** a PR from its issue  | ❌ `linked:` search misses it    | `head:issue-N-` deterministic branch search (`collectIssuePrCandidates`)                    |
| **Visible** PR↔issue relationship | ✅ cross-reference event exists  | (already present via the `Fixes #N` keyword in the PR body — no extra action needed)        |
| **Close** the issue on merge      | ❌ no auto-close                 | explicit post-merge `ensureLinkedIssueClosedAfterMerge` / `closeLinkedIssueIfNotAutoClosed` |

The cross-reference (point 2 in §3) means a true "create the link" API would have
been redundant for _visibility_; the genuinely missing capability — auto-close on
non-default merges — is a GitHub-side gap that no API currently fills, hence the
upstream report.

## 5. What we reported (R-11, corrected)

The earlier conclusion ("no GitHub bug to report") was **too narrow**: the
auto-close-on-default-branch _rule_ is documented, but the **absence of any API to
link a PR to an issue** (and the absence of non-default-branch auto-close) is a real
platform gap that legitimately warrants feedback. The canonical upstream threads
already exist, so — per open-source etiquette — we **added weight and evidence**
rather than filing duplicates (snapshot in `data/github-upstream-discussions.txt`):

| Discussion (community/community)                                                                                         | Gap                                                  | Action taken (as maintainer `konard`)                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#155339](https://github.com/orgs/community/discussions/155339) — _Missing mutations for linking existing branch and PR_ | **No API to link an existing PR/branch to an issue** | 👍 upvoted **+** [posted reproducible evidence + use case](https://github.com/community/community/discussions/155339#discussioncomment-17288911) |
| [#112224](https://github.com/orgs/community/discussions/112224) — _Close issues by merging PRs to non-main branches_     | **No auto-close for non-default-base merges**        | 👍 upvoted                                                                                                                                       |
| [#179613](https://github.com/orgs/community/discussions/179613) — _Retrieve linked issues for a PR via REST API_         | **No API to _read_ a PR's linked issues**            | 👍 upvoted                                                                                                                                       |

We did **not** open a new discussion, because each gap is already tracked; a
duplicate would be noise. If GitHub ships either capability (link mutation, or
non-default-branch auto-close), hive-mind can drop the corresponding workaround.

## 6. How to reproduce (anyone)

```bash
# (a) No link mutation exists in the public GraphQL schema:
gh api graphql -f query='query { __schema { mutationType { fields { name } } } }' \
  --jq '.data.__schema.mutationType.fields[] | select(.name|test("(?i)link|connect|clos|refer")) | .name'
# -> createLinkedBranch / deleteLinkedBranch (branches only); NO linkPullRequestToIssue

# (b) createPullRequest / updatePullRequest accept no linked-issue field:
gh api graphql -f query='query { __type(name:"CreatePullRequestInput"){ inputFields{ name } } }' \
  --jq '.data.__type.inputFields[].name'

# (c) A non-default-base PR's keyword is not honored (willCloseTarget=false):
gh api graphql -f query='{ repository(owner:"link-foundation", name:"meta-language") {
  pullRequest(number:65){ baseRefName closingIssuesReferences(first:5){ nodes{ number } } }
  issue(number:49){ timelineItems(first:20, itemTypes:[CROSS_REFERENCED_EVENT]){ nodes{
    ... on CrossReferencedEvent { willCloseTarget source{ ... on PullRequest { number } } } } } }
}}'
```
