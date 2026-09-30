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

## Original external blockers

At the previous PR head, `gh api repos/link-foundation/.github/contents/actions` returned HTTP 404. Neither shared action existed on `main`. The workflows directly referenced the input/output contract specified in [link-foundation/.github issue #1](https://github.com/link-foundation/.github/issues/1), so their live execution required that dependency to be published. The CI follow-up below introduces a temporary compatibility implementation until publication.

The repository's active [no-destruction-possible ruleset](https://github.com/link-assistant/hive-mind/rules/21204104) applies deletion and non-fast-forward prohibitions to `~ALL`, excludes no branches, and has no bypass actors. Its API reports `current_user_can_bypass: never`. This blocks deletion of temporary refs in every credential layer. Branch cleanup requires a rule exemption for disposable test refs and their associated solver heads; this PR does not modify repository rules.

These were the blockers at the previous PR head. The CI follow-up below handles unpublished actions and explicitly reports policy-retained refs. Live App/PAT comparisons and the full model matrix still require their actual credentials/model sessions; branch deletion remains prohibited by repository policy.

## CI follow-up

The latest failing runs at the start of this follow-up were [Security 36713516822](https://github.com/link-assistant/hive-mind/actions/runs/36713516822) and [Checks and release 36713516679](https://github.com/link-assistant/hive-mind/actions/runs/36713516679), both for `a2cc0506f4d50fe7222145e219a9b4f12f6bcb8e` after its commit timestamp. Security log lines 34, 69 and 104 and release log line 28859 all report `Can't find 'action.yml', 'action.yaml' or 'Dockerfile'` for the resolver. Pipeline Status failed because of test-suites, at release log lines 36711–36712. These were setup failures, not failed scans or tests.

The shared repository still had no action directory. GitHub downloads statically referenced actions before evaluating step conditions, so adding an `if` cannot fix this. Workflows now check out first, stage both actions from one immutable upstream commit when published, and otherwise use a visible compatibility implementation. That implementation supports App → single token → built-in token precedence, scopes App tokens to the current repository and explicit job permissions, masks credentials, and dispatches checks with bounded polling for new runs on the correct head. Transport errors are not treated as unpublished actions. The [runtime probe](../../../experiments/issue-2323/probe-shared-actions.mjs) executes the real local composite actions with each Node process limited to a 256 MiB heap.

The repository's `Cannot delete this branch` rule was reproduced in a failing regression. Fixture and scheduled cleanup now close issues/PRs and report retained branch names in warnings and job summaries, rather than misreporting those refs as removed. Scheduled cleanup retries retained refs. All other cleanup errors remain fatal. Complete physical branch removal still requires an exemption for disposable refs; this PR leaves repository rules unchanged.

The runtime probe passed with the real nested composite actions, reporting `layer=default`, `triggers-workflows=false` and `can-create-repositories=false`. The live integration rerun created [fixture PR #2362](https://github.com/link-assistant/hive-mind/pull/2362) and issue #2361, passed the feedback assertions, closed both resources, and exited successfully with explicit warnings for the two policy-retained refs. This rerun again used workstation authentication with repository creation disabled; actual Actions token behavior is checked by CI. The 41 focused regressions, ESLint, Prettier, actionlint, zizmor, dependency freshness, duplication, secret scanning and lockfile audit passed locally.

Fresh CI on `35d0ad7c5d61209c06f3bed75c8f1aa29e11d824` passed both CodeQL jobs and Dependency Review in [Security 36721847356](https://github.com/link-assistant/hive-mind/actions/runs/36721847356), with logs confirming the built-in credential layer. In [test-suites job 109909408350](https://github.com/link-assistant/hive-mind/actions/runs/36721847646/job/109909408350), all 528 default test files passed (downloaded job log line 17778). The live feedback fixture used the built-in token, but `solve --dry-run` failed because the fresh runner had no Git identity (line 17938). Cleanup still closed its issue/PR and reported retained refs (lines 17947 and 17954).

The [fresh-runner regression](../../../tests/feedback-integration-environment-2323.test.mjs) executes the integration script with mocked GitHub calls and real Git under empty system/global configuration. It reproduced the failure before the fix. The integration now supplies the existing bot identity helper to the `solve` child through environment variables, without changing the runner's Git configuration or disabling validation. The regression passes with the identity present and fixture cleanup verified.

A live rerun with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_SYSTEM=/dev/null` passed against [fixture PR #2374](https://github.com/link-assistant/hive-mind/pull/2374), detected exactly two new comments, and closed issue #2373 and the PR. It used workstation authentication with repository creation disabled, and reported the two branches retained by the repository rule.

The next CI head, `5f0c28f3ccb79b89474501d3bfc247d5960395a1`, passed all 529 default files and the Git identity check. The built-in token created another orphan fixture, but [test-suites job 109919360154](https://github.com/link-assistant/hive-mind/actions/runs/36724635604/job/109919360154) exposed a product permission bug: the repository API returned all user-role fields false despite the token's Contents write permission. Auto-fork incorrectly selected fork mode, then `/user` failed with HTTP 403 because installation tokens have no user identity. The downloaded job log records the default-suite success at line 17791 and the false fork decision and forbidden user lookup at lines 18000–18032. Both CodeQL scans and Dependency Review passed on this head.

The [installation-token regressions](../../../tests/installation-token-permissions-2323.test.mjs) reproduce both the wrong fork decision and the direct write-check refusal using the production function bodies and mocked external calls. Both tests failed before the fix. Repository setup now checks the authenticated Git receive-pack advertisement when an installation token's user-role fields are false. This is a read-only GET: no push, pack, ref creation, or branch-rule bypass occurs. Only a successful response with the Git advertisement content type confirms authorization; denied, malformed, redirected, or failed responses cannot grant access. Ordinary user-token role checks remain unchanged.

The finite [read-only permission experiment](../../../experiments/issue-2323/probe-git-write-permissions.mjs) uses the production probe against two real repositories. It confirmed write access to `link-assistant/hive-mind` and denied it for `octocat/Hello-World`, which the workstation account can read but cannot push to. The focused regression suite passes 48 tests, including denied credentials, unexpected response types, transport failures, token precedence, and Enterprise host validation. Actual built-in-token behavior is verified by the subsequent CI run.

## Initial CI failures

The initial PR head was `7ed1de4d0a5f16ecb9ef10fe8e7c848cd53a9a1a`. Its [Checks and release run](https://github.com/link-assistant/hive-mind/actions/runs/36699394925) failed dependency freshness: `@dotenvx/dotenvx` was pinned at 2.31.1 while 2.32.2 was current (captured log lines 2288–2291). Its [Security run](https://github.com/link-assistant/hive-mind/actions/runs/36699394508) failed the npm lock audit on vulnerable `brace-expansion` 5.0.9 (lines 235–247). The source pin and lockfile were updated. Freshness checks then required the Docker images' agent pin to advance from 0.26.8 to 0.26.9 and finally 0.26.10, both published during this investigation. The [first updated-head run](https://github.com/link-assistant/hive-mind/actions/runs/36707012910) recorded the latter at log lines 2298–2301. Its release preflight used report mode and passed with configured publishing credentials (five verified capabilities). The corresponding [Security run](https://github.com/link-assistant/hive-mind/actions/runs/36707012810) passed the lock audit but failed on the missing shared action at lines 299, 334 and 369; Workflows and Broken Link Checker passed.
