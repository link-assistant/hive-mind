# External Reporting Decision — Issue #1895 (R-11)

The issue asks: _"If issue related to any other repository/project, where we can
report issues on GitHub, please do so. Each issue must contain reproducible
examples, workarounds and suggestions for fix the issue in code."_

There are **two** distinct "other" targets to consider, and they get **different**
decisions:

1. the application repo **`link-foundation/meta-language`** (PRs #65/#66, issues
   #49/#50) — **nothing to report** (no source bug there); and
2. the **GitHub platform itself** — **a real gap to report**, and we did. This
   second target was raised explicitly by the maintainer on PR #1896:
   _"Can we also report bug to GitHub itself? We need to be able to do linking of
   pull requests to issues via API … if it does not exist, we need to report all
   the issues."_

## Part 1 — `link-foundation/meta-language`: no issue filed (and why)

After investigation, **there is no defect in `meta-language`**:

- **Not a `meta-language` source bug.** PRs #65/#66 contained correct closing
  keywords (`Fixes #49`, `Fixes #50`). The repository's code and PR bodies were
  fine; nothing in `meta-language` needs a code change.
- **It is a hive-mind workflow consequence.** The reason the issues stayed open is
  that hive-mind created the PRs against a non-default branch
  (`issue-47-76af108c0f24`) and then neither diagnosed nor compensated for the
  consequence. **That is fixed in this PR (#1896).**

Filing a duplicate "issue not closed" report on `meta-language` would therefore be
noise. The actionable code fix lives in hive-mind and is implemented here.

## Part 2 — GitHub platform: gap confirmed and reported

The earlier version of this document concluded "**not a GitHub bug — nothing to
report**." That was **too narrow**, and the maintainer was right to push back.
Distinguishing two separate things:

- The **auto-close-only-on-default-branch _rule_** is documented and intended —
  reporting _that_ as a bug would be incorrect (unchanged from before). ✔️
- But the **absence of any public API to link a PR to an issue** — the action the
  web-UI **Development** sidebar performs — **is** a genuine platform gap. So is
  the absence of non-default-branch auto-close, and the absence of an API to even
  _read_ a PR's linked issues. These legitimately warrant upstream feedback, which
  is exactly what the maintainer asked for.

We **confirmed the API truly does not exist** (live GraphQL schema introspection —
full method and evidence in
[`github-api-linking-research.md`](./github-api-linking-research.md) and
[`data/github-api-introspection.txt`](./data/github-api-introspection.txt)) and
then reported it. Because canonical upstream feedback threads already exist, we
**added weight and reproducible evidence** to them rather than filing duplicates
(open-source etiquette):

| Upstream discussion (`community/community`)                                                                            | Gap                                              | Action (as maintainer `konard`)                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#155339](https://github.com/orgs/community/discussions/155339) — _Missing mutations for linking existing branch & PR_ | No API to link an existing PR/branch to an issue | 👍 upvoted **+** [posted reproducible evidence + use case](https://github.com/community/community/discussions/155339#discussioncomment-17288911) |
| [#112224](https://github.com/orgs/community/discussions/112224) — _Close issues by merging PRs to non-main branches_   | No auto-close for non-default-base merges        | 👍 upvoted                                                                                                                                       |
| [#179613](https://github.com/orgs/community/discussions/179613) — _Retrieve linked issues for a PR via REST API_       | No API to _read_ a PR's linked issues            | 👍 upvoted                                                                                                                                       |

The comment we posted (full text:
[`experiments/issue-1895-api-research/discussion-155339-comment.md`](../../../experiments/issue-1895-api-research/discussion-155339-comment.md))
contains a public, runnable reproduction, the workaround, and the two concrete
fixes we'd want from GitHub — satisfying the issue's "reproducible examples,
workarounds and suggestions for fix" requirement for an external report.

## Reproducible example (for completeness)

```bash
# Default branch of the repo, and the non-default-base PR with empty closing refs:
gh api graphql -f query='{ repository(owner:"link-foundation", name:"meta-language") {
  defaultBranchRef { name }
  pr65: pullRequest(number:65){ baseRefName merged closingIssuesReferences(first:5){ nodes{ number } } }
}}'
# => defaultBranchRef.name = "main"
# => pr65.baseRefName = "issue-47-76af108c0f24" (NON-default)
# => pr65.merged = true
# => pr65.closingIssuesReferences.nodes = []   <-- empty: GitHub did not register the link

# Proof the linking API does not exist (no link mutation in the public schema):
gh api graphql -f query='query { __schema { mutationType { fields { name } } } }' \
  --jq '.data.__schema.mutationType.fields[] | select(.name|test("(?i)link|connect|clos|refer")) | .name'
# => createLinkedBranch / deleteLinkedBranch (branches only) — NO linkPullRequestToIssue
```

Raw captured evidence:
[`data/meta-language-graphql-evidence.json`](./data/meta-language-graphql-evidence.json) (original),
[`data/meta-language-evidence-refreshed.json`](./data/meta-language-evidence-refreshed.json) (refreshed),
[`data/github-api-introspection.txt`](./data/github-api-introspection.txt) (schema proof),
[`data/github-upstream-discussions.txt`](./data/github-upstream-discussions.txt) (the upstream threads).

## Workaround (for anyone hitting this manually)

Either:

- **Re-target the closing PR onto the default branch** (`main`) before merging, so
  GitHub registers the link and auto-closes the issue; or
- **Close the issue manually after the non-default-base merge**
  (`gh issue close <n> --reason completed`).

hive-mind now performs the second workaround automatically.

## Suggested code fix

Implemented in this PR — see [`analysis.md`](./analysis.md) §3 and
[`requirements.md`](./requirements.md). The remediation (classify the non-default
base case + explicit post-merge close) is wired into every hive-mind merge path.

## Note on meta-language issues #49 / #50

At the time of the original capture both issues were **OPEN** — the direct artifact
of the bug. On the refreshed capture
([`data/meta-language-evidence-refreshed.json`](./data/meta-language-evidence-refreshed.json))
they are now **CLOSED** — but, tellingly, **not** by their own PRs #65/#66 (whose
`closingIssuesReferences` are still empty). They were closed later by unrelated
default-branch activity (parent PR #48 / a subsequent commit). This _reinforces_
the root cause: the PRs that were supposed to close them never did; the linking
chain stayed broken. This PR does not act on the third-party repo beyond that
observation.
