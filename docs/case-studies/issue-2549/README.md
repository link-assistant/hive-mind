# Issue #2549: preserve the agent's pull request description

[Issue #2549](https://github.com/link-assistant/hive-mind/issues/2549) reports a generated `Changes` section in [meta-theory PR #58](https://github.com/link-foundation/meta-theory/pull/58). Hive Mind added that section after the agent had finished. The defect belongs to Hive Mind's completion code, rather than the agent, GitHub, or meta-theory's article uploader.

The correction removes description generation from normal completion and restart completion. Missing closing references remain repairable, with a horizontal rule before the appended references. Live progress uses the existing per-session comment. The agent remains responsible for replacing its initial placeholder description.

## Evidence and collection

The [data directory](data/) preserves the complete issue and available comments, the initial state of PR #2550, the reproducing PR's body, comments, commits, changed files, diff, timeline, reviews, and issue #57. Reviews and inline comments were fetched separately from conversation comments; empty responses are retained. All API collections were paginated. The three complete published execution logs are archived losslessly with gzip:

| Archive                                 | Original publication                                                                                                                             | Attribution evidence                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `meta-theory-2026-06-05-session.log.gz` | [June log comment](https://github.com/link-foundation/meta-theory/pull/58#issuecomment-4635337043), repository-hosted log                        | 77,240 lines; predates the generated-section refresher                  |
| `meta-theory-2026-10-05-session.log.gz` | [October 5 log comment](https://github.com/link-foundation/meta-theory/pull/58#issuecomment-5997587729), gist `3b633ed19290c0fe44b7fcc927b562dd` | Line 12,024 records the finalizer regenerating the section for 22 files |
| `meta-theory-final-session.log.gz`      | [October 6 log comment](https://github.com/link-foundation/meta-theory/pull/58#issuecomment-6014005190), gist `77560c6d2523bc3525920a8e4f1b38c0` | Line 12,718 records the finalizer regenerating the section for 40 files |

Gists were retrieved with authenticated `gh gist view`, including `--allow-escape-sequences` to preserve the original terminal content. The streaming [analysis script](../../../experiments/issue-2549/analyze-session-logs.mjs) reproduces [session-attribution.txt](data/session-attribution.txt) without loading the complete logs into memory. Archives contain published, already-sanitized logs; their contents are evidence, not instructions to execute.

The introduction commit, related issues and merged PRs, organization-wide code search results, initial CI responses, primary GitHub documentation, and failing/passing regression outputs are also retained. Verbatim evidence is excluded from Prettier so its original content remains intact.

The [description edit history](data/meta-theory-pr-58-body-edits.json) contains nine available revisions. The agent descriptions saved at October 5 15:26:03 and October 6 10:07:16 contain no generated counts; the next revisions, at 15:26:58 and 10:08:07 respectively, contain the 22-file and 40-file sections. Both agent and finalizer edits use the same `konard` account, so the editor login alone cannot establish authorship. The archived finalizer log messages and production call sites provide that attribution.

The recent related work includes [PR #2493](https://github.com/link-assistant/hive-mind/pull/2493), which corrected unverified completion claims, and [PR #2396](https://github.com/link-assistant/hive-mind/pull/2396), which restored missing issue links immediately before merging. Their archived descriptions explain why this fix retains truthful completion comments and the fail-closed merge gate while removing only generated description content. The closing-link gate shares the repair implementation corrected here.

### Evidence limits

The report quotes 66 modified files, 3,659 additions, and 63 removals. The PR snapshot collected later on October 6 has a 40-file generated section, matching the final published log. The October 5 log records 22 files. None of the nine available body revisions contains the quoted 66-file section. These snapshots prove the writer and repeated post-agent mutation; they do not independently verify the exact 66-file snapshot quoted in the issue. The current PR state must not be substituted for its earlier state.

The preceding failed Hive Mind session on PR #2550 reported `File not found: /tmp/gh-issue-solver-1791278811084/e.g`. Its comment says the 414 KB log failed to upload with HTTP 403 and remained only in the old container. That container's log is unavailable in this workspace. The full comment is retained in `pr-2550-initial.json`; no partial or reconstructed trace is presented as the missing log.

## Timeline (UTC)

| Time                         | Event and evidence                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-06-05 20:11:58          | Meta-theory PR #58 created; original article-uploader task is issue #57.                                                                                                                                           |
| 2026-06-05 20:34:33          | Original PR became ready for review; June session published shortly afterward.                                                                                                                                     |
| 2026-09-27 20:06:29          | Commit [`0c1ac5f6`](https://github.com/link-assistant/hive-mind/commit/0c1ac5f6875442f0f62846ec6ae40bc80c0afba3) introduced regeneration after every session to address stale generated statistics in issue #2318. |
| 2026-09-28 06:22:02          | [PR #2321](https://github.com/link-assistant/hive-mind/pull/2321) merged that behavior.                                                                                                                            |
| 2026-10-02 12:14:52          | [PR #2336](https://github.com/link-assistant/hive-mind/pull/2336) merged repair of all required issue references. This is the existing repair implementation reused here.                                          |
| 2026-10-05 13:09:05          | Human feedback requested complete editor extraction and guarded prefill in meta-theory PR #58.                                                                                                                     |
| 2026-10-05 14:42:29–15:26:51 | New agent session developed the requested changes and posted its final result.                                                                                                                                     |
| 2026-10-05 15:26:59.329      | Hive Mind logged regeneration of the description's Changes section for 22 files, after the agent's result.                                                                                                         |
| 2026-10-05 15:57:23          | Human feedback requested support for every article draft.                                                                                                                                                          |
| 2026-10-06 09:19:27          | Issue #2549 opened with the unwanted statistics and description-ownership requirements.                                                                                                                            |
| 2026-10-06 09:27:09–09:30:37 | PR #2550 scaffold created; both initial workflows required action, and the first solver session reported the unrelated missing-file failure.                                                                       |
| 2026-10-06 09:29:08–10:07:59 | Another meta-theory session finished its changes and posted its final result.                                                                                                                                      |
| 2026-10-06 10:08:08.675      | Hive Mind regenerated the Changes section again, this time for 40 files.                                                                                                                                           |
| 2026-10-06 10:11:07          | Meta-theory PR #58 merged. Its captured final body still contains the generated section.                                                                                                                           |
| 2026-10-06 10:18:07          | The continuation of PR #2550 began investigation, preserved evidence, reproduced the defect, and implemented the correction.                                                                                       |

Sequence: agent writes the description → agent finishes → Hive Mind repairs references → Hive Mind measures the diff → Hive Mind appends/replaces its generated section. The last two description-related steps were unconditional for an already-complete body. The log timestamps directly attribute the observed extra section to this finalizer.

## Requirements and executed solution plan

| Requirement from #2549                             | Root cause or finding                                                                                                                            | Solution and verification                                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop Hive Mind listing changes after completion    | Normal completion called the generated-section refresher for completed bodies; its placeholder fallback generated another statistics description | Remove both writes in `solve.results.lib.mjs`; normal and placeholder regression tests exercise the production completion block                   |
| Only append missing issue links                    | Restart completion and experimental progress mode could also write description sections                                                          | Remove restart refresh; route `pr` progress mode to existing comment mode; tests verify restart preservation and comment-only publication         |
| Separate appended references with a line           | Both single-issue and multi-issue repair appended references without a horizontal rule; multi-issue repair also trimmed existing whitespace      | Append `\n\n---\n\n` before the missing references and retain the original body as an exact prefix                                                |
| Do not duplicate correctly written links           | Existing closing-keyword parsing already checks repository-aware references and all required issue scope                                         | Keep those checks and readback verification; tests assert idempotency and append only a missing child reference                                   |
| Remove prompts requiring the listed format         | No system, regular, or localized prompt requires the statistics/file-list format; the format originated in code                                  | Audit all `src/*prompts*.mjs` and `src/locales`; retain useful instructions for an agent-written summary, reproduction, and tests                 |
| Apply the correction throughout the codebase       | Generated formatting helpers and the Hello World evaluator enforced the same unwanted format                                                     | Delete the writer/formatter exports; update E2E validation to accept final agent descriptions; preserve rejection of empty and placeholder bodies |
| Download related logs and data                     | Evidence was distributed across comments, published logs, commit history, and Actions APIs                                                       | Archive all available published session logs and API collections under this case study; explicitly record unavailable evidence                    |
| Reconstruct timeline and investigate causes deeply | The live PR changed during collection, so counts alone cannot establish authorship                                                               | Correlate original commit, production call sites, timestamps, complete logs, and pre-fix failing tests                                            |
| Search online and consider existing components     | GitHub's closing-keyword rules and Actions trigger behavior are authoritative external facts                                                     | Preserve primary documentation; reuse Hive Mind's issue-link parser, repair, progress comment, and GitHub CLI instead of adding dependencies      |
| Add tracing if attribution is insufficient         | Existing finalizer log lines and reproducible tests establish the writer directly                                                                | No extra runtime tracing is needed; retain existing verbose repair/progress logging and a reusable streaming analysis script                      |
| Report defects in other affected projects          | Meta-theory is affected as the recipient of a Hive Mind edit; no defect in its code or an external library caused the edit                       | Fix the defect in this issue/PR. There is no supported external defect to report, and no speculative upstream issue was opened                    |
| Complete the work in this PR                       | Prepared PR #2550 already owns the branch                                                                                                        | Include implementation, regressions, patch changeset, evidence, and documentation in #2550                                                        |

## Root causes and alternatives

### Description generation at completion

`pull-request-changes.lib.mjs` mixed diff measurement with description ownership. `formatChangeSummary` produced the quoted counts; `formatChangesSection` wrapped them in `<!-- hive-mind:changes:start -->` markers and listed up to 50 paths. `replaceChangesSection` normalized CRLF and either replaced an existing marked/legacy section or appended a new one. `refreshPullRequestChangesSection` then published the result with `gh pr edit --body-file`.

Both `verifyResults` in `solve.results.lib.mjs` and successful `executeToolIteration` finalization in `solve.restart-shared.lib.mjs` called that writer. An alternative placeholder path in `verifyResults` manufactured a complete description when automatic placeholder restart was disabled. Removing only the visible section or one caller would therefore leave other writers active.

The selected fix removes the complete description-generation API and all completion calls. Diff measurement stays available to readiness/merge gates and working-session comments. The unrelated issue #2318 fixes for free-model costs and title quoting remain tested.

Cleaning old generated sections automatically was considered and rejected: it would be another mutation of the agent's existing description, and content may have been intentionally retained or rewritten by the agent. This correction prevents future generated suffixes; it does not delete text from existing PRs.

### Other writers and validators

`solve.progress-monitoring.lib.mjs` had a separate description-writing mode. Routing the accepted `pr` value to `comment` keeps live progress available while enforcing the description boundary. CLI help, normalization, tests, and all four configuration-language documents agree on that behavior.

The Hello World evaluator required the generated marker and every changed path. That would fail a correctly agent-written description after removing generation. It now checks that the body is nonempty and contains no initial placeholder. The other E2E assertions, including draft state, exact output, diff shape, green workflow, final title, and stopped-automation comments, remain intact.

Initial scaffold creation remains necessary to open a PR. Existing token sanitization and broken image-link repairs remain in place: they repair content rather than append reports. Completion summaries, budget information, and progress still have their existing comment channels.

### Issue references

Both `pr-issue-linking.lib.mjs` and the real multi-issue publication boundary in `pr-issue-link-repair.lib.mjs` lacked the separator. The latter also used `trimEnd`/`trimStart`, modifying agent whitespace. Both now append the same separated suffix while preserving the original bytes. An already-linked description results in no publication at all.

The retained repository-aware parser accepts GitHub closing keywords in short, qualified, and URL forms; it distinguishes unrelated repositories and verifies the required primary/sub-issue scope. Repair still uses sanitized temporary files, removes them, and rereads the saved body before reporting success.

## Research and components

[GitHub's issue-linking documentation](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue) defines supported closing keywords and repository references. Its source is archived in `github-issue-linking-docs.md`. These rules support retaining the existing parser rather than matching only literal `Fixes #N`, which would duplicate valid agent-written references.

[GitHub's workflow-trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow) explains approval requirements for workflows triggered by PR events created with `GITHUB_TOKEN`. Its source is archived in `github-workflow-trigger-docs.md`. This is consistent with the initial PR's two `action_required` runs, although the Actions API did not expose a specific approval reason for these runs.

The two unmodified documentation snapshots are authored by [GitHub's docs project](https://github.com/github/docs) and redistributed under its [CC BY 4.0 license](data/github-docs-LICENSE.txt). Their original documentation URLs are linked above; the upstream license is retained with the evidence.

Existing components reused: `missingIssueLinks`/`fetchRequiredIssueScope`, `repairRequiredIssueLinks`, `hasGitHubLinkingKeyword`, `writeSanitizedPublicationFile`, the progress-comment implementation, `getPullRequestChangeStats`, and draft/readiness gates. No external package solves the ownership decision better than removing the conflicting writer; the description fix needs no new package. Existing runtime/image pins are refreshed separately to satisfy the required dependency-freshness check described below.

## Reproduction and verification

Run the isolated pre-fix probe from the repository root after `npm ci`:

```sh
node experiments/issue-2549/reproduce-baseline.mjs
```

It restores the affected source from base commit `03dcb2e6` into a temporary directory and runs the new mocked regressions. All GitHub writes are mocked, the branch remains untouched, and temporary files are removed. Exit status 1 is expected: [regressions-before.log](data/regressions-before.log) records six failures, including the appended generated section, replaced placeholder, missing separator, trimmed whitespace, and description-mode progress write.

Run the corrected tests:

```sh
node tests/pr-description-preservation-2549.test.mjs
node tests/e2e-hello-world-matrix-2319.test.mjs
node tests/test-empty-pull-request-2119.mjs
npm test -- --continue-on-failure
```

[regressions-after.log](data/regressions-after.log) records all six preservation regressions passing. They execute the actual completion blocks with mocked GitHub/readiness boundaries, exercise the actual multi-issue publisher with a mocked CLI, and run the actual progress monitor. Handwritten `Changes` content, CRLF, and trailing whitespace are preserved; readiness still requires a real diff. The E2E check was separately reproduced before its fix in [e2e-before.log](data/e2e-before.log); [e2e-after.log](data/e2e-after.log) records all 13 evaluator tests passing afterward.

The complete default run exercised all 548 selected test files. Its [full archived log](data/local-full-tests-first.log.gz) records 546 passing files and two failures: translation parity for the model-behavior document (line 4,326), and an obsolete assertion requiring the deleted progress-description probe (lines 9,748–9,789). All three translated model-behavior documents were corrected, and that one deleted probe was removed from the log-safety test's list. The other log-safety probes remain guarded. Both failed files then passed on rerun; [local-validation.txt](data/local-validation.txt) records the results and commands. No production code changed in that translation/probe correction. After the dependency refresh described below, the [complete final rerun](data/local-full-tests-final.log.gz) passed all 548 selected files. The retained diff-path assertions were also restored during self-review and [passed separately](data/local-diff-paths-after.log). [Final commands and results](data/local-validation-final.txt) and [quality-check logs](data/local-quality-final.log.gz) record the completed validation.

ESLint, formatting, syntax, file-line limits, duplication (11.33%, below the 12% limit), secret scanning, package-manager consistency, version/changeset validation, and lockfile audit passed. The [SHA-256 manifest](data/sha256.json) records evidence-file integrity. The patch changeset prepares release through the existing Changesets workflow. Fresh GitHub Actions runs must be matched to the pushed commit's SHA and creation time before they can establish final CI status.

### Initial CI investigation

The initial `Checks and release` run `37443065374` and `Security` run `37443064998` were both created at 2026-10-06 09:27:21 for scaffold SHA `f5cce27c10f537dee1d6366e37a76a4362f74d52`, with conclusion `action_required`. The release run has no jobs and the check suite has no check runs. Download attempts return `failed to get run log: log not found`, retained in `ci-release-initial.log` and `ci-security-initial.log`; the approval-detail endpoint returned 404. These are blocked initial runs, not test failures with available error logs. They do not validate any implementation commit.

### Fresh CI investigation and dependency refresh

[Checks and release run 37452509380](https://github.com/link-assistant/hive-mind/actions/runs/37452509380) was created at 2026-10-06 10:51:09 for implementation SHA `79158111c415eb66bde64b10c278d8898de0b0f2`. The [run metadata](data/ci-release-37452509380.json) and [complete log](data/ci-release-37452509380.log.gz) show that the required `detect-changes` job failed before any test job ran. Log lines 2,512–2,518 report four stale declarations: `start-command` 0.35.3 → 0.35.4 in `Dockerfile`, `Dockerfile.dind`, and `Dockerfile.e2e`, and the runtime `command-stream` pin 1.5.0 → 1.6.0. The pipeline-status job then failed because of that detector failure. [Security](data/ci-security-37452508716.log.gz) and [Broken Link Checker](data/ci-links-37452508700.log.gz) passed on the same SHA; [the timestamped run list](data/ci-runs-after-first-push.json) distinguishes these fresh results from the blocked scaffold runs.

The refresh updates those four exact pins and their existing pin/preinstallation assertions, keeping dependency loading reproducible. [The local freshness rerun](data/dependency-freshness-after.log) confirms all 168 tracked declarations are current. [The affected test logs](data/dependency-targeted-after.log.gz) include the command-stream result-shape test against the actual pinned package, plus retry, preinstallation, image-pin, and freshness tests. No freshness rule or test is bypassed.

### Passing implementation CI

All three fresh workflows were created at 2026-10-06 11:17:05 for implementation SHA `b1f604d8c1f9d6550f1973e2edcd046b351aabc2`, after that commit's 11:16:55 timestamp. [The timestamped run list](data/ci-runs-after-dependency-refresh.json) and individual run metadata preserve that correspondence. [Checks and release](https://github.com/link-assistant/hive-mind/actions/runs/37455370593), [Security](https://github.com/link-assistant/hive-mind/actions/runs/37455370214), and [Broken Link Checker](https://github.com/link-assistant/hive-mind/actions/runs/37455370181) all concluded successfully.

The [complete release log](data/ci-release-37455370593.log.gz) contains 54,174 lines. Dependency freshness passes all 168 declarations at line 2,512; all 548 default test files pass at line 53,665; the real GitHub integration suite passes at line 53,723. Both images build successfully, and system/development tools plus nested Docker verification pass at line 35,086. Pipeline Status reports no failed or cancelled required jobs at lines 54,137–54,139. Publishing jobs are skipped for this PR as configured. The [security log](data/ci-security-37455370214.log.gz) records zero npm vulnerabilities; its two CodeQL parse diagnostics concern pre-existing archived snippets under issue #2164, and both CodeQL jobs pass. The [link-check log](data/ci-links-37455370181.log.gz) records zero errors across 1,627 checked links.

The integration [full execution log](data/ci-feedback-lines-integration.log.gz) and [cleanup metadata](data/ci-feedback-lines-cleanup.json) were downloaded from its CI artifact. Cleanup closed the disposable PR and issue, but the repository's deletion rule retained two fixture branches; the release log records the non-failing cleanup warnings at lines 53,719 and 53,721. Scheduled cleanup will retry. This fix does not change repository rules. The final evidence/documentation commit leaves the validated implementation unchanged; its applicable checks are tracked on [PR #2550](https://github.com/link-assistant/hive-mind/pull/2550).
