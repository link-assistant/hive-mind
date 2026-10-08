# Parent PR ownership and eligible child work

The [October 8 review comment](https://github.com/link-assistant/hive-mind/pull/2686#issuecomment-6052742370) requires three behaviors: a parent issue's PR belongs to the parent rather than its children, parents run after their children, and a no-candidate run suggests opting into work on existing PRs. These requirements apply with the default Telegram PR-skip policy and when that policy is disabled.

## Root cause and implementation

The existing batch lookup interpreted every closing reference as a PR for the referenced issue. That is useful for solution reporting and merge verification, but it is insufficient for scheduling child work. Captured calculator PR #228 has branch `issue-227-…`, closes parent #227 and references all 18 children. The native hierarchy independently identifies #227 as those children's parent.

Hive discovery and worker rechecks request `excludeAncestorPullRequests`. The GraphQL batch reads each issue's complete supported ancestor chain and each PR's head branch. The existing primary-issue resolver determines ownership from the source repository, branch convention and closing references. A PR whose primary issue is an ancestor is excluded from that child's PR count. The parent's own count and draft child PRs remain intact. Ordinary multi-issue PRs, solution reporting, merged PR reporting, and the merge/link-repair checks retain their existing closing-reference behavior.

The REST fallback reads native parents and PR head metadata, caches shared lookups, bounds traversal to GitHub's eight hierarchy levels and avoids cycles. It collects timeline pages into one array with `--paginate --slurp`. Missing hierarchy keeps the original closing-reference behavior. If head metadata is unavailable, ownership can still be inferred from the existing primary closing reference; a PR without identifiable ancestor ownership continues to count.

The existing relation scheduler already waits for open children and blockers, rechecks readiness before a worker starts and polls again after progress. This gate remains active when `--no-skip-issues-with-prs --auto-continue` is used. No automatic opt-in or hierarchy bypass is introduced. Discovery immediately suggests those flags when PR filtering leaves no eligible candidates, including in continuous monitoring; the final report also includes them with PR links. The Telegram no-work warning provides the same flags in English, Russian, Chinese and Hindi. The updated [completion preview](screenshots/completion-after.png) was rendered with Playwright from the production formatter; no Telegram message was sent.

## Reproduction and validation

The nine initial ownership tests were run against the unchanged matcher: seven failed and two passed. The failing cases demonstrate the captured parent PR, a draft child's own PR, an ordinary planning branch, reordered closing references, a grandparent, cross-repository ancestry and a merged ancestor PR. [Red-before output](data/follow-up-parent-pr-before.log.gz) preserves the failures.

A live REST transport check caught the CLI prohibition against combining `--slurp` with `--jq`. The fallback fixture now enforces that contract and serves two raw timeline pages, including an unrelated event. Its [failing run before correction](data/follow-up-rest-before.log.gz) demonstrates that the invalid command lost the parent's PR association. Filtering now happens in JavaScript after collecting all pages. The corrected command was also run read-only against the real calculator timeline, whose [raw response](data/rest-timeline-pages-follow-up.json) preserves the API shape.

```sh
node --test tests/github-parent-pr-2685.test.mjs tests/hive-outcomes-2685.test.mjs
npm test -- --continue-on-failure
```

The offline CLI fixture runs the production Hive entry point, queue, PR lookup, native relation scheduler and worker PR recheck. Only external transports, resource checks and the solver are replaced. It uses the captured PR/issue data and calculator relation snapshot; child processes have a 256 MB heap and a 12-second termination bound.

| Mode                                  | Expected result                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Default PR skip, GraphQL lookup       | Only #227 is skipped for its own PR; #229 is the first child selected by critical-path priority.                 |
| Default PR skip, forced REST fallback | The same ownership and scheduling result, with cached native-parent and PR-head lookups.                         |
| Include existing PRs                  | All four ready children start with `--auto-continue`; parent #227 and 14 dependency-blocked children wait.       |
| Every issue has its own PR            | No solver starts, exit 3, PR links and explicit continuation guidance during discovery and in the final summary. |

The existing calculator scheduler tests also verify that closing the first prerequisite opens the next frontier and that closing all 18 children makes parent #227 ready. These checks establish the required ordering without changing dependency timeouts or paying for AI calls.

The final focused run covers 11 ownership tests and 26 outcome/CLI/locale tests. A read-only [live lookup experiment](../../../experiments/issue-2685/verify-parent-pr-lookup.mjs) also checked the real GraphQL schema and captured [both results](data/live-pr-ownership-follow-up.json). Closing references associate all 19 issues with PRs. Issue ownership retains only two associations: parent #227's PR #228 and child #229's own draft PR #248. The later child PR explains why this live snapshot differs from the original incident fixture, which had only PR #228.

All 578 default test files and both GitHub integration files passed locally. Lint, formatting, syntax, line limits, secrets, duplication, documentation, package-manager, version and changeset checks passed; all 168 tracked dependency declarations were current. [Follow-up evidence metadata](data/follow-up-evidence.json) identifies the commands, results, archived complete logs and decoded SHA-256 hashes. The final REST correction was followed by another focused run, lint and formatting checks. The integration closed its fixture issue and PR; repository deletion rules retained two disposable branches, documented in its [cleanup record](data/follow-up-integration-cleanup.json).

GitHub Actions also validated source commit `5f2e47e537e189e946028ded1e53b6cfefb41811`: the [checks workflow](https://github.com/link-assistant/hive-mind/actions/runs/37733486083) passed its full test suites, GitHub integrations, lint, documentation, Helm, both Docker builds and running-container checks. The [security workflow](https://github.com/link-assistant/hive-mind/actions/runs/37733485803) and [link checker](https://github.com/link-assistant/hive-mind/actions/runs/37733485787) passed on the same head. [CI review-validation metadata](data/ci-review-validation.json) preserves timestamps, job and step results, complete compressed logs and decoded SHA-256 hashes. Subsequent evidence-only commits preserve this tested source and test code.

## Evidence and online research

- [Follow-up conversation comments](data/pr-comments-follow-up.json) and [edited PR description before this change](data/pr-before-follow-up.json).
- [Updated related calculator issue](data/calculator-issue-247-follow-up.json); the original submitted reproduction and workarounds remain archived.
- [Previous successful solver-session log](data/previous-successful-session.log.gz), downloaded with authenticated `gh gist view --allow-escape-sequences`; its complete original bytes and hash are recorded in [follow-up evidence metadata](data/follow-up-evidence.json).
- GitHub documents [native parent and child relationships](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) independently of [PR closing-reference linkage](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue). The ownership distinction is the requested Hive scheduling policy, not a claim that GitHub rejects a parent's closing references to children.

Automatic planning-scope selection for link repair remains a related calculator follow-up. Hive eligibility now handles the reported parent PR without requiring the operator to edit that PR before the children can run.
