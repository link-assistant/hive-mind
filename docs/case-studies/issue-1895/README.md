# Case Study — Issue #1895

**Title:** Automatic linking detection failed, and pull requests closed without their issue to be closed as well

**Issue:** https://github.com/link-assistant/hive-mind/issues/1895
**Pull Request:** https://github.com/link-assistant/hive-mind/pull/1896
**Status:** Implemented

This folder is the deep case study for issue #1895, compiled as required by the
issue itself ("make sure we compile that data to `./docs/case-studies/issue-{id}`
folder, and use it to do deep case study analysis"). It contains:

| File                                                 | Purpose                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [`README.md`](./README.md)                           | Overview, the verbatim problem, the reconstructed timeline, and the shipped solution at a glance                  |
| [`requirements.md`](./requirements.md)               | The exhaustive, numbered list of every requirement extracted from the issue, each mapped to where it is satisfied |
| [`analysis.md`](./analysis.md)                       | Root-cause analysis, the evidence, design decisions and trade-offs                                                |
| [`existing-components.md`](./existing-components.md) | Survey of in-repo components reused, plus external prior art / GitHub behavior references                         |
| [`external-report.md`](./external-report.md)         | Decision on the "report to other repositories" requirement (meta-language)                                        |
| [`data/`](./data/)                                   | Downloaded raw evidence (GraphQL dump, PR/issue JSON) for the meta-language PRs #65/#66 and issues #49/#50        |

---

## The problem (verbatim from the issue)

> https://github.com/link-foundation/meta-language/pull/66
> https://github.com/link-foundation/meta-language/pull/65
>
> https://github.com/link-foundation/meta-language/issues/49
> https://github.com/link-foundation/meta-language/issues/50
>
> We need to brainstorm what are the best practices and what we can do here. Does that mean that issue will be closed only when merged to main branch?
>
> Yet it is clear that issues are not linked to any pull requests.
>
> We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis [...]
>
> If there is not enough data to find actual root cause, add debug output and verbose mode if not present [...]
>
> If issue related to any other repository/project, where we can report issues on GitHub, please do so [...]
>
> Please plan and execute everything in this single pull request [...] until it is each and every requirement fully addressed, and everything is totally done.

## The problem in one sentence

Two pull requests (`meta-language` #65 and #66) carried valid closing keywords
(`Fixes #49`, `Fixes #50`) but were **merged into a non-default branch**
(`issue-47-76af108c0f24`, not `main`). GitHub **only** registers a PR's closing
references and auto-closes the linked issue when the PR targets the repository's
**default branch** — so the links never appeared and issues #49/#50 stayed open
after their PRs merged.

## Direct answer to the issue's question

> _"Does that mean that issue will be closed only when merged to main branch?"_

**Yes.** This is documented, intentional GitHub behavior, not a bug in GitHub.
From GitHub's docs:

> _"If you use a keyword to reference a pull request that is **not** in the
> default branch, [...] the linked issue will **not** close automatically when
> the pull request is merged."_ — and the closing reference is only registered
> for PRs whose **base is the default branch**.

So a PR stacked onto another feature branch (a "sub-issue" branch such as
`issue-47-...`) will:

1. show an **empty** `closingIssuesReferences` connection (hence hive-mind's
   "ISSUE LINK MISSING" warning fired even though `Fixes #N` was present), and
2. **not** close its linked issue on merge.

## The evidence (see [`data/meta-language-graphql-evidence.json`](./data/meta-language-graphql-evidence.json))

| PR  | head branch             | base branch             | merged | `closingIssuesReferences` | linked issue      | issue state after merge |
| --- | ----------------------- | ----------------------- | ------ | ------------------------- | ----------------- | ----------------------- |
| #65 | `issue-49-3a3011bb1089` | `issue-47-76af108c0f24` | ✅ yes | **`[]` (empty)**          | #49 (`Fixes #49`) | **OPEN** ❌             |
| #66 | `issue-50-2b26543616e5` | `issue-47-76af108c0f24` | ✅ yes | **`[]` (empty)**          | #50 (`Fixes #50`) | **OPEN** ❌             |

`meta-language` default branch = **`main`**. Both PRs targeted
`issue-47-76af108c0f24`, a **non-default** branch → empty closing refs → issues
left open. This is the textbook reproduction of the root cause.

## Reconstructed timeline

1. hive-mind solves sub-issues #49 and #50, each on its own branch, **stacked**
   on the parent issue's branch `issue-47-76af108c0f24` (via `--base-branch`).
2. PRs #65 / #66 are opened with bodies containing `Fixes #49` / `Fixes #50`,
   **base = `issue-47-76af108c0f24`** (the parent branch, _not_ `main`).
3. hive-mind's link-verification step queries `closingIssuesReferences`, finds it
   empty, and prints **"ISSUE LINK MISSING — add Fixes #N"** — misleading advice,
   because the keyword was already present. (Diagnostic root cause #1.)
4. PRs #65 / #66 are merged into `issue-47-76af108c0f24`.
5. GitHub does **not** auto-close #49 / #50 (non-default base). The PRs are
   "closed" (merged) but their issues remain open. (Behavioral root cause #2.)

## The shipped solution at a glance

Two coordinated fixes, applied across **every** merge path in the codebase:

1. **Accurate diagnostics** — a new classifier
   (`src/github-issue-auto-close.lib.mjs` → `classifyIssueLinkStatus`) detects
   the "keyword present **but** non-default base branch" case and replaces the
   misleading "ISSUE LINK MISSING / add Fixes #N" warning with an **"ISSUE LINK
   DEFERRED"** explanation of why GitHub will not link/close, in
   `src/solve.auto-pr.lib.mjs`.

2. **Explicit post-merge close fallback** — after a PR is merged into a
   non-default branch, hive-mind closes the linked issue itself (with an
   explanatory comment), because GitHub will not. Wired into **all** merge
   flows:
   - `src/solve.auto-merge.lib.mjs` (`watchUntilMergeable`, `attemptAutoMerge`)
   - `src/github-merge.lib.mjs` / `src/github-merge-issue-close.lib.mjs`
     (`closeLinkedIssueIfNotAutoClosed`, used by the `/merge` queue)
   - `src/telegram-merge-queue.lib.mjs`

See [`requirements.md`](./requirements.md) for the requirement-by-requirement
mapping and [`analysis.md`](./analysis.md) for the full root-cause analysis.
