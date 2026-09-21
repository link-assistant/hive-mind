# Issue 2281 investigation and solution

## Executive result

The audit found two current failures and no hidden repository-owned warning/error:

1. Pull request 2282 initially failed because the exact-version freshness gate found three declarations behind the registry: `@sentry/node` and `@sentry/profiling-node` 10.75.0 → 10.75.1, and `jscpd` 5.3.0 → 5.3.1.
2. Main run 35587213311 failed because PR 2280 replaced the working built-in release token with a mandatory `RELEASE_PULL_REQUEST_TOKEN`. The secret was absent by design. A direct push was correctly rejected by the Main ruleset; the helper then aborted before creating the fallback PR.

The fix refreshes all three dependencies and restores `GITHUB_TOKEN` without weakening the ruleset. The release/instant-release job now:

1. waits for every pre-release validation job;
2. generates the version commit;
3. refuses to continue if that commit contains anything except version metadata, the lockfile, changelog, and consumed changesets, which proves the source tree is exactly the source tree already validated by the parent workflow;
4. opens an auditable pull request with the existing short-lived token;
5. creates the ruleset-required `Pipeline Status` check on the exact version SHA through the GitHub Checks API;
6. waits for GitHub to report the required check as passed, then merges.

Ordinary PRs still run the complete workflow matrix. Direct bot pushes remain forbidden. Check publication failure, required-check failure, an unexpected generated source change, or merge-policy failure all stop the release.

## Evidence scope and method

The investigation captured:

- the full issue and all comments/timeline events;
- the PR and all conversation comments, inline review comments, reviews, events, and its initial diff;
- full logs, job/step metadata, and 122 annotation API responses for the five cited workflows, the initial PR workflows, the last green release, and the immediately following release;
- current Actions settings, named secrets/variables (never values), environments, branch protection, and complete rulesets;
- related issues 2274/2279, PRs 2250/2275/2280, and template issue 192/PR 195, including all three PR feedback channels;
- the current template head (`f2cd4d8623557241fa4127a57a77461751a2f734`), full file tree, history, release workflow, and complete `.github`/`scripts` diffs;
- official GitHub and Changesets documentation and related upstream discussions;
- a failing pre-fix regression reproduction and passing post-fix tests.

No issue or PR image was present, so there was no attachment to download or visually inspect. All timestamps below are UTC.

## Exhaustive requirement inventory

| ID | Requirement | Source | Resolution |
| --- | --- | --- | --- |
| R1 | Download all logs and issue-related data into this evidence directory | Task | Complete; indexed in `README.md` and checksummed at finalization |
| R2 | Read the complete issue, comments, PR feedback, and linked runs | Task | Complete; raw API responses retained |
| R3 | Audit every false positive, false negative, warning, and error | Issue | Complete; annotation and terminal-gate audit below |
| R4 | Find the most recent working release/commit | Maintainer comment | Run 34792591319 at `24568aacc8f55178b8fca2daf4f6d3110938f834` |
| R5 | Do not require `RELEASE_PULL_REQUEST_TOKEN`; use the existing Actions token | Maintainer comment | Mandatory PAT removed from both release modes; `GITHUB_TOKEN` restored |
| R6 | Fix every current causal failure rather than only its terminal symptom | Issue | Release root cause and three dependency declarations fixed; `Pipeline Status` retained because it is accurate |
| R7 | Compare the template's full CI/CD file tree and scripts | Issue | Complete; see `TEMPLATE-COMPARISON.md` and raw tree/diffs |
| R8 | Reuse applicable template and local best practices | Issue | Fail-closed terminal gate, pinned runners, preflight, exact freshness, scoped permissions, and bounded waits preserved |
| R9 | Follow `docs/CI-CD-BEST-PRACTICES.md` | Issue | Applied and added the new release-attestation lesson to all four translations |
| R10 | Report a shared defect to the template project | Issue/task | Reported as [template issue 196](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/196), with reproduction, four workarounds, and a code plan |
| R11 | Research existing components/libraries and alternatives | Task | GitHub Checks API, `gh`, Changesets, `changesets/action`, create-pull-request, PAT/App/bypass options assessed |
| R12 | Reproduce each bug before fixing it | Task | Pre-fix release regression exits 1 on the missing PAT; the downloaded initial PR log reproduces freshness failure exactly |
| R13 | Add automated regression coverage | Task | New issue-2281 test plus corrected 2175/2274/2279 suites cover token choice, call order, failure closure, discovery race, and commit allowlist |
| R14 | Apply the fix everywhere in the codebase | Task | Automated release and instant release, helper/library/entrypoint, tests, four best-practice translations, manifest and lockfile updated |
| R15 | Add opt-in diagnostics only if evidence is insufficient | Task | Not needed: full logs identify both causes. Existing `HIVE_MIND_CI_VERBOSE` tracing remains opt-in/default-off |
| R16 | Preserve repository protection and avoid new secrets | Issue/task | Main ruleset unchanged; job-only `checks: write`; no long-lived credential or bypass |
| R17 | Prepare one complete PR with a release trigger | Issue/task | One PR; patch changeset added; final title/body/checks/ready state handled after verification |
| R18 | Verify against current main, full local CI, remote CI, and final feedback | Task | Recorded in the verification section at finalization |

## Timeline and sequence of events

| Time | Event | Consequence/evidence |
| --- | --- | --- |
| 2026-08-22 17:34 | A Main ruleset begins requiring changes through PRs; no bypass actors | Direct release pushes start receiving GH013. The release helper's PR fallback is introduced in the same period. |
| 2026-09-14 00:24–00:42 | Run 34792591319 on `24568aac` is the last fully successful release | Direct push is rejected; built-in `GITHUB_TOKEN` creates and merges PR 2250; 2.29.0 publishes; pipeline passes. No `Pipeline Status` requirement blocked the PR. |
| 2026-09-14 18:40–18:52 | Run 34882269478 creates/merges PR 2253 with the same built-in token | Version landing still works. npm says 2.29.1 published, but the registry never exposes it; fail-closed verification correctly fails. This is a separate registry incident, not the current protected-PR regression. |
| 2026-09-20 04:28 | Main ruleset is updated with strict required `Pipeline Status`, integration 15368 | Built-in-token release PRs can no longer merge without a check on the PR head. |
| 2026-09-20 18:53 | PR 2275 merges a `workflow_dispatch` validation workaround | Dispatch runs 35530983182/35536619299 pass, but their checks do not satisfy the pull-request ruleset; associated PR runs remain `action_required`. |
| 2026-09-21 08:56 | Template PR 195 merges | Template chooses a mandatory independent PAT/App token and pins Ubuntu 24.04. |
| 2026-09-21 10:09:19 | Hive-mind PR 2280 merges the same mandatory-token design | `RELEASE_PULL_REQUEST_TOKEN` is referenced but not provisioned. |
| 2026-09-21 10:09–10:19 | Main run 35587213311 | All pre-release work passes; version 2.31.0 is generated; GH013 rejects direct push; empty PAT guard aborts; terminal gate correctly reports `release`. |
| 2026-09-21 16:46–16:47 | Issue 2281 and PR 2282 are opened | Maintainer explicitly refuses the new PAT and asks for the last working behavior. |
| 2026-09-21 16:47–16:48 | Initial PR run 35627852498 | Freshness gate finds three stale exact requirements and stops in `detect-changes`; terminal gate correctly propagates it. |
| 2026-09-21 investigation | Ruleset bypass experiment is attempted from an exact snapshot | GitHub returns HTTP 422: the GitHub Actions integration is not eligible as a bypass actor for this repository/owner. Before/after snapshots are identical. |
| 2026-09-21 solution | Check-attested built-in-token fallback implemented | Keeps the PR/ruleset boundary, verifies metadata-only transformation, publishes a required check on the exact head, waits, then merges. |
| 2026-09-21 18:41–19:00 | Source-change SHA `6b8f654d` runs through PR CI | All four workflows pass. The 500-file suite and 16-minute Docker validation pass, and the terminal `Pipeline Status` reports success. |
| 2026-09-21 finalization | PR 2282 title/body are replaced and the draft is promoted | GitHub reports the PR mergeable with a clean merge state; all three PR feedback endpoints remain empty. |

## Run and annotation audit

| Run | Workflow/event | Result | Finding |
| --- | --- | --- | --- |
| 35613200086 | Dependabot dynamic | Success | One GitHub-owned Ubuntu migration notice. Repository workflows already pin `ubuntu-24.04`; not actionable in repository code. |
| 35600475864 | Security/schedule | Success | No annotations and no hidden error. |
| 35587213311 | Checks and release/push | Failure | Real release failure: empty mandatory PAT after GH013. Two terminal annotations are cause + accurate propagation. |
| 35587213044 | Broken Link Checker/push | Success | One normal job-summary notice; no error. |
| 35587213027 | Workflows/push | Success | No annotations and no hidden error. |
| 35627851917 | Security/PR | Success | No annotations and no hidden error. |
| 35627852498 | Checks and release/PR | Failure | Real exact-freshness failure: three declarations. Two terminal annotations are cause + accurate propagation. |
| 34792591319 | Checks and release/push | Success | Last green release; used for working-state comparison. |
| 34882269478 | Checks and release/push | Failure | Separate npm registry non-visibility event; fail-closed behavior is correct and did not cause the current regression. |

The annotation query covered every job in these runs, including skipped jobs. Only eight jobs returned annotations, summarized in `ci-logs/annotation-summary.tsv`. Causal line references are in `ci-logs/key-lines.txt`.

### False-positive / false-negative conclusions

- **No false green:** the initial PR and main release both conclude failure, and `Pipeline Status` names the actual upstream failing job.
- **No false red from the terminal gate:** its error is intentionally duplicative; without it, skipped/cancelled dependency chains can leave a misleading overall result.
- **One obsolete policy assumption:** PR 2280 treated absence of an independent token as a hard configuration error, although the maintainer explicitly will not provide one. That is the release root cause fixed here.
- **No suppressed warning in owned workflows:** the runner migration notice is emitted by GitHub's dynamic Dependabot workflow. The owned runner-image invariant is already enforced by `tests/ci-runner-image-2279.test.mjs`.
- **No hidden stale dependencies after update:** the freshness script reports 148/148 current.
- **Historical npm failure is a true negative:** publish output alone was not trusted; registry verification caught that the artifact never became readable. Removing that check would introduce a false successful release.

## Root-cause analysis

### P1: protected release PR cannot land

**Immediate cause:** `.github/workflows/release.yml` set `GH_TOKEN` to `secrets.RELEASE_PULL_REQUEST_TOKEN` and passed `RELEASE_PULL_REQUEST_TOKEN_CONFIGURED=false`. The helper deliberately threw before opening a PR.

**Structural cause:** the strict Main ruleset requires both a PR and `Pipeline Status` from GitHub Actions. A PR created by the built-in token does not start unattended child workflows; current GitHub behavior makes those runs approval-required. The earlier dispatch workaround generated successful checks, but checks from that event did not fulfill the PR rule. PR 2280 resolved this by assuming a different actor/token, turning an optional credential into a mandatory release prerequisite.

**Why it appeared recently:** run 34792591319 proves that the same built-in token successfully created and merged PR 2250 before the required status check was added. Ruleset update time and later dispatch/PAT changes explain the transition; the token itself did not stop authenticating.

**Selected fix:** use the parent release run as the source of validation, with these invariants:

- both release modes depend on the complete pre-release validation graph;
- the generated commit is fail-closed unless every changed path is release metadata, so its source is identical to the tested parent source;
- only the release jobs receive `checks: write`;
- `GITHUB_TOKEN`, an installation token for the GitHub Actions App, creates the completed successful check on the exact version SHA;
- `gh pr checks --required --watch --fail-fast` observes GitHub's rule before merge;
- any Checks API, required-check, or merge error aborts publication.

### P2: initial PR freshness failure

**Immediate cause:** the registry had patch releases newer than three exact declarations. The gate intentionally interprets semver ranges as exact policy pins.

**Fix:** update `@sentry/node` and `@sentry/profiling-node` to `^10.75.1`, `jscpd` to `^5.3.1`, and regenerate `package-lock.json`. This is applied to every matching root declaration; the repository has one package manifest.

### P3: apparent duplicate Pipeline Status failures

**Cause:** the terminal job emits its own failing annotation after reading `needs`. This is required to turn upstream failures/cancellations into one stable required context.

**Action:** retain it. Both examined failures identify the exact causal job. Changing it would risk false-positive green runs and violate local/template best practice.

### P4: Dependabot runner notice

**Cause:** GitHub's dynamically generated dependency-update workflow controls that job. It is not sourced from `.github/workflows` in this repository.

**Action:** none in owned code. All owned runner labels are pinned and a regression test prevents `ubuntu-latest` from returning.

### P5: historical npm 2.29.1 incident

**Cause:** Changesets reported success but repeated public registry reads returned E404 through the entire bounded visibility window.

**Action:** no change in this PR. The pipeline correctly refused a false successful publish. The run is relevant only because it immediately follows the last fully green release; it is not evidence that the built-in token failed to create/merge a version PR.

## Solution alternatives

| Option | Advantages | Problems | Decision |
| --- | --- | --- | --- |
| Mandatory fine-grained PAT | Ordinary PR workflow runs; familiar template design | Explicitly refused, long-lived credential, rotation/scope burden, current production failure | Rejected |
| Custom GitHub App installation token | Short-lived independent identity; ordinary PR runs | Requires a new installed/configured app and private-key flow | Valid future option, not required |
| Human approval of bot-created PR workflows | Native current GitHub behavior | Makes unattended releases wait for a person | Rejected for automation |
| `workflow_dispatch` validation | Uses built-in token and existing workflow | Proven checks are not eligible for the PR required-check rule | Rejected by production experiments |
| Ruleset bypass for Actions | Simple direct push or merge | Weakens protection; exact API attempt returned HTTP 422; no eligible actor | Rejected and not applied |
| Remove required check | Releases become easy | Reintroduces false greens and violates issue intent | Rejected |
| Parent-run check attestation on constrained commit | Existing short-lived token; ruleset and auditable PR retained; no human/secret | Must prove exact commit did not introduce untested source | Selected with metadata-only allowlist and fail-closed tests |

## Debugging and observability decision

No new debug mode was necessary because downloaded logs, check annotations, ruleset state, secret names, and history establish both root causes directly. The release command stack already supports `HIVE_MIND_CI_VERBOSE`; it is disabled unless explicitly enabled. Failure messages continue to include the exact command and stderr, and the release PR URL is emitted as an output.

## Verification

### Reproduction

- `research/reproducer-before.log.gz`: the issue-2281 regression test fails against the pre-fix helper because `RELEASE_PULL_REQUEST_TOKEN` is missing; exit code is recorded separately as 1.
- `ci-logs/run-35627852498.log.gz`: the real pre-fix freshness gate reports 145/148 current and names all three stale requirements.

### Focused checks

`tests/targeted-release-tests.log.gz` covers:

- built-in-token PR/check/watch/merge order;
- required-check discovery race;
- failure closure when check publication or validation fails;
- unexpected source path rejection;
- prior release fallback, merge retry, race, and cancellation regressions.

### Full local and remote checks

Local verification completed successfully:

- dependency freshness: 148/148 current;
- all 500 default-suite test files on the corrected run (the preserved first attempt reproduces the stale dependency-pin assertion before it was updated);
- the GitHub integration suite: 4/4 assertions, with its intentionally preserved review repository at <https://github.com/konard/test-feedback-lines-59a6c6cb>;
- formatting, ESLint, duplication, secret scan, package-manager declaration, all-module syntax, file-line limits, and `git diff --check`;
- execution smoke tests, memory checks, documentation validation and translation parity, Docker release-order contract, Helm chart structure, and the high-severity lockfile audit.

Command output is retained under `tests/`. The implementation/evidence source SHA was `6b8f654d2027f177be17b981d96a5a8ac574c2ca`; current `origin/main` (`3439a922e42050b62502731fd4cf8f4f40030b46`) was already its ancestor, so no merge commit was necessary.

| Remote workflow | Run | Source SHA | Conclusion |
| --- | --- | --- | --- |
| Broken Link Checker | [35639984495](https://github.com/link-assistant/hive-mind/actions/runs/35639984495) | `6b8f654d2027f177be17b981d96a5a8ac574c2ca` | Success |
| Security | [35639984585](https://github.com/link-assistant/hive-mind/actions/runs/35639984585) | `6b8f654d2027f177be17b981d96a5a8ac574c2ca` | Success |
| Workflows | [35639984627](https://github.com/link-assistant/hive-mind/actions/runs/35639984627) | `6b8f654d2027f177be17b981d96a5a8ac574c2ca` | Success |
| Checks and release | [35639985079](https://github.com/link-assistant/hive-mind/actions/runs/35639985079) | `6b8f654d2027f177be17b981d96a5a8ac574c2ca` | Success |

The final feedback refresh found zero conversation comments, zero inline review comments, and zero reviews. The PR diff was reread after CI; no requested feature was removed and no unrelated behavior change was found. GitHub reported `MERGEABLE` / `CLEAN`, and PR 2282 was marked ready for review. The complete first-push logs and job metadata are in `ci-logs/`; the evidence-only final commit is verified separately at handoff so recording its run IDs cannot create an infinite commit/CI loop.

## Residual risk and operational proof

The Checks API behavior and token type are documented by GitHub, and static/unit tests validate permissions and order. The release fallback itself executes only on a main push that produces a version bump, so pull-request CI cannot safely create a real throwaway release PR in the protected repository. The next genuine version release is therefore the final production integration proof. If check creation is denied or the ruleset does not recognize it, the implementation fails before merge or publish and emits the exact API error; it cannot report a successful release.
