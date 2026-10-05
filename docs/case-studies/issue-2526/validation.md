# Validation record

Environment: Node.js 26.10.0, npm 11.19.1, Codex CLI 0.160.0.

## Regression evidence

- Original effort test: `none !== low`, retained in `data/before.log`.
- Claude commander: explicit `MAX_THINKING_TOKENS=0` instead of an omitted manual budget, retained in `data/claude-before.log`.
- Gateway cache: CLI `low` instead of gateway `auto`, retained in `data/cache-before.log`.
- Fixed pure, cache and native new/resumed command tests pass. The selector exhausts 255 nonempty subsets × 8 requested levels (2,040 cases).
- The existing real-process cancellation probe failed because its fake binary did not implement `debug models`: it waited for stdin instead of returning metadata, exceeded the existing 10-second bound, and left its shared cache lock when killed. The fixture now answers the metadata request and isolates state in its temporary directory. The bound is unchanged; all 25 automation tests pass. Before/after evidence is retained in `data/cancellation-{before,after}.log`.
- Final review found that a future capability list could select `ultra` above organization planning's existing `xhigh` ceiling. The added regression failed with `ultra !== none`; capability selection now filters by the ceiling first, runtime resolution carries the constraint through, and command construction rejects injected upper tiers. A model with no permitted tier produces an actionable error. Evidence is retained in `data/planning-ceiling-{before,after}.log`.
- A fake-CLI regression also reproduced a missing rollout cap in connection validation when a future model's only supported effort is `ultra`. Validation now forwards the resolved cap, matching normal execution. The test captures actual subprocess arguments and runs no inference; `data/connection-budget-{before,after}.log` preserves the failing and passing assertions.

## Local checks

Targeted reasoning/capability/native, commander, organization, default-off, dynamic-model, dependency-pin, start-command, preinstall, use-with-retry, command-stream and cancellation tests pass. The final complete default-suite run passed all 547 selected test files with exit code 0 after correcting the bounded fixture.

Completed checks:

| Check                                                              | Result                                                             |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `npm ci`                                                           | Success; 266 installed packages, zero audit vulnerabilities        |
| `node scripts/run-tests.mjs --suite default --continue-on-failure` | Pass; all 547 selected test files                                  |
| `npm run lint`                                                     | Pass                                                               |
| `npm run format:check`                                             | Pass                                                               |
| `npm run check:duplication`                                        | Pass; 11.32%, below the 12% threshold                              |
| `npm run check:secrets`                                            | Pass; archived evidence also scanned with the ignore file disabled |
| `node --check` for repository `.mjs` files                         | Pass                                                               |
| Repository file/workflow line limits                               | Pass; all within 1,500 lines                                       |
| `node scripts/check-package-manager.mjs`                           | Pass; npm declaration and lockfile agree                           |
| `node scripts/validate-changeset.mjs`                              | Pass; exactly one patch changeset                                  |
| `node scripts/check-version.mjs`                                   | Pass; release workflow manages the package version                 |
| Documentation validation and language synchronization              | Pass                                                               |
| `node scripts/check-dependency-freshness.mjs`                      | Pass; 168/168 declarations current                                 |

Raw local logs remain in ignored `ci-logs/`. The first full suite encountered one dependency-fixture regex still expecting `command-stream@1.3.0`; that expectation was corrected and its targeted test passes. The next run was stopped after exposing the cancellation fixture's metadata-read timeout; its failure is retained. Neither result is presented as a passing full suite.

## Dependency freshness

The approved CI run found five stale declarations already present on `main`: three Dockerfile pins of `start-command@0.35.1`, the runtime `command-stream@1.3.0` pin, and the runtime `@dotenvx/dotenvx@2.32.4` pin. Registry metadata reports 0.35.3, 1.4.0 and 2.33.0 respectively. The pins and fixtures are refreshed together as a separate maintenance step so the PR can pass the existing check. The change does not relax freshness enforcement. The initial local check found four stale pins before the dotenvx release; the later CI run provides the complete five-pin result. Original and fixed local output is retained under `data/dependency-freshness-{before,after}.log`.

## Initial CI investigation

| Run                                                                                                    | Created UTC, 2026-10-05 | Head SHA                                   | Initial conclusion | Approved attempt 2 |
| ------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------ | ------------------ | ------------------ |
| [Checks and release 37339179788](https://github.com/link-assistant/hive-mind/actions/runs/37339179788) | 16:13:40                | `424601c69f80806d3ff11336f296aab777a9346f` | action_required    | failure            |
| [Security 37339179190](https://github.com/link-assistant/hive-mind/actions/runs/37339179190)           | 16:13:39                | `424601c69f80806d3ff11336f296aab777a9346f` | action_required    | success            |

Both creation timestamps follow the prepared commit's 16:12:51 timestamp; both reference that exact head SHA. Their actor/triggering actor is `github-actions[bot]`. Initially no jobs or check runs were created, and log downloads returned `failed to get run log: log not found`; these responses are retained under `data/initial-ci-*.log`.

The authenticated Actions approval endpoint accepted both runs at 18:45 UTC, creating attempt 2 without requiring user intervention. Security's npm audit, dependency review and both CodeQL jobs passed. Checks failed in `detect-changes` on freshness before its implementation checks could run. The complete downloaded log is retained in `data/ci-checks-37339179788-attempt-2.log`:

- Line 2489: `STALE Dockerfile:309: start-command 0.35.1 -> 0.35.3`.
- Lines 2491–2492: the same stale pin in `Dockerfile.dind:324` and `Dockerfile.e2e:14`.
- Line 2493: `@dotenvx/dotenvx 2.32.4 -> 2.33.0`.
- Line 2494: `command-stream 1.3.0 -> 1.4.0`.
- Lines 2495–2496: `Dependency freshness failed: 5 stale, 0 unresolved`, exit code 1.

`Pipeline Status` propagated that failure; the release preflight passed. CI's synthetic merge checkout is `f1a43f971aa3a33b20724f78f571c6804fb9733b`; the event/run head SHA above identifies the prepared PR commit. This was a baseline dependency failure, not an effort regression. Fresh runs after the implementation push are matched to the new head SHA and checked independently.

## Implementation verification

The implementation is commit `1f44fdc07366262b64b3594a2a24bf93b2ef3c21`; dependency maintenance is `9ed9e5efd4aae9e245327c4b4885c098099c4d71`, committed at 19:14:55 UTC and pushed only to `issue-2526-977f266926a4`. A fresh fetch confirmed that `main` commit `80fb6529d3128c3782b21b2e9fef5dc766c5a543` was already an ancestor, so no merge commit was necessary.

All three implementation workflow runs were created at 19:15:16 UTC, after that commit, and reference its exact head SHA:

- [Checks and release 37362077818](https://github.com/link-assistant/hive-mind/actions/runs/37362077818).
- [Security 37362077403](https://github.com/link-assistant/hive-mind/actions/runs/37362077403).
- [Broken Link Checker 37362077410](https://github.com/link-assistant/hive-mind/actions/runs/37362077410).

The pushed PR diff was reviewed, including all code, tests, release metadata and documentation. Archived evidence was reviewed during collection and scanned explicitly for secrets. Supported effort behavior, token-budget precedence, dynamic model discovery, delegation bounds and organization planning restrictions remain covered. The latest paginated review comments, conversation comments and reviews contain no additional requests.

Security attempt 1 passed dependency review and both CodeQL jobs, but the audit job was cancelled at 19:30:19 UTC without acquiring a runner (`runner_id=0`, zero steps). Its check annotation says: `The job was not acquired by Runner of type hosted even after multiple attempts` (`data/ci-audit-111938841270-annotations.json`, line 1). The log download retained the successful jobs, then reported `log not found: 111938841270`; no npm audit command ran. Run/job metadata and the unavailable-log response are retained. Only that job was rerun using `gh run rerun 37362077403 --job 111938841270`.

Docker verification was cancelled at 19:34:05 UTC for the same hosted-runner acquisition error, also with `runner_id=0` and zero steps (`data/ci-docker-111940322063-annotations.json`, line 1). The queued `Pipeline Status` job kept the workflow open and blocked retries with HTTP 403, `The workflow run containing this job is already running`. Normal cancellation left that `always()` job queued; the [documented force-cancel endpoint](https://docs.github.com/en/rest/actions/workflow-runs#force-cancel-a-workflow-run) closed the attempt so Docker and its dependent status job could be rerun. Passed source checks and test results were retained; no workflow timeout or enforcement was relaxed. The downloaded attempt-1 log contains the successful jobs and ends at line 32009 with `log not found: 111940322063`.

The separately downloaded completed test-job log confirms all 547 default-suite files passed at 19:25:40 UTC (line 18112) and the one GitHub integration test file passed at 19:26:30 UTC (line 18170). These exact summary lines are retained in `data/ci-test-summaries.log`; the full log remains in `ci-logs/test-suites-37362077818.log`. The link checker examined 1,623 links and reported zero errors.

GitHub's [Actions incident on 2026-10-05](https://www.githubstatus.com/incidents/3q1yb5m7ltvb) began at 19:11:58 UTC, before the implementation push. Its 19:15:17 update reports delays assigning hosted runners across configurations. The status snapshot is retained in `data/github-actions-status.json`. This is consistent with both zero-step acquisition failures; it does not establish a source/test failure or justify changing test timeouts.

The first audit retry (Security attempt 2) also ended before acquiring a runner at 19:46:58 UTC, with zero steps and the same annotation (`data/ci-audit-111944836278-annotations.json`). Its metadata and log-download response are preserved. Further audit retries wait for service recovery rather than changing the audit or its timeout.

The first Docker retry likewise ended at 19:54:05 UTC with `runner_id=0`, zero steps and the same acquisition annotation (`data/ci-docker-111947201146-annotations.json`). Its direct job-log request returned HTTP 404 `BlobNotFound`, consistent with no steps having executed. The dependent `Pipeline Status` job acquired a runner and passed at 19:59:48 UTC; Docker's cancellation leaves the workflow failing. The attempt-2 workflow log download ends at line 306 with `log not found: 111947201146`. GitHub's 19:50:50 incident update still reports hosted-runner assignment delays. Passing implementation results are preserved.

The complete planning-stage local rerun passed all 547 selected files at 20:21 UTC. The connection-budget regression was added after that run began and passed separately against the corrected command. Lint, formatting, duplication, secrets (including archived evidence), documentation, syntax, line limits, release metadata and dependency freshness also pass after final review. The committed-source full-suite run and fresh CI below verify both review fixes together.

## Final source verification

Follow-up commit `220b0009b17d8bd3386a13917e90184f2cb8cbcb` preserves the planning ceiling and connection rollout cap. It was committed at 20:22:39 UTC, pushed only to the prepared branch, and includes the failing/passing review regressions. The further complete local default-suite run finished at 20:42 UTC with all 547 selected files passing and exit code 0. No source or test file changed during that run. Its summary is recorded in `data/review-validation.log`; the full log remains in `ci-logs/issue-2526-tests-final-head.log`.

All three fresh workflows were created at 20:22:56 UTC, after the commit, and reference its exact SHA:

- [Checks and release 37369373277](https://github.com/link-assistant/hive-mind/actions/runs/37369373277).
- [Security 37369373033](https://github.com/link-assistant/hive-mind/actions/runs/37369373033).
- [Broken Link Checker 37369373006](https://github.com/link-assistant/hive-mind/actions/runs/37369373006).

Their first attempts cancelled all seven initial jobs at 20:37:58–59 UTC without acquiring a runner or executing steps. Every annotation reports the same hosted-runner acquisition failure, preserved in `data/ci-runner-failures-220b0009.json`. Each workflow-log download returned `log not found` for its first cancelled job, at line 1 of the retained responses. The dependent Pipeline Status job acquired a runner and passed at 20:38:48 UTC; the workflows still concluded failure due to the cancellations. No implementation check failed after executing a step.

GitHub's 20:39:27 incident update continues to report job failures and delays assigning hosted runners. After observing a newly assigned runner, all three workflows were rerun at 20:40 UTC. None of the new source checks had completed in their first attempts, so these retries do not discard passing implementation results.

In attempt 2, Dependency Review acquired a runner and passed at 20:41:42 UTC. The other six initial jobs cancelled at 20:55:20–23 UTC with `runner_id=0`, zero steps and the same acquisition annotation. The dependent Pipeline Status job also cancelled at 21:10:24 UTC without acquiring a runner. Complete metadata and annotations for all seven cancellations are retained in `data/ci-runner-failures-220b0009-attempt-2.json`. All three completed workflow-log downloads again returned `log not found` at line 1; their failed-run metadata and responses are retained. GitHub's 20:47:22 update reports degraded Actions availability, and its status summary marks Actions as a major outage. The 21:09:15 update confirms that hosted-runner problems continued. Further retries waited for a clearer recovery signal.

GitHub's 21:32:31 update reports applied mitigations, clearing queues and new jobs no longer delayed. All three workflows were rerun with `--failed` at 21:32 UTC, preserving the successful Dependency Review. These attempts acquired runners; change detection and release preflight passed by 21:33 UTC. Remaining implementation checks then started against the unchanged final source SHA.

Broken Link Checker attempt 3 completed successfully, checking 1,624 links with zero errors at 21:33:37 UTC. Security attempt 3 completed successfully at 21:38:31 UTC: both CodeQL analyses passed, Dependency Review's prior passing result was retained, and the audit executed at 21:38:29 UTC and reported zero vulnerabilities. Completed-run metadata and exact link/audit summary lines are retained under `data/ci-*-attempt-3.json` and `data/ci-final-{link,security}-summary.log`. At that point, Checks was still running its test suite and Docker verification.

The final-source test job completed successfully at 21:45:43 UTC. Its separately downloaded log confirms all 547 default-suite files passed at 21:41:19 UTC (line 18116) and the one GitHub integration test file passed at 21:45:38 UTC (line 18174). Exact summary lines are retained in `data/ci-final-test-summaries.log`; the full 18,242-line log remains in `ci-logs/test-suites-37369373277-attempt-3.log`.

Docker verification completed successfully at 21:55:35 UTC. Both images built, and system/development tools, runtime versions, Hive Mind startup and nested Docker checks passed. Exact summary lines are retained in `data/ci-final-docker-summary.log`, with complete job metadata in `data/ci-final-docker-job.json`; the full 3,351-line job log remains in `ci-logs/docker-111987863636-completed.log`. Pipeline Status passed at 21:56:06 UTC, completing Checks successfully. All three implementation workflows concluded success against the exact final source SHA. The complete Checks log contains 54,057 lines and remains in `ci-logs/workflow-37369373277-attempt-3.log`; its completed-run metadata is retained alongside Security and link checking.

GitHub reported Actions operating normally at 21:54:23 UTC. The retained incident snapshot includes that recovery update and the earlier outage history; the broader incident still covered other services. No workflow enforcement or test timeout was relaxed to obtain these passing results.

The final evidence update changes documentation only. Source and tests remain identical to the commit that passed all local and implementation CI checks. The fetched default branch remains an ancestor, the implementation diff has been reviewed, and archived evidence is scanned explicitly with secretlint's ignore file disabled before publication.

## Dependency release during final verification

The evidence-only commit `d108c2da30ccd146fbbca945026e6b8b2c8db3a2` was pushed at 22:06 UTC. Its link checking passed, and Security passed. Checks failed before change detection because `command-stream@1.5.0` had been published at 21:43:51 UTC, after the preceding run's dependency check. At lines 2494–2496 of `ci-logs/checks-37380307025-attempt-1.log`, the mandatory freshness gate reports 167/168 current declarations and the runtime pin `1.4.0 -> 1.5.0`. The exact lines, failed-run metadata and registry publication timestamp are retained under `data/`.

The local freshness check reproduces the same failure in `data/freshness-1.5.0-before.log`. Updating the existing expected-pin regression first fails with actual `command-stream@1.4.0`, expected `command-stream@1.5.0`; `data/command-stream-1.5.0-before.log` retains that assertion. The maintenance follow-up updates the runtime pin and its existing alias/preinstall fixtures; reasoning behavior is unchanged. All applicable checks and the full suite were rerun against this source update; the passing results follow.

The complete local default suite against `dec195ea544b588bd9384dc793149f63057d0a69` finished at 2026-10-05T22:27:22.489225+00:00 with all 547 selected files passing and exit code 0. Source and tests remained unchanged during the run. The existing retry and preinstall suites pass 43/43 and 8/8 respectively, dependency freshness is 168/168, and all source/documentation static checks pass. `data/dependency-followup-local-validation.log` retains the compact results; the full log remains in `ci-logs/issue-2526-tests-command-stream-1.5.0.log`.

Fresh workflows were created at 22:13:39 UTC, after that source commit at 22:13:24 UTC, and all reference its exact SHA. Security and link checking passed. The complete CI test job passed all 547 default-suite files at 22:23:30 UTC (line 18120 of its separately downloaded log), followed by the one GitHub integration test file at 22:24:20 UTC (line 18178). Successful metadata and exact summaries are retained in `data/ci-dependency-followup-*.json` and `data/ci-dependency-followup-summaries.log`; the full log remains in `ci-logs/test-suites-37381079901-command-stream-head.log`. Docker verification was still running when these results were collected.

Docker completed successfully at 22:32:39 UTC. Both images built and passed system/development tools, runtime-version, Hive Mind startup and nested-container verification; line 3075 of its 3,110-line log records the complete verification success. Pipeline Status passed at 22:33:15 UTC, completing Checks successfully. All three workflows are green against the exact maintenance source SHA: [Checks](https://github.com/link-assistant/hive-mind/actions/runs/37381079901), [Security](https://github.com/link-assistant/hive-mind/actions/runs/37381079552), and [link checking](https://github.com/link-assistant/hive-mind/actions/runs/37381079578). Completed metadata and exact summaries are retained under `data/ci-dependency-followup-*`; the full 53,894-line Checks log remains in `ci-logs/checks-37381079901-command-stream-head.log`.

Before the final evidence commit, a further freshness check encountered GitHub's unauthenticated API limit (HTTP 403 for eight tag lookups, zero stale declarations). Repeating with the existing authenticated CLI credentials passed 168/168 declarations. No dependency rule, workflow condition or timeout was changed. The freshly fetched default branch remains an ancestor of the prepared branch. The final follow-up changes documentation/evidence only, preserving the source and tests that passed the complete local and CI suites. Latest checks are linked from the PR description.
