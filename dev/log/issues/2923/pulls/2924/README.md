# Issue #2923: false positives, false negatives, warnings and errors in CI/CD on `main`

Evidence for [issue #2923](https://github.com/link-assistant/hive-mind/issues/2923) and [PR #2924](https://github.com/link-assistant/hive-mind/pull/2924), collected on 2026-10-09.

## Contents of this folder

| Path | What it is |
| --- | --- |
| `ci-logs/run-<id>.{json,log}` | Full logs and metadata of the eight runs named in the issue, fetched from the jobs API (`gh run view --log` truncates) |
| `ci-logs/job-113917959783-formal-ai-draft.log` | The Formal AI Draft job of run 37959364207 |
| `ci-logs/related/run-37723257263-failed.log` | The earlier release of 2.34.1 that failed the same way as 2.35.1 |
| `ci-logs/related/run-36914477944-failed.log` | A Docker build that got a 404 on the 2.33.4 tarball after the version metadata was already visible (issue #2404, already fixed) |
| `ci-logs/related/run-37603921340-failed.log` | The dependency-freshness failure on push, fixed in #2625 |
| `codeql/open-alerts-main.tsv`, `codeql/open-alerts-shipped.tsv` | Open code-scanning alerts on `main` on 2026-10-09: all 120 (path, rule), and the 31 in shipped code (alert, location, rule, created) |
| `npm-publish-lag.txt` | Output of `experiments/npm-publish-lag-2923.mjs` for the last 80 versions: npm's publish lag per version |

Presigned S3 parameters (`X-Amz-*`) in the logs are redacted. The only token-like strings left are the names of the token-masking self-test cases in run 37983302098.

## Timeline (UTC)

| When | What happened |
| --- | --- |
| up to 2026-09-14 00:33 | npm exposes a published version 2 to 9 s after the provenance is signed (`npm-publish-lag.txt`, versions 2.11.0 to 2.29.0). |
| 2026-09-14 18:50 | From 2.29.1 on, the lag jumps to 99 to 377 s (p90 314 s). The post-publish check waited 330 s in total (15 checks), so it was now running close to the limit. |
| 2026-10-01 19:46 | Docker Publish (arm64) of 2.33.4 gets `GET .../hive-mind-2.33.4.tgz - 404` three minutes after `wait-for-npm` saw the version metadata (run 36914477944). The fix for #2404 (wait for the tarball too) already covers this. |
| 2026-10-08 03:47 | Release of 2.34.1 (run 37723257263) publishes. npm exposes the version 377 s later, but verification gives up at 03:52:56, after about 336 s. The job fails, and the GitHub release, Docker images and Helm chart are skipped. |
| 2026-10-09 11:33 | Cleanup Test Repositories (run 37920580820) is green with one warning: 364 fixture branches retained by ruleset 21204104. This is the intended report from #2625 (see H). |
| 2026-10-09 16:36 | Formal AI Draft (run 37959364207, for PR #2918) starts with "Let me open e.g and read what it says." and then logs `ℹ️ Agent recovered from earlier error and completed successfully` followed by `❌ Agent reported error: Error: File not found: …/e.g` for the same error. The run fails. |
| 2026-10-09 21:03:19 | Release of 2.35.1 (run 37983302098) signs the provenance. At 21:03:22 the log says `Successfully published`. |
| 2026-10-09 21:03:23 to 21:08:57 | Verification checks 15 times (`not visible yet (check 1 of 15)` … `(check 14 of 15)`), then logs `ERROR: post-publish verification failed: … never appeared on npm`. |
| ~2026-10-09 21:17:53 | npm records the publish attestation for 2.35.1: 874 s after the provenance. |
| 2026-10-09 21:17:12 | Pipeline Status reports `Pipeline failed. Failing jobs: release`. No GitHub release, Docker images or Helm chart are produced for 2.35.1. |
| 2026-10-09 21:20 | The E2E Hello World Matrix (run 37992515531), triggered by the failed release, is green but tests nothing. Its only explanation is `Matrix skips: latest Formal AI v0.352.1, last successful matrix not recorded`. |
| 2026-10-09 21:26 | Issue #2923 is filed. |

## Requirements

1. Fix the failing Checks and release run 37983302098.
2. Fix the failing Formal AI Draft run 37959364207.
3. Find every false positive, false negative, warning and error, including in the green runs (E2E 37992515531, Security 37983302211, Links 37983302170, Dependabot 37945526900, Cleanup 37920580820, Workflows 37648247059).
4. Compare all workflow and CI/CD script files with the JS and Python templates, and report shared problems to the templates.
5. Follow `docs/CI-CD-BEST-PRACTICES.md`.
6. Collect the evidence here, reconstruct the timeline, find the root causes, propose solutions, look for existing components, add off-by-default debug output where the data is insufficient, and report upstream problems with a repro, a workaround and a suggested fix.
7. Apply each fix everywhere the same problem exists.

## Root causes and fixes

### A. Checks and release: a successful publish reported as failed (requirement 1)

- **Root cause.** npm accepts a publish, but the version only becomes readable through `npm view` minutes later. `npm-publish-lag.txt` measures this as the time between the SLSA provenance (signed on the runner just before upload) and npm's own publish attestation (signed when the registry accepts the version). Since 2026-09-14 the lag has been 99 to 377 s, and 874 s for 2.35.1. Verification gave up after 330 s, so a successful release failed, and every job gated on `published == 'true'` was skipped. 2.34.1 failed the same way.
- **Fix (`d565998e`).**
  - Verification now waits about 1500 s (54 checks with exponential backoff capped at 30 s), which is 1.7 times the slowest lag observed.
  - The `release` and `instant-release` jobs time out at 45 minutes instead of 30, so the job timeout can't cut the wait short.
  - `E409 Cannot publish over previously staged version "<ours>"` means the version has already landed. It is verified, not retried (same as template #158).
  - Each registry probe is quiet by default. Setting `HIVE_MIND_PUBLISH_VERBOSE=true` prints npm's 404 output. On success the log reports how long npm took (`check N of 54, after ~Ns`), so the next lag regression is visible without digging.
- **Test.** `tests/publish-verification-window-2923.test.mjs` replays the 874 s lag on a simulated clock. The old window fails and the new one passes, with exactly one publish. It also checks E409 staged handling, quiet probes, and that both job timeouts exceed the window.
- **Not changed.** `scripts/wait-for-npm.mjs` (Docker and Helm) waits 300 s for the metadata and the tarball. That is enough, because these jobs only start after `release` has verified the version.

### B. Versions on npm without a GitHub release are never repaired (requirement 1, 7)

- **Root cause.** `check-release-needed` asked only npm, "is this version published?". 2.34.1 and 2.35.1 are on npm, so the gate reported "nothing to release" forever, and their GitHub release, Docker images and Helm chart were never built. This is the same defect as template #211.
- **Fix (`f7ab1053`).** The gate also asks GitHub for the `v<version>` release. If the version is on npm but the release is missing, it runs the release again with `skip_bump` (a self-healing release). If GitHub can't be asked (any answer other than 200 or 404), the gate logs a warning and does not release.
- **Test.** `tests/release-self-heal-github-release-2923.test.mjs`. The `tests/check-release-needed-2175.test.mjs` suite still passes. A live lookup returns `true` for 2.35.0 and `false` for 2.35.1.

### C. Formal AI Draft: a true positive with a contradictory log (requirement 2)

- **Root cause of the failure.** Formal AI's agentic read treats the abbreviation "e.g." as a file name. Every Hive Mind draft starts with "Let me open e.g and read what it says." and ends with `File not found: …/e.g`. This is reported as [link-assistant/formal-ai#1189](https://github.com/link-assistant/formal-ai/issues/1189), which is still open. The red run is correct: the draft did fail.
- **Root cause of the log.** Exit code 0 plus a completion event clears a streaming error (#1276). Hive Mind then printed "recovered … completed successfully" even when the error record in the output still failed the run (#1201). The log contradicted itself.
- **Fix (`21ae67aa`, `00c82984`).** `resolveStreamingErrorRecovery` in `src/agent-command.lib.mjs` decides both whether to clear the error and which message to log. When the output error still fails the run, it says so instead of claiming a recovery. The helper lives outside `src/agent.lib.mjs` so that file stays under the 1350-line warning (#1593).
- **Test.** `tests/agent-recovery-message-2923.test.mjs` uses the error record from run 37959364207. `tests/test-agent-error-detection.mjs` still passes.

### D. E2E Hello World Matrix: green, but nothing tested (requirement 3)

- **Root cause.** The matrix is triggered by Checks and release. When that run failed, every model row was skipped, and the only explanation was `last successful matrix not recorded`. That is a false positive: a green run that tested nothing, with no visible reason.
- **Fix (`c5712c19`).** `scripts/e2e-matrix-schedule.mjs` names the triggering run and its conclusion, and emits `::notice title=E2E matrix skipped::<reason>` so the reason shows in the run summary.
- **Test.** `tests/e2e-matrix-schedule-2324.test.mjs`.

### E. Formal AI Draft: Hive Mind's own server reported as a leftover (requirement 3)

- **Root cause.** After the session, the verbose survivor check (#2395) warned `1 process(es) still running … pid 1833: formal-ai serve --agent-mode …`. That server is Hive Mind's task-owned Formal AI runtime. It is cached for later sessions and stopped at exit by `stopFormalAiRuntimes` (`src/exit-handler.lib.mjs`), so the warning was a false positive that would hide a real leftover.
- **Fix (`1d30bff1`).** `src/formal-ai-runtime.lib.mjs` marks the server it starts with `keepProcessAcrossSessions` and releases the mark when it stops the server. `src/session-survivors.lib.mjs` logs marked processes as a verbose `kept on purpose` line and still warns about everything else.
- **Test.** `tests/session-survivors-kept-2923.test.mjs`. `tests/session-survivors-2395.test.mjs` and the Formal AI runtime suites still pass.

### F. Security: CodeQL alerts in code that is never shipped (requirement 3, 7)

- **Root cause.** The Security run is green, but 120 code-scanning alerts were open on `main` (`codeql/open-alerts-main.tsv`). 55 of them were in code this project never ships or runs: 48 in `experiments/` and 7 in `docs/`. The `docs/` ones are third-party copies such as `docs/case-studies/issue-1724/data/use-m-source.js` and a saved GitHub page, `docs/case-studies/issue-1752/external/git-push.html`. `.github/codeql/codeql-config.yml` excluded only `dev/log`. This PR's own experiment added two more alerts (286 and 287, `pkg.replace('/', '%2f')` replaces only the first `/`). JS template #211 reported the same scope problem.
- **Fix.** `paths-ignore` now also lists `experiments`, `examples` and `docs`. Nothing in them is shipped (`package.json` `files` is `src` and `*.md`) or executed by a workflow, and `scripts/detect-code-changes.mjs` already treats `docs/` and `experiments/` as non-code. `experiments/npm-publish-lag-2923.mjs` now encodes the whole package name.
- **Test.** `tests/codeql-config-scope-2923.test.mjs` fails on the old config. It also checks that `src`, `scripts`, `tests`, `.github` and `eslint-rules` stay scanned and that every CodeQL init step uses the config.
- **Not changed here.** The 31 alerts in shipped code (`codeql/open-alerts-shipped.tsv`) are a backlog from when CodeQL was enabled on 2026-08-11. Only one of them is newer (2026-09-14). They don't fail CI, and none was raised by the runs in this issue. Most of them are hand-written escaping in `src/claude.lib.mjs`, `src/review.mjs` and the Telegram Markdown helpers that doesn't escape backslashes. Some of that escaping builds command-stream command lines, and command-stream quotes interpolated values itself. A fix there changes how every prompt reaches the agent, so it needs its own issue with end-to-end tests.

### G. Best practices (requirement 5)

- **Change (`1ace5886`).** Four lessons are added to `docs/CI-CD-BEST-PRACTICES.md` and to its `.ru`, `.zh` and `.hi` versions:
  - Principle 9, "Wait for the registry as long as it really takes, and never republish to find out".
  - Principle 9, "Decide 'is there anything to release?' from every artifact, not just the registry".
  - Principle 17, "Say why a job skipped".
  - Principle 17, "One outcome, one message".
- **Test.** `tests/cicd-best-practices-registry-lag-2923.test.mjs`.

### H. Release notes

`.changeset/npm-lag-release-false-negative.md` (patch).

### I. Other findings that need no code change

| Finding | Run | Classification |
| --- | --- | --- |
| `364 fixture branch(es) retained by a repository rule that prohibits deletion` | Cleanup 37920580820 | True positive by design (#2625). Ruleset 21204104 `no-destruction-possible` (`~ALL`, `deletion`, no bypass, last changed 2026-08-22) still forbids deletion. A dry run on 2026-10-07 counted 190. Remedy for the owner: exclude `refs/heads/e2e/**` and the `issue-*` fixture pattern in `conditions.ref_name.exclude`, or give the cleanup token a bypass. |
| Gist upload `403 Resource not accessible by integration`, so `--attach-logs` posts no log | Formal AI Draft 37959364207 | Expected in the `default` credential layer: `AUTOMATION_TOKEN` and the automation App are not configured, and `github.token` cannot create gists. The run says so once and does not retry (#2625). The full session log is kept as artifact `formal-ai-draft-session-2917` (90,676 bytes). Remedy for the owner: configure `AUTOMATION_TOKEN` or the App. |
| Security, Broken Link Checker, Dependabot, Workflows | 37983302211, 37983302170, 37945526900, 37648247059 | Green, with no warnings that point at a defect. |

## Template comparison (requirement 4)

| Defect | Hive Mind before | JS template | Python template | Action |
| --- | --- | --- | --- | --- |
| E409 "previously staged version" treated as failure | Partly: only "previously published" matched | Fixed (#158) | Not applicable (PyPI; `twine --skip-existing`) | Ported (A) |
| Verification shorter than npm's lag | 330 s | 930 s verify, 920 s `wait-for-npm`; 56 s (6 %) margin over the 874 s lag | 600 s PyPI wait | Hive Mind: 1500 s. Reported to the JS template: [#221](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/221) |
| Verification before npm's cache horizon | Covered by the longer window | Fixed (#197) | Not applicable | None |
| Release gate checks only the registry | Yes | Fixed (#211) | Checks the GitHub release too | Ported (B) |
| CodeQL scans `experiments/` | Yes, plus third-party copies in `docs/` | Fixed (#211): `experiments`, `examples` ignored | Fixed: `experiments` ignored | Ported and extended (F) |

[Template #221](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/221) includes a repro: a `curl` script that prints `lag: 874 s` from npm's attestation API, plus a simulation that prints `false 930000` for the template's own loop. It also gives the workaround (raise `NPM_VERIFY_ATTEMPTS` or the delay cap) and a suggested fix (a window of at least 1.5 times the measured maximum, and job timeouts sized to match).

## Existing components

- **npm attestation API.** `https://registry.npmjs.org/-/npm/v1/attestations/<pkg>@<version>` is the only public source we found for when npm actually accepted a version. `experiments/npm-publish-lag-2923.mjs` is built on it.
- **Publishing tools.** `changeset publish` and `npm publish` don't wait for the version to become readable. `semantic-release` doesn't either. Waiting is left to the caller, as in this repository and in the templates.
- **Retry helpers.** `p-retry` and similar libraries offer the same capped backoff. The existing loop in `scripts/publish-to-npm.mjs` is injectable and tested, so it is kept.

## How to reproduce

```bash
node experiments/npm-publish-lag-2923.mjs @link-assistant/hive-mind 80   # lag per version
node --test tests/publish-verification-window-2923.test.mjs               # 330 s window vs 874 s lag
node --test tests/release-self-heal-github-release-2923.test.mjs
node --test tests/agent-recovery-message-2923.test.mjs
node --test tests/codeql-config-scope-2923.test.mjs
```

## Remaining limits

- **2.34.1 and 2.35.1 still have no GitHub release, Docker images or Helm chart.** This PR's changeset releases 2.35.2 with all its artifacts, and 2.35.2 supersedes both. The self-healing gate only looks at the version on `main`, so it won't backfill the older two.
  - Re-running the failed `release` job of run 37983302098 rebuilds 2.35.1 only while `main` is still at d1fa7c7 (2.35.1). The re-run checks out fdff413, `version-and-commit` rebases it onto `main`, and the publish then hits "already published", is verified, and lets the gated jobs run. Once this PR is merged, `main` has moved on and the re-run no longer targets 2.35.1. This path was traced through the code and the run log, but not executed.
  - `gh release create v2.35.1 --target d1fa7c70` adds just the GitHub release.
  - Neither was done here, because both act on the production release.
- **The npm lag can grow again.** The log now reports the observed lag for every release, and `experiments/npm-publish-lag-2923.mjs` reproduces the measurement. If the lag approaches 1500 s, raise `DEFAULT_VERIFY_ATTEMPTS` in `scripts/publish-to-npm.mjs` together with the job timeouts. The workflow test enforces that the timeouts stay at least 10 minutes above the window.
- **The Formal AI Draft stays red** until formal-ai#1189 is fixed. That is the correct outcome.
