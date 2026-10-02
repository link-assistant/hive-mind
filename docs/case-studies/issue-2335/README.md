# Issue 2335: a pull request was merged without being linked to its issue

[Agent PR #326](https://github.com/link-assistant/agent/pull/326) merged after passing CI even though its description expressly left [Agent issue #322](https://github.com/link-assistant/agent/issues/322) unfinished. The issue stayed open and GitHub reported no closing issue references. Two independent boundaries failed: a local regex treated a negated closing phrase as a link, and automatic merging checked CI and mergeability without requiring evidence that an ordinary issue's requirements were complete.

This pull request fixes the first boundary: links between issues and pull requests. It parses closing references the way GitHub does, repairs the complete required reference set after every working session, keeps every open issue in repository-mode scope beyond GitHub's native-child limit, and refuses automated merges while a required issue is not linked. The second boundary (complete-delivery prompts for every tool, Codex goals, a requirements report and automatic completion retries) was [split out on request](https://github.com/link-assistant/hive-mind/pull/2336#issuecomment-5948156787) into [#2406](https://github.com/link-assistant/hive-mind/issues/2406).

## Evidence and collection

The [original request](data/issue-2335.json), [Agent issue](data/agent-issue-322.json), [standing dependency request #319](data/agent-issue-319.json), [PR description and conversation](data/agent-pr-326.json), [inline comments](data/agent-pr-326-review-comments.json), [reviews](data/agent-pr-326-reviews.json), and both timelines are preserved in `data/`. Empty issue-comment collections are preserved too. These endpoints are distinct: `gh pr view --json comments` alone would have missed the CodeQL inline review.

The authenticated gist capture is [agent-pr-326-session.log](data/agent-pr-326-session.log), obtained with `gh gist view c32afcb20538b5962ffe096899a17ceb`. It has 8,669 lines; it ends during log publication before the merge. The later merge is established by the PR timeline and automatic-merge comment, not by inventing missing session-log entries.

[agent-pr-326.diff](data/agent-pr-326.diff) preserves the entire upstream change. The upstream [experiment README](data/agent-experiment-readme.md) and [script](data/agent-experiment-script.mjs.txt) are captured at final commit `07f599bc0a4013bcf7e717516dce3b14232684d6`. The script is archival text, not an executable test in this repository.

Every one of the eleven associated Actions runs is saved as `agent-ci-<id>.log.gz`; [the CI manifest](data/agent-ci-manifest.json) records each workflow, commit, timestamp, conclusion, URL, and uncompressed SHA-256. The initial security failure and final JS CI also have readable `.log` copies. Decompress other logs with `gzip -cd`. [archive-ci.mjs](../../../experiments/issue-2335/archive-ci.mjs) can repeat the authenticated collection. External evidence was collected on 2026-09-30; upstream state can subsequently change.

[evidence-manifest.json](data/evidence-manifest.json) records every archive file's size and SHA-256. Run `node --max-old-space-size=256 experiments/issue-2335/verify-evidence.mjs` to check that inventory, the 11 compressed-log hashes, JSON validity, credential patterns and local documentation links. Decompression is bounded per log; the script does not execute the archived upstream experiment.

## Timeline

All times are UTC.

| Time                | Event and implication                                                                                                                                                                                                                     | Evidence                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-16 06:34:28 | `3eb1428f` adds link preservation after temporary auto-restart. It repairs descriptions when the local parser says a keyword is absent.                                                                                                   | [Merged PR #1617](https://github.com/link-assistant/hive-mind/pull/1617), [saved description](data/related-pr-1617.json) |
| 2026-05-09 04:13:54 | `f974cbfe` consolidates link detection. It retains substring matching without negation handling and accepts generic foreign repository patterns even when the caller specifies an exact repository.                                       | [Preserved commit diff](data/link-parser-history.diff)                                                                   |
| 2026-09-05 16:01:40 | `614eb2ee` introduces repository-mode solving, capped by the 100 native-child limit, and an optional sub-issue restart loop.                                                                                                              | Repository history for `solve.repository-mode.*`                                                                         |
| 2026-09-27 13:00:53 | `6ee39cf4` adds the #2306 closing-reference guard for repository mode or explicitly enabled sub-issue checking. Ordinary issue solves remain outside that gate.                                                                           | [Merged PR #2307](https://github.com/link-assistant/hive-mind/pull/2307), [saved description](data/related-pr-2307.json) |
| 2026-09-29 17:26:01 | Agent #322 opens with three completion criteria covering OpenTUI, the bash parser, and a clean upgraded packed installation.                                                                                                              | `agent-issue-322.json`                                                                                                   |
| 2026-09-30 10:07:36 | The solver starts with `--auto-merge --tool codex --verbose`. It has neither an optional finalize flag nor the sub-issue flag.                                                                                                            | `agent-pr-326-session.log`, beginning of capture                                                                         |
| 10:08:07 / 10:08:18 | Initial placeholder commit `62960237` and draft PR #326 are created.                                                                                                                                                                      | PR commits and timeline                                                                                                  |
| 10:08:31            | The initial security workflow finds high-severity `brace-expansion` advisories. This is a separate dependency failure, not the missing-link cause.                                                                                        | `agent-initial-security.log`, lines 5855–5874                                                                            |
| 10:21:34            | `bc99dedc` adapts Agent's bash parser to the renamed WASM export. It does not establish OpenTUI's newer-runtime support.                                                                                                                  | PR diff and commits                                                                                                      |
| 10:25:59            | `20bee4f6` updates OpenTUI to 0.5.13 and refreshes dependencies. The production parser remains pinned to 0.25.10.                                                                                                                         | PR description, experiment README                                                                                        |
| 10:28:22            | CodeQL identifies a dynamic-regex injection in the experiment.                                                                                                                                                                            | Inline review `4143578807`                                                                                               |
| 10:30:51            | `07f599bc` fixes that experiment warning.                                                                                                                                                                                                 | PR commits                                                                                                               |
| 10:31:00            | Five final workflows begin on `07f599bc`; all eventually pass.                                                                                                                                                                            | CI manifest and logs                                                                                                     |
| 10:39:23            | Result verification reads the explicit negated closing sentence, then incorrectly logs that the issue reference already exists.                                                                                                           | Session log lines 8614 and 8646                                                                                          |
| 10:42:12 / 10:42:15 | GitHub merges the PR; hive-mind posts its automatic-merge success comment. No issue-closing link exists, and #322 remains open.                                                                                                           | PR metadata and timeline; `closingIssuesReferences: []`                                                                  |
| 10:49:28            | Hive-mind #2335 reports the failure and requests complete delivery, universal repair, investigation, and tests.                                                                                                                           | `issue-2335.json`                                                                                                        |
| This investigation  | The link reproductions fail before fixes. A further title-only diagnosis reproduction also fails before its fix. All eleven incident CI logs are archived, and OpenTUI #1550 is filed with a bounded reproduction and compatibility plan. | `linking-before.log`, `title-before.log`, [upstream report](https://github.com/anomalyco/opentui/issues/1550)            |

The history distinguishes a longstanding parser defect from a recently scoped gate: the deduplication did not introduce negation handling and then remove it. The earlier guarantee depended on a parser that was already incomplete. A separate unmerged commit, `1f71f363`, proposed preserving partial-scope declarations for #2295; it is not an ancestor of the incident's main branch and is not evidence of this incident's deployed root cause. Its [request](data/related-issue-2295.json) is retained as relevant alternative policy context.

## Recurrence while continuing this pull request

On 2026-10-01 the deployed `solve` v2.33.2 resumed PR #2336 itself and was told to solve hive-mind issue #322, an unrelated issue closed in 2025. GitHub's `closingIssuesReferences` for the PR listed only #2335. The deployed `extractLinkedIssueNumber` tries the keywords in a fixed order, `close` before `fixes`, and does not skip code spans. It therefore matched the quoted example `` `does not close #322` `` in the description before reaching `Fixes #2335`. This is the same parser defect as in Agent PR #326, and the description that triggered it is [archived](data/hive-mind-pr-2336-body-at-misroute.md).

On this branch, the shared parser ignores code spans and negated clauses, and continue mode first derives the issue from the `issue-<number>-` branch name. [The replay script](../../../experiments/issue-2335-pr2336-self-misdetection.mjs) reports `322` for `main`'s parser and `2335` for this branch on the archived description. `tests/issue-linking-2335.test.mjs` covers the minimal form of that description.

## What remained incomplete in Agent #322

| Acceptance criterion                                                                      | State at merge                                                                                                                   | Evidence                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OpenTUI supports current `web-tree-sitter`.                                               | Blocked. OpenTUI 0.5.13 retains the exact 0.25.10 peer; the maintainer had confirmed 0.26+ was unsupported.                      | PR description; `opentui-issue-1201.json`, `opentui-pr-1203.json`, `opentui-latest-package.json` |
| Agent's bash parser loads the current WASM and passes bash tests.                         | Implemented locally, including permitted commands and denied chains/substitutions.                                               | Final JS CI, upstream experiment and diff                                                        |
| The packed Agent installs without peer warnings and its direct pin is upgraded to latest. | Blocked. Production stays at 0.25.10. The experimental 0.27.0 install intentionally expects an incorrect peer and `ELSPROBLEMS`. | Experiment script and README, final PR description                                               |

Therefore green CI verified the submitted partial implementation and its documented incompatibility, not completion of all three criteria. Repairing the link by itself would not make that work complete: a correctly linked pull request can still be partial. This PR makes the missing link impossible to merge; requiring evidence that every requirement is done is tracked in [#2406](https://github.com/link-assistant/hive-mind/issues/2406). The regression suite replays the actual PR description and blocks the merge until its closing link is repaired.

## Root causes and implementation

### 1. A local substring was mistaken for an actual closing declaration

The old regex matched the `close #322` substring in the negative sentence. The source log directly proves this path: after printing the description, verification decided no repair was necessary. Generic repository patterns additionally let `Fixes foreign/project#322` satisfy a local issue with the same number. Title-only checks in diagnosis and batch discovery could also report a closing link that GitHub did not register.

`github-linking.lib.mjs` now supplies one parser for detection, repair, discovery, and continuation. It removes hidden metadata and code examples, checks negation within the current clause, and compares exact repositories. Foreign children cannot be satisfied by a bare local number. Diagnosis, issue closing, and both batch-discovery paths use the description. A bare issue number belongs to the source PR repository; foreign PRs need an exact qualified reference. Queue timeline discovery rejects ordinary/negated mentions and foreign PR numbers instead of treating any cross-reference as a closing link. These additional failures are preserved in [foreign-pr-before.log](data/foreign-pr-before.log) and [timeline-before.log](data/timeline-before.log). Missing continuation references recover the issue from the prepared `issue-N-...` branch before scoped body references; they never substitute the pull request's number for an issue.

`pr-issue-link-repair.lib.mjs` discovers the primary issue, all nested native children, and body-only required issues. It adds one correctly scoped keyword per missing issue, preserves the existing description, publishes through a sanitized temporary file, and reads back the description. Failed reads, writes, and changed links are reported instead of being called successful. Temporary files are cleaned up. `verifyResults`, description rebuilding, and the shared restart iteration all use this repair, including failed or resumed tool sessions.

### 2. Ordinary issues could bypass the link gate

The #2306 gate applied to repository-mode issues or the optional sub-issue flag. The reported ordinary solve used neither, so passing CI and GitHub mergeability were enough. Its API errors could also return no blocker.

The gate now applies whenever a solve has an issue, and it always includes the primary issue, not only sub-issues. The new `issue-link-verification.lib.mjs` reads the PR, the primary issue, all nested native children and body-only required issues with full pagination. Right before every actual merge, the shared `mergePullRequest` checks that the description closes every one of them. For default-branch merges it also reads GitHub's own `closingIssuesReferences` (all pages), so a link that a local parser accepts but GitHub does not register still blocks the merge. Malformed data and API failures block the merge instead of allowing it.

The merge queue forwards its known issue number, so deleting a body link or using a different branch cannot turn an issue-scoped queue item into maintenance work. [The queue reproduction](data/queue-before.log) fails before this fix. Both auto-merge paths propagate the blocker instead of retrying it as an ordinary merge error. Non-default-branch workflows remain supported: GitHub does not close issues for them, so every linked local and foreign issue is closed explicitly afterwards and individual close failures are reported. The auto-merge-blocked comment asks for the missing reference to be restored.

### 3. A platform attachment limit accidentally limited requested scope

Repository preparation previously selected only 100 issues for both attachment and the combined issue body. It now keeps all open issues in the required body list while selecting up to 100 native attachments. Attachment failures remain in scope. The test uses 105 finite issues and verifies all 105 required references. Nested traversal is iterative and deduplicates cycles and shared children.

### 4. Logs did not expose the boundary failure

Existing verbose logs were sufficient to identify this incident's parser path, so no speculative tracing was added. The new check logs the verified issue count in verbose mode, and its warnings name the missing links or the unreadable data.

## Requirements of #2335 covered here

| Requirement                                                  | Delivered mechanism / evidence                                                                                                                              | Practical limit                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Restore the original issue link.                             | Always-on repair; actual PR #326 replay; positive/negative/title/foreign parser tests.                                                                      | Publishing permissions and GitHub availability remain external. Failures are blockers. |
| Link exactly all required issues, including all-open solves. | Primary + nested native + body-only set; exact-repository references; 105-issue test; native-link pagination.                                               | Native attachments remain capped at 100; required scope is not capped there.           |
| Never merge a PR whose issue links are missing.              | Link check inside the shared merge function, fail-closed reads, GitHub `closingIssuesReferences` on default-branch merges, actual merge subprocess fixture. | A human can still merge outside hive-mind.                                             |
| Repair after solve/restart description edits.                | Shared result verification, description rewrite repair, iteration-final repair, continuation recovery from the branch name.                                 | Concurrent description edits can require another repair.                               |
| Find root causes and check relevant paths for regressions.   | Commit history, full incident capture, ordinary/queue/continuation/restart/batch paths reviewed and covered; queue reproduction fails before its fix.       | A finite test suite cannot prove all future inputs or integrations.                    |
| Cover the critical behavior with tests.                      | Failing reproductions before fixes; 100% line/branch/function coverage of `issue-link-verification.lib.mjs` and `pr-issue-link-repair.lib.mjs`.             | Coverage is measured for these modules, not for the whole application.                 |
| Download logs/data and produce a deep case study.            | This document, original metadata, all 11 CI captures with manifest, full gist/diff, research and upstream examples.                                         | The original gist ends before merging; the timeline supplies that missing event.       |
| Report related upstream issues.                              | [OpenTUI #1550](https://github.com/anomalyco/opentui/issues/1550), preserved body and metadata, executable local reproduction.                              | Filing a request does not complete Agent #322's compatibility criterion.               |
| Complete delivery, prompts for every tool, native goals.     | Moved to [#2406](https://github.com/link-assistant/hive-mind/issues/2406) to keep this review about links.                                                  | Until #2406 lands, a correctly linked but partial PR can still be merged.              |

## Research and component choices

[GitHub's closing-reference documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) supports a repeated positive keyword per issue, exact foreign repository references, and the default-branch requirement. Default-branch verification therefore checks GitHub's own `closingIssuesReferences`, rather than treating a local regex as authoritative. Non-default branches preserve the established explicit-close workflow from #1895.

The implementation reuses the existing required-reference parser and sub-issue normalization (#2212/#2306), repository attachment recovery, GitHub rate-limit retry helper, publication sanitizer, shared restart executor, the #2395 pre-merge link gate, and the merge function. No new dependency is needed.

The [OpenTUI maintainer response](https://github.com/anomalyco/opentui/issues/1201#issuecomment-4806912949) says 0.26+ was unsupported. [PR #1203](https://github.com/anomalyco/opentui/pull/1203) was closed without merging. Fresh package metadata confirms 0.5.13 still declares the 0.25.10 peer. The new upstream report asks for an intentional runtime/API/worker/grammar upgrade and tests, rather than merely widening the peer declaration.

Run `node examples/issue-2335-opentui-peer-compatibility.mjs` to repeat this investigation's two finite metadata-only installs. The output in [opentui-peer-reproduction.json](data/opentui-peer-reproduction.json) shows the legacy peer succeeds and 0.27.0 fails strict peer resolution. It also records the local Node 24 engine warning: these package-lock-only controls do not claim successful OpenTUI rendering or production runtime support. The workaround remains the supported direct pin until a compatible upstream release exists. The report includes explicit code areas to change and clean packed-install, worker-highlight, bash-permission, Node/Bun regression expectations.

## Reproduction and verification

```bash
node --test tests/issue-linking-2335.test.mjs
node --test tests/issue-link-verification-2335.test.mjs
node --test tests/pr-issue-link-before-merge-2395.test.mjs tests/test-repository-mode-closing-references-2306.mjs
node experiments/issue-2335-pr2336-self-misdetection.mjs docs/case-studies/issue-2335/data/hive-mind-pr-2336-body-at-misroute.md
npm test -- --continue-on-failure
npm run lint
npm run format:check
npm run check:duplication
bash scripts/check-file-line-limits.sh
node scripts/validate-changeset.mjs
```

The fake GitHub fixture is finite, rejects unknown endpoints, requires pagination flags, and never merges a live PR. A subprocess imports the actual shared merge function and proves that no merge command runs while the description lacks the closing reference, and that the merge runs once the link is present and confirmed by GitHub. Other tests cover every failing endpoint, malformed responses, missing native links and wrong repositories, code/hidden/negated examples, forks, failed and racing writes, temporary-file cleanup, nested and foreign cycles, non-default closure failures and PR-only workflows.

## Limits and remaining external work

GitHub does not offer a transaction that locks the PR body and the issues together, so a description edit after the final read remains a race; the next run repairs it. A human can merge outside hive-mind, and API permissions, secondary rate limits and upstream compatibility are external constraints. Verification failures stay blocked with actionable evidence; relaxing these conditions is not a workaround.

Agent #322 itself remains an upstream compatibility task. This solver PR does not falsely close it or claim to upgrade OpenTUI. The requested upstream report is filed, and its reproduction, workaround and code plan are preserved.
