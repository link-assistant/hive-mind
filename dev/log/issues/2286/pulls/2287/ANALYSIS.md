# Issue 2286 deep analysis

## Executive conclusion

The audit found three independent false negatives and two false-positive paths:

1. Five npm publications succeeded, but the release workflow stopped polling the public read path after about 90 seconds. Actual read-after-write delays were 157–309 seconds, consistent with the registry response's `Cache-Control: public, max-age=300`. The fix extends read-only verification to the five-minute boundary and never repeats an accepted publish.
2. `/fix --ci-cd` inspected only the latest commit whenever that commit had any Actions runs. The release merge commit had two successful auxiliary runs, so that non-empty result suppressed the branch fallback and hid the failed required workflow on the preceding commit. A first branch-history repair was still vulnerable to GitHub's 1,000-result cap and offset-pagination races; a second draft exposed a stale workflow-specific `branch=main` index. The final fix enumerates active workflows, reads their time-ordered runs independently and selects the default branch locally.
3. Combined branch history contains failures from deleted workflows forever. Active-workflow enumeration prevents those stale records from becoming false positives; a paginated combined query remains a fail-open fallback if the inventory or one direct query is unavailable.
4. The corrected live collector exposed an old but still-current failure in the active Cleanup Test Repositories workflow. It supplied a PAT through `GH_TOKEN` and then tried to refresh stored interactive credentials, a combination GitHub CLI rejects. The workflow now uses the environment token directly and the cleanup script no longer infers classic OAuth scopes from human-readable status output.

The seven protected-branch failures between those two release groups had a different root cause. They were already repaired by PRs #2275, #2280 and #2282 before this investigation; run `35644890960` proves the new release-PR path successfully created and merged PR #2283. No duplicate fix is needed here.

## Requirements and disposition

| ID | Requirement reconstructed from the issue and comment | Evidence / disposition |
| --- | --- | --- |
| R1 | Inspect false positives, false negatives, warnings and errors in CI/CD | Every non-passing Checks and release run from the regression period was downloaded. Run annotations, the initial PR failure and the latest run of every active workflow were also captured. Findings F1–F6 below classify each distinct cause. |
| R2 | Restore the previously reliable npm release behavior | F1 extends post-publish observation beyond npm's five-minute cache horizon and the observed 309-second maximum; the regression test succeeds only on check 15 and proves publish is called once. |
| R3 | Make `/fix --ci-cd` include run `35644890960` | F2 enumerates active workflows, reads their runs independently and validates `head_branch` locally. Deterministic tests recreate the two-success/newest-SHA masking case, a noisy workflow crowding a quiet failure beyond the 1,000-result limit, and GitHub's stale workflow branch index; the final live call included the requested run. |
| R4 | Avoid false-positive CI findings | F3 uses the active workflow inventory rather than historical workflow names, and falls back without accepting partial direct-query results. Regression tests cover stale deleted workflows and a single failed API request. F6 removes the cleanup script's unreliable scope warning. |
| R5 | Compare the full CI/CD tree with the JavaScript template | The current template was cloned at `f2cd4d8623557241fa4127a57a77461751a2f734`; full and CI-focused file trees, the name diff, relevant source snapshots and every change since the previous full Hive audit are archived under `research/template/`. The comparison verdict is below. |
| R6 | Reuse applicable template and Hive CI/CD best practices | The implementation preserves publish/verify separation, bounded backoff, default-off diagnostics, timeout/cancellation policy, one-row-per-workflow reporting, and test-first regression coverage. Existing stronger Hive implementations are retained rather than replaced by generic template plumbing. |
| R7 | Report the defect upstream if the template shares it | Filed [link-foundation/js-ai-driven-development-pipeline-template#197](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/197). |
| R8 | Complete the work in one PR with an automated test | All production, test, documentation, changeset and evidence changes are in PR #2287. |
| R9 | Preserve all collected issue/PR/log evidence in the requested directory | This archive contains the issue, all issue comments/events, all three PR comment/review channels, run metadata/logs, rulesets, registry facts, online research and template comparison. |

## Timeline reconstruction

All times are UTC.

| Time | Event | Consequence |
| --- | --- | --- |
| 2026-09-14 00:24 | Run `34792591319` starts and succeeds | Last green control before the release-failure streak. Even this run initially observes an npm 404 after publish, proving read-after-write delay predated the regression. |
| 2026-09-14 18:40 – 2026-09-15 21:31 | Runs `34882269478`, `34956086702`, `35013947631`, `35024921159` fail | Changesets reports successful publishes for 2.29.1–2.30.0, but seven verification checks end too early. npm later records each version. |
| 2026-09-20 05:45 – 2026-09-21 10:19 | Runs `35492495204`, `35495996039`, `35519980846`, `35526569064`, `35530498148`, `35536130313`, `35587213311` fail | Main becomes protected. Direct version pushes are rejected (`GH013`), and initial fallback PRs cannot satisfy/observe the required check. PRs #2275, #2280 and #2282 iteratively repair this path. |
| 2026-09-21 19:27 | Run `35644890960` starts at `a06e1f0d` | All validation and preflight jobs pass. The protected-release fallback successfully opens and merges version PR #2283, demonstrating the earlier protection defect is fixed. |
| 2026-09-21 19:36:53 | Changesets says 2.31.0 published | The write-side command has succeeded. Republish must no longer be attempted. |
| 2026-09-21 19:38:25 | Seven-check verifier gives up with E404 | Release and terminal gate fail; later GitHub release/tag and image steps are skipped. |
| 2026-09-21 19:41:01 | npm metadata records 2.31.0 | Public visibility arrives 248 seconds after Changesets success and 156 seconds after the workflow falsely failed. Metadata contains the expected Actions OIDC provenance and version-commit `gitHead`. |
| 2026-09-23 13:57 | `/fix --ci-cd` opens issue #2286 | It reports only successful Formal AI Draft and Dependabot runs from merge commit `b9fc7ac2`; failed required run `35644890960` on the immediately preceding commit is omitted. |
| 2026-09-23 13:58 | Comment identifies the omitted run | Adds the explicit collector regression requirement. |
| 2026-09-23 13:58 | PR #2287's initial run `35870842395` fails dependency freshness | The prepared branch was cut before five routine dependency updates. This is branch drift, not the issue's product defect; the branch is refreshed before final validation. |
| 2026-09-23 | First live branch-history repair is exercised | A 1,000-result response once included run `35644890960`, but a later request during a burst of Dependabot runs omitted it because the capped, offset-paginated window moved. This disproved the first draft and produced the crowding regression test. |
| 2026-09-23 | Workflow-specific branch search is cross-checked | `actions/workflows/215799203/runs?branch=main` reports old run `35013947631` as newest while the same endpoint's time-ordered unfiltered response contains `35644890960`. Both raw responses are archived and the stale-index case becomes another regression test. |
| 2026-09-23 | Final per-workflow live collector is exercised | It enumerates 11 active workflows and retrieves seven with default-branch history in under ten seconds, including requested run `35644890960` and active Cleanup Test Repositories failure `18496075671`. Deleted workflow history cannot enter these direct results. |

## Findings, root causes and solutions

### F1 — Successful npm publications reported as failures

**Class:** repeatable CI false negative; active defect.

The release helper correctly separated a successful publish from read-only verification after issue #2082, but its default seven checks covered only about 90 seconds: immediate check, then waits of 2, 4, 8, 16, 30 and 30 seconds. The assumption was contradicted by every affected registry record:

| Version | Publish success in CI | npm metadata time | Propagation |
| --- | --- | --- | ---: |
| 2.29.1 | 18:50:12 | 18:55:21 | 309 s |
| 2.29.2 | 10:14:54 | 10:18:02 | 188 s |
| 2.29.3 | 19:40:26 | 19:43:03 | 157 s |
| 2.30.0 | 21:29:20 | 21:31:58 | 158 s |
| 2.31.0 | 19:36:53 | 19:41:01 | 248 s |

There is no release-code change between the last successful control (`24568aac`) and the first failing publish (`e54c5be9`) that explains the boundary. The variable is registry visibility. The captured package endpoint advertises a five-minute public cache lifetime, and npm CLI reports [#3424](https://github.com/npm/cli/issues/3424), [#593](https://github.com/npm/cli/issues/593) and [#9043](https://github.com/npm/cli/issues/9043) independently document newly published versions being temporarily unreadable. npm CLI [#9045](https://github.com/npm/cli/pull/9045) addresses a client-side cached packument path, but cannot eliminate server/CDN propagation.

**Considered solutions:**

- Republish on a verification miss: rejected; npm versions are immutable and the first publish was accepted.
- Treat publish exit 0 as final success: rejected; it would hide a genuinely unavailable package and start downstream consumers too early.
- Poll indefinitely: rejected; a bounded job must still surface a genuine registry failure.
- Poll the read path through the cache horizon: selected; it preserves proof and idempotence.

**Implemented:** 15 checks with the existing capped exponential backoff. The last check occurs after 330 seconds, covering both the five-minute cache horizon and the observed 309-second maximum. A deterministic test returns false 14 times and true on check 15, while asserting exactly one publish call.

**Operational consequence:** versions 2.29.1–2.31.0 exist on npm but their failed workflows did not reach later GitHub release/tag work. The code change prevents recurrence. Historical release bookkeeping should only be backfilled from the recorded npm `gitHead` values by an explicitly authorized release operation; fabricating tags from the PR branch would be unsafe.

### F2 — `/fix --ci-cd` omitted the failed required workflow

**Class:** issue-generation false negative; active defect.

The collector queried runs for the newest default-branch SHA first and queried branch history only when that array was empty. Merge commit `b9fc7ac2` had two successful auxiliary workflows, so the array was non-empty. The immediately preceding `a06e1f0d` run of Checks and release was therefore never fetched, although it was the repository's latest run for that workflow and its required `Pipeline Status` failed.

The query was also limited to the first 100 results. Simply paginating the combined branch endpoint did not fully solve that: GitHub caps filtered run searches at 1,000 records, and offset pages can shift while new runs arrive. A live request during a Dependabot burst omitted `35644890960` even though an earlier request had found it. This was captured as a failing pre-fix experiment rather than dismissed as flakiness.

The obvious per-workflow `branch=main` query was not reliable either. On 2026-09-23, workflow `215799203` returned `35013947631` as its newest filtered run, while its unfiltered, time-ordered response placed `35644890960` four records from the front with `head_branch: main`. The raw contradictory responses are preserved as `checks-release-workflow-runs-{branch-filter,unfiltered}.json`.

**Implemented:** enumerate every workflow whose API state is `active`, read each workflow's time-ordered runs concurrently, and select the first run whose `head_branch` exactly matches the default branch. Pages are fetched only until that match appears, up to GitHub's 1,000-result search boundary; the server-side branch index is only a last resort beyond that boundary. A noisy workflow can no longer crowd out another, and neither combined-page movement nor stale branch filtering determines the answer. If inventory lookup or any direct query fails, the collector rejects that partial set and falls back to paginated combined branch history; the exact-SHA query remains the last fallback. The issue explicitly labels which source was used.

### F3 — Deleted workflows became permanent false-positive failures

**Class:** issue-generation false positive discovered by live verification; active defect.

Branch history contains runs for workflows that no longer exist. The first F2 draft found two deleted 2025 workflows that would have appeared as current failures forever. Deduplication cannot solve this because their last run remains their newest run.

**Implemented:** the primary collector starts from the paginated workflow inventory and therefore never queries deleted or disabled workflows. In the combined-history fallback, known inactive IDs are filtered; runs with no workflow ID remain visible for backward compatibility. If inventory is unavailable, collection fails open to combined history rather than silently discarding evidence.

### F4 — Protected-main release failures

**Class:** historical real failures; already fixed before issue #2286.

Seven runs failed after repository rules began rejecting direct version pushes. Earlier fallback versions either retried a permanent `GH013` policy rejection or opened PRs whose required `Pipeline Status` could not be satisfied. The progression is preserved in related issues #2274/#2279/#2281 and PRs #2275/#2280/#2282.

The final fix uses the workflow token to create a deterministic release PR and writes the already-passed parent workflow's check conclusion to that exact version commit before merge. Run `35644890960` then successfully merged PR #2283. This is a repository-specific alternative to the template's dedicated `RELEASE_PR_TOKEN`; replacing a proven short-lived-token design with a long-lived PAT is not an improvement.

### F5 — Initial PR dependency-freshness failure

**Class:** real but incidental branch-staleness failure.

Run `35870842395` failed in `detect-changes` because the prepared branch's dependency snapshot was behind current registry releases (`@sentry/node`/profiling, `jscpd`, `prettier`, `use-m`, and `dotenvx`). Security checks passed. Those pins and the lockfile are updated; the same freshness command now reports 148/148 declarations current.

The mandatory same-day tool updates changed two measurements. jscpd 5.3.2 deliberately made clone ranges inclusive: against the identical tree, 5.3.1 and 5.3.2 find the same 2,690 clones and 146,204 duplicated tokens, but the corrected counter adds exactly one line per clone (26,441 to 29,131, or 10.55% to 11.62%). The ceiling moves from 11% to 12%, retaining slightly less margin than the former counter instead of suppressing a real increase. Prettier 3.9.9 also fixes Markdown text containing `$` being parsed as math; its one affected archived paragraph (which begins with `"$`) is reformatted. The upstream release metadata, comparison, and both before/after local outputs are archived.

### F6 — Cleanup workflow mutates an environment-provided credential

**Class:** active workflow failure plus false permission warning; active defect discovered by codebase-wide live verification.

The latest default-branch run of the active Cleanup Test Repositories workflow is `18496075671` (2025-10-14), and it failed in 14 seconds. GitHub has expired its logs (HTTP 410), but preserved job metadata and an exit-1 annotation. The current workflow and that run's exact commit both set `TEST_GITHUB_USER_REPO_DELETION_TOKEN` as `GH_TOKEN`, then execute `gh auth refresh -s delete_repo`. GitHub CLI's primary documentation says environment tokens take precedence and are the intended headless authentication method, while `auth refresh` changes stored credentials through an interactive authorization flow. GitHub CLI discussion #9647 records the exact refusal when an environment token is present. Issue #533's preserved screenshot shows the same workflow family previously failing because it tried `auth login` while an environment token was active; PR #534 replaced login with refresh but did not remove the underlying credential-model conflict.

The cleanup script added a second problem: it searched the human-readable `gh auth status` text for the classic `delete_repo` OAuth scope. Environment and fine-grained PATs do not reliably expose that string, so a valid token could produce a false missing-permission warning. In force mode the warning was ignored anyway; only an actual delete API response establishes the permission.

**Implemented:** use `GH_TOKEN` directly, verify it non-interactively with `gh auth status` and `gh api user`, and document that the secret must already have classic `delete_repo` or fine-grained repository `Administration: write`. The script now verifies authentication without parsing scope prose and gives environment-aware guidance only after an actual 403/delete-permission failure. A regression contract fails on login/refresh commands and on status-text scope inference. After merge, a manually dispatched dry run can replace the stale default-branch failure without deleting repositories.

## Warning and error audit

- Run `35644890960` has three failure annotations: release exit 1, terminal gate exit 1, and `Pipeline failed. Failing jobs: release`. The full log reduces all three to F1's final E404.
- Run `35870842395` has three failure annotations: detect-changes exit 1, terminal gate exit 1, and the corresponding failing-job summary. Its log reduces them to F5.
- The five propagation failures share F1; the seven protected-main failures share F4. The active cleanup workflow failure is F6. No other distinct error signature exists in the downloaded regression-period logs.
- The last-green full log is retained as a control. Its initial npm E404 followed by eventual success demonstrates that an E404 during propagation is not proof of publish failure.
- The cleanup log itself has expired, so the archive records the HTTP 410 rather than presenting an empty file as evidence. Its credential conflict is nevertheless deterministic from the exact workflow revision and GitHub CLI's documented behavior. The replacement step retains safe authentication status and API-identity output. No new verbose mode is needed: existing release commands already record every publish, verification attempt, exit code and GitHub policy response, while the cleanup verification exposes the failing boundary without printing a token.

## Full template comparison

The preceding full Hive audit in issue #2198 compared template commit `7ae16b0e` and adopted workflow linting, secret/link/dependency gates, resilient BuildKit startup, tracked-file line checks and other applicable controls. This investigation compares the current template commit `f2cd4d86` and explicitly inspects all files changed since that baseline, principally template PRs [#183](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/183), [#191](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/191) and [#195](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/pull/195).

| Template area / newer practice | Hive status and decision |
| --- | --- |
| Publish retry vs post-publish verification | Same architecture, but both projects retained a too-short default. Hive's observed production timings justify the five-minute fix and upstream report #197. |
| Whole-push change detection and “previous head actually passed” proof | Already implemented and regression-tested in Hive by issue #2198. |
| Package-manager declaration/check | Already implemented (`devEngines.packageManager`, `check-package-manager.mjs`) and gated. |
| Workflow lint, zizmor, dependency audit, secret scan, docs links, tracked-file limits | Already implemented by the preceding audit; Hive also keeps its stronger CodeQL config and content-based npm failure classifier. |
| Release credential preflight | Already implemented as `release-preflight.yml` with npm OIDC and Docker Hub probes. |
| Protected-branch release fallback | Template requires a dedicated token. Hive independently uses short-lived built-in authentication plus check attestation; run `35644890960` proves it now works. |
| Pinned Ubuntu runner labels | All active Hive Linux jobs use `ubuntu-24.04`; existing tests enforce job timeouts/cancellation policy. |
| Docker manifest and transient-link hardening added in template PR #191 | Useful generic enhancements, but neither signature occurs in the issue's runs. Hive already fails an empty manifest and fails every unresolved link; changing these paths without a Hive reproduction would broaden a release incident fix without addressing a collected error. Their source and rationale remain archived for a separately reproduced change. |
| Template status-gate/process-budget helper scripts | The generic template has five small workflows and can share this layout. Hive's release workflow already has an exhaustive terminal gate and repository-specific cancellation tests; its long-running model/runtime process handling is separate. No collected failure maps to template process-budget code. |
| Example application workflow and generic modular bootstrap/release helpers | Template-specific structure, not missing Hive coverage. Hive has product-specific Docker/Helm/model workflows and stronger equivalents under different filenames. |

The raw file-tree name diff is intentionally not treated as a to-do list: Hive has 371 CI-related files versus the template's 105 because it is a product repository, while the template splits several helpers Hive deliberately keeps together. Every post-baseline template change is represented in `changes-since-last-hive-audit.txt`; the relevant release helpers are copied verbatim for review.

## Automated proof

| Regression | Before fix | After fix |
| --- | --- | --- |
| Registry becomes readable only on check 15 | verifier returns failure after check 7 | succeeds on check 15; publish count remains 1 |
| Latest SHA has two successes, previous SHA has failed required workflow | failed workflow absent because branch fallback is skipped | branch is always queried; failed workflow and URL appear |
| More than one API page of branch history | only first 100 runs examined | `--paginate --slurp` and normalization cover all returned pages |
| Busy workflow fills/moves the 1,000-result window | quiet required workflow can disappear from combined history | each active workflow's runs are queried independently |
| Workflow-specific `branch=main` index is stale | old run `35013947631` is reported instead of `35644890960` | time-ordered workflow runs are fetched and `head_branch` is checked locally |
| One per-workflow API call fails | successful subset could masquerade as complete | partial set is rejected and paginated combined-history fallback is used |
| Deleted workflow's last run failed | stale failure appears forever | deleted workflow is absent from the active inventory and is never queried |
| Cleanup workflow has `GH_TOKEN` and calls login/refresh | GitHub CLI exits before cleanup | environment token is used directly and verified with the API |
| Fine-grained/environment PAT lacks classic scope text | false missing-`delete_repo` warning | status prose is not parsed; actual API failure drives environment-aware guidance |

All tests use mocks/no-op sleepers, so the five-minute production safety window adds no test-suite delay.
