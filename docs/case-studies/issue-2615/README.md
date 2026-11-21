# Case study: issue #2615 — respecting sub-issues and dependencies in `/hive`

- Issue: https://github.com/link-assistant/hive-mind/issues/2615
- Pull request: https://github.com/link-assistant/hive-mind/pull/2616
- Example repository from the issue: https://github.com/link-assistant/calculator

## 1. The issue

> If we execute `/hive https://github.com/link-assistant/calculator/issues` or
> `/hive https://github.com/link-assistant/calculator` we should respect parent-child and
> dependency relationship between issues, and first queue child tasks that have no blockers, and
> limit parallel execution so queue is only filled with issues that have no blockers left, and
> dependencies are already merged. Also double check all other types of relationships supported by
> GitHub. We should go parallel where possible, so concurrency bigger than 1 should be used
> correctly.

## 2. Requirements

| #   | Requirement                                                                                                    | Where it is addressed                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | `/hive <owner>/<repo>/issues` and `/hive <owner>/<repo>` both work                                             | Telegram already normalized `/issues`; the CLI rejected it (`URL type 'issues_list' is not supported`) and now maps it to the repo URL |
| R2  | Respect parent/child (sub-issue) relations                                                                     | A parent with open sub-issues waits; a child inherits the open blockers of its ancestors                                               |
| R3  | Respect dependency (blocked by / blocking) relations                                                           | An issue with any open "blocked by" issue waits                                                                                        |
| R4  | Queue unblocked child tasks first                                                                              | Only the ready frontier is queued; parents come after their children                                                                   |
| R5  | Fill the queue only with issues whose blockers are gone and whose dependencies are merged                      | A blocker counts as resolved only when it is **closed**, i.e. the PR that fixes it is merged (or it was closed by hand)                |
| R6  | Double-check all other GitHub relationship types                                                               | §4 below: every relation field of the GraphQL `Issue` type was reviewed                                                                |
| R7  | Go parallel where possible; `--concurrency > 1` must be used correctly                                         | Every ready issue is queued at once; ordering is critical path first so the issue that unblocks the most work starts first             |
| R8  | Case study in `docs/case-studies/issue-2615` with data, online research, solutions, plans and existing tooling | This document and `data/`                                                                                                              |

## 3. How hive behaved before

`src/hive.mjs` → `fetchIssues()` listed open issues (`gh issue list` / GraphQL / project / label),
sorted them by `createdAt` (`--issue-order`), optionally dropped issues with PRs and archived
repositories, cut the list to `--max-issues`, and returned **all** of them. `monitor()` put every
URL into the `IssueQueue` and `--concurrency` workers took them in order.

Nothing looked at relations, so on link-assistant/calculator (snapshot in
[`data/calculator-open-issues-relations.json`](data/calculator-open-issues-relations.json)) a run
with `--concurrency 4` would start #227 (the parent of all others, which is only done when its 18
sub-issues are done), #229, #230 and #231 at once, then #233 while #229 — which it depends on — was
still being written, and so on. Work built on unmerged prerequisites produces conflicting or
duplicated pull requests.

Also, the CLI `hive https://github.com/link-assistant/calculator/issues` failed URL validation
(only `user` and `repo` URL types were allowed), while the Telegram `/hive` command already
normalized `/issues` and `/pulls` URLs (`src/telegram-bot.mjs`).

### The calculator graph (all 19 issues open)

```
#227 parent of #229..#246
#229 blocks #233 #234 #235 #237 #239 #240 #242 #243
#230 #231 #232 block #246
#233 ← #229               #239 ← #229
#234 ← #229               #240 ← #239 #229
#235 ← #233 #229          #241 ← #240
#236 ← #235 #233          #242 ← #229
#237 ← #229               #243 ← #229
#238 ← #236 #233 #237     #244 ← #237 #235 #234
#245 ← #242 #236          #246 ← #230..#245 (16 issues)
```

## 4. GitHub relationship types (R6)

All relation-like fields of the GraphQL `Issue` type were listed with
`gh api graphql -f query='{ __type(name:"Issue"){ fields { name } } }'`:
`blockedBy blocking closedByPullRequestsReferences duplicateOf issueDependenciesSummary issueType linkedBranches milestone parent projectItems stateReason subIssues subIssuesSummary timelineItems trackedInIssues trackedIssues trackedIssuesCount`.

| Relation                                              | Meaning                                                             | Affects order of work? | Decision                                                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parent` / `subIssues` (sub-issues)                   | Hierarchy; up to 100 sub-issues per parent, 8 levels [1]            | Yes                    | A parent waits for all open sub-issues. A child inherits open blockers of its ancestors (a blocked epic blocks its tasks), except blockers inside the same subtree, which would deadlock |
| `blockedBy` / `blocking` (issue dependencies)         | "X cannot start before Y is done"; up to 50 per type [2]            | Yes                    | Any open `blockedBy` holds the issue. Closed blockers are resolved whatever the close reason, as on GitHub, where a closed blocker no longer shows the issue as blocked                  |
| `trackedIssues` / `trackedInIssues` (tasklist blocks) | Legacy tasklists, retired on 2025-04-30 in favour of sub-issues [3] | No longer              | Not used; the fields are empty for new data, and sub-issues are the replacement                                                                                                          |
| `duplicateOf`                                         | Issue was closed as a duplicate                                     | No                     | Duplicates are closed, so hive never lists them                                                                                                                                          |
| `closedByPullRequestsReferences` / `linkedBranches`   | PRs/branches that will close the issue                              | Indirectly             | Already handled by `--skip-issues-with-prs` / `--auto-continue`; a blocker with an _open_ PR is still open, so dependents wait until the PR is merged — exactly R5                       |
| `stateReason`                                         | `COMPLETED`, `NOT_PLANNED`, `DUPLICATE`, `REOPENED`                 | No                     | Fetched for diagnostics; any closed blocker unblocks                                                                                                                                     |
| `issueType`, `milestone`, `projectItems`, labels      | Classification / planning                                           | No                     | Not ordering relations; project status filtering already exists (`--project-*`)                                                                                                          |
| `timelineItems` cross-references ("mentioned in #12") | Informal references                                                 | No                     | Too noisy to infer order from; only explicit relations are used                                                                                                                          |

## 5. Online research and existing tooling

- **GitHub sub-issues** — up to 100 sub-issues per parent and 8 nesting levels [1]. GraphQL:
  `parent`, `subIssues`, `subIssuesSummary`; REST: `/repos/{o}/{r}/issues/{n}/sub_issues`.
- **GitHub issue dependencies** — GA on 2025-08-21; "You can link up to 50 issues for each
  relationship type"; search filters `is:blocked`, `is:blocking`, `blocked-by:`, `blocking:`;
  supported in the API and webhooks [2][4]. GraphQL: `blockedBy`, `blocking`,
  `issueDependenciesSummary`; REST: `/repos/{o}/{r}/issues/{n}/dependencies/blocked_by`.
- **gh CLI ≥ 2.94.0** — `--parent`, `--blocked-by`, `--blocking` and `gh issue view --json
parent,subIssues,blockedBy,blocking` [5]. hive still uses `gh api graphql`, which works with
  any gh version installed on existing servers.
- **Tasklist blocks** — retired; sub-issues replace them [3].
- **Graph libraries** — `toposort` 2.0.2 (last published 2022), `graphlib` 2.1.8 (2022),
  `@dagrejs/graphlib` 4.0.5 (maintained), `dependency-graph` 1.0.0 (2023). They offer topological
  sort / cycle detection, but hive does not need a full order: it needs the _ready frontier_
  under GitHub-specific rules (open vs closed, inherited parent blockers, the "blocked by my own
  child" exception) recomputed from fresh data every polling iteration. That is ~60 lines
  (Tarjan SCC for cycles, memoized longest path for priority), so no dependency was added.
- **Other agent orchestrators** — Forza plans issues into a dependency graph and runs them in
  order; Sortie polls labelled issues with `max_concurrent_agents`; several agent "skills" group
  issues into topological waves [6][7]. hive's approach is the same Kahn-style frontier, but it
  does not need waves: in continuous mode a slot is refilled as soon as _any_ blocker is merged.
- **Scheduling theory** — list scheduling with critical-path priority (start the task with the
  longest chain of dependent work first) is the classic heuristic for minimizing total time with
  a fixed number of workers. hive orders ready issues by critical-path length, then by how many
  issues they transitively unblock, then by `--issue-order`.

## 6. Solutions considered

| Option                                                                | Pros                                                                       | Cons                                                                                                                                                                                                                            | Decision   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A. Search `is:open -is:blocked`                                       | One query                                                                  | REST `search/issues` ignores the qualifier (0 hits for `is:blocked`, all 19 for `-is:blocked` on calculator); GraphQL search honours it (14 hits) but says nothing about open sub-issues, inherited parent blockers or priority | Rejected   |
| B. REST per issue (`/dependencies/blocked_by`, `/sub_issues`)         | Simple                                                                     | 2+ calls per issue, rate-limit heavy on large repositories                                                                                                                                                                      | Rejected   |
| C. Batched GraphQL with aliases (25 issues per query) + local planner | 1 query per 25 issues, complete data (limits 100/50 are the GitHub maxima) | Needs GraphQL fields that old GHES may lack → fail open                                                                                                                                                                         | **Chosen** |
| D. Let the AI solver decide whether an issue is ready                 | No code in hive                                                            | Costs a full solve run per blocked issue, and still starts them in parallel                                                                                                                                                     | Rejected   |

## 7. Implemented design

- `src/hive.issue-relations.lib.mjs` (pure, dependency-injected, unit-tested):
  - `createIssueRelationsFetcher` — batched aliased GraphQL; walks up the parent chain (≤ 8
    levels) and fetches open blockers of ancestors; keeps partial `data` when `gh` exits non-zero
    because one issue in a batch is missing.
  - `planIssueQueue` — `{ ready, waiting, unknown, cycles }`. Rules: open `blockedBy` → wait;
    open sub-issues → wait; open blockers of any ancestor → wait (unless the blocker is the issue
    itself or a descendant of that ancestor). Ready issues are ordered by critical path, then
    transitive dependents, then the incoming order. Cycles are detected with Tarjan's SCC and
    logged; their members can never become ready until a human breaks the cycle.
  - `createIssueRelationsGate` — what `hive.mjs` uses: `filterReadyIssues` (before
    `--max-issues`, so the limit is spent on issues that can start), `checkIssueReady` (right
    before a worker starts an issue — relations can change while it sits in the queue), and
    `shouldStartAnotherOnceRound` (see below). Any error reading relations is logged and hive
    falls back to the old behaviour (fail open).
- `src/hive.issue-queue.lib.mjs` — `IssueQueue` moved out of `hive.mjs` (line limit) and gained
  `defer()`: an issue found blocked at dequeue is released without being marked completed, so a
  later iteration queues it again. `enqueue(url, { skipFailed })` keeps extra `--once` rounds from
  retrying failures.
- `--once`: after the queue drains, if issues were waiting on relations **and** work completed
  since the last round, hive polls again. Combined with `--auto-merge` this walks the whole graph
  in one invocation; without merges it costs one extra poll and stops.
- `--respect-issue-relations` (default `true`); `--no-respect-issue-relations` restores the old
  behaviour, e.g. for repositories where a parent issue is meant to be solved as one combined PR
  (solve's repository mode, #2212, creates such parents).
- `hive https://github.com/<owner>/<repo>/issues` (and `/pulls`) is accepted as the repository.

### Expected schedule on calculator

[`data/calculator-waves.txt`](data/calculator-waves.txt) (from
`experiments/issue-2615-calculator-waves.mjs`), assuming each started issue is merged before the
next poll:

```
wave 1: #229, #230, #231, #232
wave 2: #233, #239, #237, #234, #242, #243
wave 3: #235, #240
wave 4: #236, #241, #244
wave 5: #238, #245
wave 6: #246
wave 7: #227
```

19 sequential runs become 7 waves; with `--concurrency 4` the first wave fully uses all workers,
and in continuous mode hive does not wait for a whole wave: when #229 is merged, its six
dependents become ready on the next poll even if #230–#232 are still running.

## 8. Verification

- `tests/hive-issue-relations-2615.test.mjs` (19 tests, default suite): calculator frontier and
  priority, next frontier after closing #229, parent ready after all children close, inherited
  parent blockers and the same-subtree exception, closed blockers, cycles, fail-open, batching,
  partial GraphQL errors, the gate, `--once` continuation, `IssueQueue.defer`, and the wiring in
  `hive.mjs`.
- `experiments/issue-2615-plan-live-repository.mjs link-assistant/calculator` — live GitHub data,
  1 GraphQL query for 19 issues; output in [`data/calculator-live-plan.txt`](data/calculator-live-plan.txt).
- End-to-end run of the real `hive.mjs` with a stub solver
  (`experiments/issue-2615-stub-solve.mjs` copied to `./solve.mjs` in a temp directory):
  `hive https://github.com/link-assistant/calculator/issues --once --all-issues --concurrency 4`
  started exactly #229–#232 in parallel, listed the 15 waiting issues with reasons, re-polled once
  after they completed and stopped — log in
  [`data/hive-once-calculator-stub-solver.log`](data/hive-once-calculator-stub-solver.log).

## 9. Limitations and follow-ups

- A blocker in another repository, or one hive would not pick up (e.g. no matching label), still
  holds its dependents: GitHub's semantics are "wait until it is closed", not "wait until hive
  solved it".
- An issue solved by hive but not merged keeps its dependents waiting — this is intended (R5).
  Use `--auto-merge` to let one hive run progress through the graph.
- Relations are read when issues are listed and again right before a worker starts; a blocker
  added while an issue is already being solved does not stop that run.
- On GitHub Enterprise Server versions without these GraphQL fields hive logs a warning and
  behaves as before.

## References

1. GitHub Docs — Adding sub-issues: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues
2. GitHub Changelog — Dependencies on issues (2025-08-21): https://github.blog/changelog/2025-08-21-dependencies-on-issues/
3. GitHub Changelog — Issues & Projects February 18th update (tasklist blocks retirement): https://github.blog/changelog/2025-02-18-github-issues-projects-february-18th-update/
4. GitHub Docs — Creating issue dependencies: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies
5. GitHub Changelog — Manage sub-issues, types and dependencies from GitHub CLI (2026-06-10): https://github.blog/changelog/2026-06-10-manage-sub-issues-types-and-dependencies-from-github-cli/
6. Forza: https://docs.rs/crate/forza/0.5.2
7. Sortie: https://pkg.go.dev/github.com/sortie-ai/sortie@v1.9.0
