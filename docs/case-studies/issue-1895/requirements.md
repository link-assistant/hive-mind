# Requirements — Issue #1895

Every requirement extracted verbatim from the issue, numbered, with where it is
satisfied in this pull request.

| #    | Requirement (from the issue)                                                                                                                    | Status | Where satisfied                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1  | Answer "Does that mean that issue will be closed only when merged to main branch?"                                                              | ✅     | [`README.md`](./README.md) → "Direct answer": **yes**, GitHub only auto-closes for default-branch merges. [`analysis.md`](./analysis.md) §1.                                     |
| R-2  | Explain why "issues are not linked to any pull requests" (automatic linking detection failed)                                                   | ✅     | [`analysis.md`](./analysis.md) §2: non-default base ⇒ empty `closingIssuesReferences`. Evidence in [`data/`](./data/).                                                           |
| R-3  | Download all logs and data related to the issue into `./docs/case-studies/issue-1895`                                                           | ✅     | [`data/`](./data/) — GraphQL evidence dump + PR/issue JSON for meta-language #65/#66/#49/#50.                                                                                    |
| R-4  | Deep case study analysis: reconstruct timeline/sequence of events                                                                               | ✅     | [`README.md`](./README.md) → "Reconstructed timeline".                                                                                                                           |
| R-5  | List each and every requirement from the issue                                                                                                  | ✅     | This file.                                                                                                                                                                       |
| R-6  | Find root causes of each problem                                                                                                                | ✅     | [`analysis.md`](./analysis.md) §2 (two distinct root causes: misleading diagnostic + missing post-merge close).                                                                  |
| R-7  | Propose possible solutions and solution plans for each requirement                                                                              | ✅     | [`analysis.md`](./analysis.md) §3 (solution options + chosen plan).                                                                                                              |
| R-8  | Check known existing components/libraries that solve a similar problem                                                                          | ✅     | [`existing-components.md`](./existing-components.md).                                                                                                                            |
| R-9  | Search online for additional facts and data (GitHub docs on linking/closing keywords + default branch)                                          | ✅     | [`analysis.md`](./analysis.md) §1 and [`existing-components.md`](./existing-components.md) → "GitHub behavior references".                                                       |
| R-10 | If not enough data to find the root cause, add debug output and verbose mode to enable root cause finding next time                             | ✅     | The new code emits verbose `[auto-close]` / `[VERBOSE] /merge` diagnostics and an "ISSUE LINK DEFERRED" explanation. Root cause was already found.                               |
| R-11 | If the issue relates to another repository where issues can be reported, report it (with reproducible example, workaround, code fix suggestion) | ✅     | [`external-report.md`](./external-report.md): no GitHub-side bug to report (documented behavior); the actionable fix belongs in hive-mind (this PR).                             |
| R-12 | Fully apply requirements to the **entire** codebase — if the issue exists in multiple places, fix it in all of them                             | ✅     | Fixed in all four merge paths: `solve.auto-merge.lib.mjs`, `github-merge.lib.mjs` (`/merge` queue), `telegram-merge-queue.lib.mjs`, plus diagnostics in `solve.auto-pr.lib.mjs`. |
| R-13 | Plan and execute everything in this single pull request (#1896) until every requirement is fully addressed                                      | ✅     | All changes are on branch `issue-1895-d40c001b789a` / PR #1896.                                                                                                                  |
| R-14 | Include automated checks (tests) in the PR                                                                                                      | ✅     | `tests/github-issue-auto-close.test.mjs` (14 cases) — reproduces the non-default-base bug and verifies the fix.                                                                  |

## Notes on R-11 (external reporting)

The "other repository" referenced is `link-foundation/meta-language` (PRs
#65/#66, issues #49/#50). After investigation there is **no GitHub-platform bug
and no `meta-language` source bug** to report: empty `closingIssuesReferences`
for a non-default-base PR is GitHub's documented behavior. The defect is in the
**hive-mind workflow** that created PRs against a non-default branch and then
neither diagnosed nor compensated for the consequence. That is fixed here. Full
reasoning in [`external-report.md`](./external-report.md).
