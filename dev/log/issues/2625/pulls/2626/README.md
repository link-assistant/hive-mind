# Issue #2625 — false negatives, warnings and errors in CI/CD on `main`

Evidence for [issue #2625](https://github.com/link-assistant/hive-mind/issues/2625) and [PR #2626](https://github.com/link-assistant/hive-mind/pull/2626), collected on 2026-10-07.

## Contents of this folder

| Path | What it is |
| --- | --- |
| `issue.json` | The issue as filed |
| `runs-*.yml.json` | Recent runs of the four failing workflows (`gh run list`) |
| `ci-logs/run-<id>.{json,log}` | Full logs of the four runs named in the issue, plus the two green ones, fetched from the jobs API (`gh run view --log` truncates) |
| `ci-logs/run-<id>-failed.log` | `--log-failed` of the earlier runs of the same failures |
| `ci-logs/formal-ai-draft/` | Every Formal AI Draft run since the first failure on 2026-10-03. Run 37367087072 was cancelled, and its log is a `BlobNotFound` answer |
| `ruleset-21204104.json`, `rulesets.json` | The branch ruleset that makes the fixture cleanup fail |
| `local/cleanup-dry-run-{before,after}.log` | The cleanup script against the live repository, before and after the fix |
| `local-freshness-before.txt` | The dependency-freshness gate before the dependency bump |
| `upstream/` | OpenCode Zen and Kilo gateway model lists, plus the `@link-assistant/agent` 0.26.11 smoke runs per model |
| `templates/` | The failing `main` runs of the two CI/CD templates the issue asks to compare against |

Presigned S3 parameters (`X-Amz-*`) in the logs have been redacted. No tokens were found by the secret scan.

## Timeline (UTC)

| When | What happened |
| --- | --- |
| 2026-08-22 17:33 | Ruleset 21204104 `no-destruction-possible` is created. It covers `~ALL` branches with the `deletion` and `non_fast_forward` rules, and no one can bypass it. |
| 2026-10-02 18:37 | The E2E Hello World Matrix starts failing on `main` (run 37048638353). |
| 2026-10-03 09:26 | Cleanup Test Repositories fails for the first time (run 37113071084). Every branch `DELETE` answers HTTP 422 because of the ruleset, and it has failed every day since. |
| 2026-10-03 13:28 | The Formal AI draft health check fails: 25 eligible issues and 0 executed attempts over 7 days (run 37126292445). This is a true positive. Later runs show attempts, so the alert was resolved and needs no fix. |
| 2026-10-04 13:09 | The first Formal AI Draft run on an issue fails (run 37204604042). From here on, every draft: (1) starts with "Let me open e.g and read what it says." and ends with `File not found: …/e.g`; (2) has its checks dispatch refused with `HTTP 422: Required input 'bump_type' not provided`; (3) uploads an empty log artifact (`No files were found with the provided path`). |
| 2026-10-07 05:34 | `command-stream` 2.0.0 has been published, so the dependency-freshness gate fails `detect-changes` on the push to `main` (run 37577002856). Lint, tests, the release, Docker and Helm are all skipped. The same happens in runs 37603761465 and 37603921340. |
| 2026-10-07 10:21 | Formal AI Draft run 37606848542 also shows: gist upload `403 Resource not accessible by integration`, retried after 30 s and 2 min and then again as parts; and `'formal-ai-draft' not found` when the run labels its PR. |
| 2026-10-07 10:35 | Cleanup run 37608433608 is named in the issue. |
| 2026-10-07 11:50 | E2E run 37616874265 is named in the issue. The `agent / nemotron-3-super-free` row fails with `Model "nemotron-3-super-free" not found in provider "opencode"`. Results verification prints an empty reason after `gh api user` answers 403 to the integration token. The three `formal-ai` rows fail on Formal AI's own limits (see E). |
| 2026-10-07 13:29 | Issue #2625 is filed. Formal AI Draft run 37628867214 for this very issue fails in the same way ("Let me open e.g"). |

## Requirements

1. Fix E2E Hello World Matrix run 37616874265.
2. Fix Cleanup Test Repositories run 37608433608.
3. Fix Formal AI Draft run 37606848542.
4. Fix Checks and release run 37603921340.
5. Find every false positive, false negative, warning and error in CI/CD, not only the red runs.
6. Compare all workflow and CI/CD script files with the JS and Python templates, and report shared problems to the templates.
7. Follow `docs/CI-CD-BEST-PRACTICES.md`.
8. Collect the evidence here, reconstruct the timeline, find the root causes, propose solutions, look for existing components, add off-by-default debug output where the data is insufficient, and report upstream problems with a repro, a workaround and a suggested fix.
9. Apply each fix everywhere the same problem exists.

## Root causes and fixes

### A. Checks and release: false negative on push (requirement 4)

- **Root cause.** The dependency-freshness gate (#2264) measures the outside world, not the commit. A release published after a merge failed `detect-changes` on the push to `main`, which skipped everything downstream. The code had already passed the gate on its pull request.
- **Fix.**
  - `44081ee5` bumps `command-stream` to 2.0.0 (Node ≥ 22, which is satisfied) and Sentry to 11.5.0.
  - `9ebc0ce5` keeps the gate blocking on pull requests and warns on every other event, with annotations and a step summary.
- **Test.** `tests/dependency-freshness-main-push-2625.test.mjs`.

### B. Cleanup Test Repositories: daily false negative (requirement 2)

- **Root cause.** Ruleset 21204104 forbids deleting any branch and has no bypass, so no token can delete the E2E fixture branches. Each `DELETE` returned HTTP 422 `Repository rule violations found`, and the job failed every day. Its message said "scheduled cleanup will retry", which can never succeed.
- **Fix (`407da13b`).** The cleanup reads the branch rules first and treats a rule violation on `DELETE` the same way the E2E cleanup already does. It reports one warning per run that names the remedy, and it fails only on real errors. A dry run against the live repository now reports 190 retained branches as one warning (`local/cleanup-dry-run-after.log`).
- **Test.** `tests/cleanup-task-fixtures-ruleset-2625.test.mjs`.
- **Not changed.** The ruleset is the owner's policy. To let disposable branches be removed, add `refs/heads/e2e/**` (and the `issue-*` fixture pattern, if wanted) to `conditions.ref_name.exclude`, or add a bypass actor for the cleanup token. The cleanup deletes them as soon as the rule allows it.

### C. E2E Hello World Matrix (requirement 1)

1. **`agent / nemotron-3-super-free` (`e6d2555b`, `4a75d9ff`).**
   - **Root cause.** OpenCode Zen withdrew `nemotron-3-super-free`. Zen's remaining free models answer HTTP 403 `FreeTierError` to clients that are not OpenCode (anomalyco/opencode#49433, #50366). Hive Mind does not spoof OpenCode's client headers to get around this.
   - **Fix.** The default now maps to `kilo/nemotron-3-super-free`, which is `nvidia/nemotron-3-super-120b-a12b:free` on the Kilo gateway. `@link-assistant/agent` 0.26.11 has no entry for it, so Hive Mind supplies one through `LINK_ASSISTANT_AGENT_CONFIG_CONTENT`, both for the connection check and for the task run. A user definition of the same model wins.
   - **Evidence.** `upstream/agent-kilo-overlay-smoke.txt` shows `exit 0, reply "hello"`. `upstream/out-*.log` holds the per-model runs.
   - **Test.** `tests/agent-default-free-model-2625.test.mjs`.
2. **Empty failure reason (`00973d16`).**
   - **Root cause.** `gh api user` answers 403 `Resource not accessible by integration` to a workflow `GITHUB_TOKEN`. `verifyResults` threw on that, and the catch printed an empty reason because the message was passed as `log()`'s options argument.
   - **Fix.** Verification now works with integration tokens and prints the real reason.
   - **Test.** `tests/verify-results-integration-token-2625.test.mjs`.
3. **The three `formal-ai` rows are true positives.** Formal AI did not deliver the task, and the E2E check reports exactly that. Each one is tracked upstream:
   - `agent`: "Let me open e.g". See E and [formal-ai#1189](https://github.com/link-assistant/formal-ai/issues/1189).
   - `codex`: the same `gh issue view` repeated 20 times, until Hive Mind's repeated-tool-call breaker stopped it. This is working as designed; see [formal-ai#1154](https://github.com/link-assistant/formal-ai/issues/1154).
   - `claude`: Formal AI answered with Kotlin source in the chat instead of writing files, and the program prints the greeting twice. See [formal-ai#1156](https://github.com/link-assistant/formal-ai/issues/1156) and [#1162](https://github.com/link-assistant/formal-ai/issues/1162).

### D. Formal AI Draft (requirement 3)

| Symptom | Root cause | Fix | Test |
| --- | --- | --- | --- |
| `HTTP 422: Required input 'bump_type' not provided` in "Dispatch checks on the draft head", on every run | `release.yml` declared `bump_type` as `required: true` with no default. The dispatch API cannot fill in a form, so no checks dispatch has ever started. | `e602cc32` adds `default: patch`, which the web form already preselects. | `tests/dispatch-checks-inputs-2625.test.mjs` checks every workflow `dispatch-checks` can start. |
| `No files were found with the provided path` when uploading the session log, on every run | `solve` parsed `--log-dir` but never applied it. The log stayed in the container's working directory. | `47781dd1` copies the log into `--log-dir` right after argv is parsed. It copies rather than renames, because rename fails with EXDEV across a bind mount. | `tests/solve-log-dir-2625.test.mjs` |
| Gist upload retried 2 times plus as parts on `403 Resource not accessible by integration` | The upload treated a permission refusal as transient. | `b7fbf5e7` stops on the first attempt. Secondary rate limits keep their retries. | `tests/log-upload-permanent-403-2625.test.mjs` |
| `'formal-ai-draft' not found` when labelling | The repository never had the label. | `982dbee6` creates it on first use without `--force`, so a customised label is kept. | `tests/formal-ai-draft-label-2625.test.mjs` |
| Red "Open the Formal AI draft" | By design (docs/FORMAL-AI-DRAFTS.md): a draft that did not change anything must fail. The cause is upstream (E). | — | — |

### E. Formal AI reads "e.g" as a file (upstream)

- **What happens.** `local_file_paths` in formal-ai `rust/src/agentic_coding/file_read.rs` (main `d209aac`) cleans the token `(e.g.,` down to `e.g`. `looks_like_local_file_path("e.g")` accepts that as stem `e` with extension `g`, so the first turn of every draft is a read of `<cwd>/e.g`. This reproduces in 10 out of 10 runs with formal-ai 0.352.1.
- **Repro.** `experiments/formal-ai-eg-path-token-2625.mjs` ports the tokenizer. It shows that `e.g.`, `i.e.` and `a.k.a.` are file-like, while `etc.` and `vs.` are not.
- **Reported.** [formal-ai#1189](https://github.com/link-assistant/formal-ai/issues/1189) includes the repro, a Rust test, a workaround, and a suggested `is_dotted_abbreviation` fix.

## Upstream reports

- [link-assistant/formal-ai#1189](https://github.com/link-assistant/formal-ai/issues/1189): the "e.g" read.
- [link-assistant/agent#327 comment](https://github.com/link-assistant/agent/issues/327#issuecomment-6040047705) covers:
  - Zen's `FreeTierError`.
  - The stale built-in Kilo ids (`z-ai/glm-5:free`, `z-ai/glm-4.5-air:free`, `minimax/minimax-m2.5:free`, `giga-potato`, `arcee-ai/trinity-large-preview:free`, `deepseek/deepseek-r1-0528:free` no longer exist on the gateway).
  - `session.summary` answering Not Found for `kilo/minimax-m2.5-free`.
  - The verified minimal-config workaround, and four suggested fixes.

## Template comparison (requirement 6)

- **Files compared.**
  - JS template: `release.yml`, `security.yml`, `links.yml`, `workflows.yml`, `example-app.yml`, and `scripts/`.
  - Python template: `release.yml`, `security.yml`, `links.yml`, `workflows.yml`, `docs.yml`, and `scripts/`.
- **Workflows the templates also have.** Hive Mind's `security.yml`, `links.yml` and `workflows.yml` were green in the issue's table. Its `release.yml` failed only on the freshness gate, and the templates have no such gate.
- **Hive Mind-only workflows.** `cleanup-test-repos.yml`, `e2e-hello-world-matrix.yml` and `formal-ai-draft.yml` exist only in Hive Mind. No template uses gists, labels, `--log-dir`, branch deletion, or API dispatch of `release.yml`, so none of the defects above exists there.
- **Latent shared item.** Both templates declare `bump_type: required: true` without a default. It is harmless there because nothing dispatches their `release.yml` through the API. Principle 17 of the guide now records the rule.
- **Their own red `main` runs** (`templates/`) fail in Release Preflight on credential verification:
  - JS: `npm OIDC package exchange rejected (404); configure a trusted publisher or bootstrap token`.
  - Python: `PyPI answered 422 to the mint-token probe` → `verified nothing (1 unknown) -- refusing to release on an unproven credential set`.
  
  This is principle 16 doing its job: each repository's registry credential is not configured. It is a setting for the owners, not a code defect shared with Hive Mind, so no template issue was filed.

## Best practices (requirements 7 and 9)

`docs/CI-CD-BEST-PRACTICES.md` principle 17, "Tell a Broken Pipeline from a Changed World", records the general lessons in en/hi/ru/zh. Each lesson is pinned by the test named above, and the guide is pinned by `tests/cicd-best-practices-false-negatives-2625.test.mjs`:

- Gate external state on pull requests only; on push, warn.
- Do not retry policy refusals.
- Give a default to every input of an API-dispatched workflow.
- Create the labels you depend on.
- Write logs where the upload step looks.

Applied everywhere:

- **Gist uploads.** The other gist path (`src/github-error-reporter.lib.mjs`) already retries only rate limits.
- **Ruleset violations.** These were already handled in the E2E cleanup; the daily cleanup now uses the same classification.
- **API dispatch.** The dispatch test iterates over every workflow that `dispatch-checks` can start.

## Remaining limits

- The fixture branches stay until the ruleset excludes them, which is the owner's decision.
- The Formal AI Draft and the `formal-ai` E2E rows stay red until formal-ai#1189, #1154, #1156 and #1162 are fixed upstream. Both workflows report those failures correctly.
- The default free model depends on Kilo keeping `nvidia/nemotron-3-super-120b-a12b:free`. When Agent ships the entry itself, the overlay becomes a no-op, because a defined model wins.
