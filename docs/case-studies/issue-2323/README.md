# Optional GitHub credentials: validation evidence

This implements [issue #2323](https://github.com/link-assistant/hive-mind/issues/2323) in [PR #2330](https://github.com/link-assistant/hive-mind/pull/2330).

## Reproduction and regressions

Before the change, an eligible issue passed to `decideDraft` without a configured token returned `no-draft-token` and skipped its model step. The new regression expects an attempt with `checkStrategy=dispatch`; it failed against the original implementation. Workflow assertions also failed on the four workload secrets and the default manual instant-release path.

The regression files ending in `2323.test.mjs` cover all three check strategies, checks-only dispatch defaults, outputting the draft head after a failed model session, orphan commit ancestry, repository creation capability, partial fixture cleanup, discovery of interrupted solver PRs, stale resource cleanup, protection of active fixtures, skipped/cancelled model steps, and generated-workflow approval refusal with `act` exit-code propagation. The GitHub API adapter retains the integration suite's rate-limit and transient retries, while permission failures remain visible. The change-detector regression also checks a dispatched head whose earlier code commit is followed by a documentation commit.

Run the focused regressions with:

```bash
node --test tests/*2323.test.mjs tests/detect-code-changes-untested-head-2198.test.mjs
```

Final review reproduced another partial-cleanup case: a stale PR still references its orphan base after that base has been deleted, while its ordinary solver head remains. The regression failed because cleanup selected PRs only through existing disposable refs. Cleanup now recognizes fixture PRs by their base/head names, checks their head age, and removes stale solver heads even when the orphan base is gone, while keeping active fixtures protected.

## Real GitHub integration

```bash
GITHUB_REPOSITORY=link-assistant/hive-mind \
  AUTOMATION_LAYER=default \
  AUTOMATION_CAN_CREATE_REPOSITORIES=false \
  node tests/test-feedback-lines-integration.mjs
```

On 2026-09-30 this created [fixture PR #2334](https://github.com/link-assistant/hive-mind/pull/2334) against an orphan `integration/1790764179018-baa421ea-86ed-48ed-92cf-025bfe399377/base` branch. The feedback assertions passed through the real `solve.mjs --dry-run` command: two comments posted after the baseline commit were reported and included in the prompt. The issue and PR were closed by cleanup.

The command used the workstation's existing GitHub authentication with repository creation disabled. It validates branch isolation, not the identity or scopes of an actual Actions `GITHUB_TOKEN`. Cleanup exited nonzero because GitHub rejected deletion of both fixture refs with HTTP 422, `Repository rule violations found: Cannot delete this branch`. The refs remain as evidence; the failure is reported rather than silently ignored.

The finite [generated-workflow probe](../../../experiments/issue-2323/probe-generated-workflow.mjs) ran the real `act` v0.2.89 fallback against a local API fixture. Its generated workflow executed `actions/checkout@v7` and a JavaScript Hello World program in Docker, printed `Hello, World!`, and returned success. This checks the executor independently of a model session or live run approval.

The real activity monitor reported 25 eligible issues and zero executed draft attempts during the preceding seven days, then exited 1 as required. Existing green workflows with skipped model steps did not hide the inactivity.

The [fresh-runner probe](../../../experiments/issue-2323/probe-fresh-runner.mjs) reproduced the retry helper's missing `semver` dependency on a checkout without `node_modules`. The workflow's retrying `npm ci` installed the locked dependencies, after which the API adapter loaded successfully. Standalone cleanup, activity and matrix jobs include that installation.

A [live branch dispatch with default inputs](https://github.com/link-assistant/hive-mind/actions/runs/36711771917) ran release preflight in report mode and skipped every publishing job. Its test-suite setup failed on the unpublished shared resolver. Publishing credentials were present in that CI run. A separate local invocation of `preflight-credentials.mjs --mode report`, with the Docker Hub and OIDC credential variables removed, exited 0 and reported zero verified capabilities, three warnings and zero failures. This verifies that checks-only preflight does not require publishing credentials.

## External blockers

As of 2026-09-30, `gh api repos/link-foundation/.github/contents/actions` returns HTTP 404. Neither shared action exists on `main`. The workflows use the input/output contract specified in [link-foundation/.github issue #1](https://github.com/link-foundation/.github/issues/1); their live execution requires that dependency to be published. No second implementation of the credential resolver is maintained here.

The repository's active [no-destruction-possible ruleset](https://github.com/link-assistant/hive-mind/rules/21204104) applies deletion and non-fast-forward prohibitions to `~ALL`, excludes no branches, and has no bypass actors. Its API reports `current_user_can_bypass: never`. This blocks deletion of temporary refs in every credential layer. Branch cleanup requires a rule exemption for disposable test refs and their associated solver heads; this PR does not modify repository rules.

Until the shared actions exist and disposable refs can be deleted, live default-token draft/dispatch, App/PAT workflow comparisons, the full model matrix, and successful integration cleanup cannot be claimed as passing.

## Initial CI failures

The initial PR head was `7ed1de4d0a5f16ecb9ef10fe8e7c848cd53a9a1a`. Its [Checks and release run](https://github.com/link-assistant/hive-mind/actions/runs/36699394925) failed dependency freshness: `@dotenvx/dotenvx` was pinned at 2.31.1 while 2.32.2 was current (captured log lines 2288–2291). Its [Security run](https://github.com/link-assistant/hive-mind/actions/runs/36699394508) failed the npm lock audit on vulnerable `brace-expansion` 5.0.9 (lines 235–247). The source pin and lockfile were updated. Freshness checks then required the Docker images' agent pin to advance from 0.26.8 to 0.26.9 and finally 0.26.10, both published during this investigation. The [first updated-head run](https://github.com/link-assistant/hive-mind/actions/runs/36707012910) recorded the latter at log lines 2298–2301. Its release preflight used report mode and passed with configured publishing credentials (five verified capabilities). The corresponding [Security run](https://github.com/link-assistant/hive-mind/actions/runs/36707012810) passed the lock audit but failed on the missing shared action at lines 299, 334 and 369; Workflows and Broken Link Checker passed.
