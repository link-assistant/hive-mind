# Issue #2279 / PR #2280 investigation and solution record

## Executive conclusion

The reported failing release was a real CI error, not a stale status. The
release fallback created a protected-branch PR with the built-in
`GITHUB_TOKEN`. GitHub created its three `pull_request` workflow runs in
`action_required`, so the required `Pipeline Status` check never appeared on
the PR. The prior workaround then ran the workflow through
`workflow_dispatch`; that run passed on the same SHA, but GitHub deliberately
does not evaluate manually dispatched workflow-job checks as pull-request
required checks. Ten retries could never change that invariant policy state.

The fix creates the fallback PR with a separately configured PAT or custom
GitHub App token, watches checks associated with the PR, and attempts the merge
only after they pass. Missing credentials fail closed before creating an
orphan release branch. Permanent policy failures are no longer retried as if
GitHub were still calculating mergeability.

The prepared PR also exposed one independent, valid freshness failure:
`src/use-with-retry.lib.mjs` pinned yargs `18.1.0` while npm had `18.2.0`.
That declaration is refreshed.

## Evidence scope

- Complete issue, issue comments/events/timeline, PR metadata/commits/files,
  all three PR comment/review API families, repository/ruleset/workflow/secret
  metadata, related issue #2274 and PRs #2275-#2278 are in `github/`.
- Complete logs and job/run metadata for the three main release failures, both
  manually dispatched validation runs, the linked Security and link-check
  runs, the prepared PR's initial checks, and the related Formal AI run are in
  `ci-logs/` and `github/`.
- Raw artifacts larger than 300 KiB are stored as reproducible gzip streams.
  The focused diagnostic indexes preserve their original pre-compression paths
  and line numbers so findings can be traced after `gzip -dc` extraction.
- Local reproductions and every local verification command are in `local/`.
- The complete current template/repository CI file inventories, hashes, trees,
  diffs, and online research are in `research/`.
- There were no issue comments, review comments, reviews, or screenshots to
  download at investigation time. The empty API result files preserve that
  fact. Repository Actions variables were also empty. Organization-secret
  enumeration was denied with the captured 403; repository secret *names* were
  collected, and `RELEASE_PULL_REQUEST_TOKEN` was not among them.

## Reconstructed timeline (UTC)

1. On 2026-09-20 the active `Main ruleset` required all changes through PRs,
   required strict `Pipeline Status`, allowed only merge commits, and had no
   bypass actors. Its exact payload is `github/ruleset-main.json`.
2. Run 35526569064 created release PR #2276 at 17:47. All three PR workflows
   became `action_required`; the PR had no check rollup, and every merge was
   rejected by base-branch policy.
3. Issue #2274 / PR #2275 attempted to fix that deadlock by dispatching
   `release.yml` against the release head and watching that run. It was merged
   at about 18:53.
4. Run 35530498148 created PR #2277 at 19:02. Dispatched run 35530983182 passed
   at 19:10, but the PR rollup remained empty. Ten merge attempts were rejected
   and `Pipeline Status` correctly propagated the release failure.
5. Run 35536130313 repeated the sequence with PR #2278 at 20:46. Dispatched
   run 35536619299 passed at 20:54; the merge still failed ten times. This is
   the failure linked by issue #2279.
6. Issue #2279 and prepared PR #2280 were opened on 2026-09-21. Initial run
   35571181990 found a new exact dependency freshness mismatch: yargs
   `18.1.0 -> 18.2.0`. Its terminal gate failed because `detect-changes`
   failed; the linked Security run passed.
7. A regression test was committed before the implementation. Against the old
   code it failed because no `gh pr checks <PR> --watch` call occurred; its
   output is `local/regression-before-fix.log`.

## Complete requirement inventory

| Requirement | Evidence / implementation |
| --- | --- |
| Inspect every linked CI result, warning, error, false positive, and false negative | Complete logs, job JSON, focused key lines, and annotations are stored in this bundle. |
| Compare the complete CI/CD system with `link-foundation/js-ai-driven-development-pipeline-template` | Full trees/hashes/diffs and both one-sided inventories are in `research/`; current template commit is recorded. |
| Follow `docs/CI-CD-BEST-PRACTICES.md` | The implementation preserves PR/ruleset enforcement, fail-closed behavior, explicit secret handling, terminal status propagation, and updates the newly learned rule in all four language variants. |
| Reconstruct sequence and identify actual root causes | Timeline and problem-by-problem analysis are in this document and are supported by immutable run/PR/ruleset evidence. |
| Reproduce before fixing | `tests/release-required-checks-2279.test.mjs` failed on the obsolete dispatch design before the fix commit. |
| Apply the fix everywhere | Both automatic changeset and instant release jobs use the independent token; shared helper/runtime plumbing, prior regression tests, preflight, changeset, and all translated best-practice docs were updated. |
| Add debug/verbose mode only if evidence is insufficient | Not needed: complete production logs and API state expose the root cause. Existing runner/helper `verbose=false` support remains available and default-off. |
| Research existing libraries/components | Official GitHub App-token action, GitHub CLI PR-check watcher, and `peter-evans/create-pull-request` are assessed in `research/online-sources.md`. |
| Report the shared defect upstream | Existing template issue #192 is the correct report; the prepared correction includes production repros, workarounds, and a concrete code plan. Its posted URL is captured in `github/`. |
| Preserve evidence under the requested folder | This entire record lives under `dev/log/issues/2279/pulls/2280`. |
| Update/verify the existing PR, merge current main, pass CI, and mark ready | Finalization evidence is appended after the candidate commits are pushed and current-head CI completes. |

## Root causes, classifications, and fixes

### 1. Successful validation was a false positive for merge eligibility

**Observed:** runs 35530983182 and 35536619299 both passed against the exact
release head SHAs. Nevertheless PRs #2277 and #2278 each had an empty
`statusCheckRollup`, and `gh pr merge` returned `the base branch policy
prohibits the merge` ten times.

**Root cause:** the prior regression test equated "workflow run passed" with
"PR required check passed." GitHub treats these as different facts. Checks
created by `workflow_dispatch` are explicitly ineligible for pull-request
ruleset evaluation.

**Fix:** remove the dispatch-only validation mode and `actions: write`; call
`gh pr checks <url> --watch --fail-fast --interval 10` on the PR itself. The
new regression asserts this call precedes merge and that dispatch never occurs.

### 2. Real pull-request checks never ran (false negative / missing signal)

**Observed:** every Checks and release, Security, and Broken Link Checker run
created for PRs #2276, #2277, and #2278 concluded `action_required`. All three
PR check rollups were empty.

**Root cause:** the fallback PR was opened with the job's built-in
`GITHUB_TOKEN`. GitHub puts opened/synchronize/reopened PR runs caused by that
token into an approval-required state. The release workflow had already encoded
the correct credential strategy for Formal AI drafts, but the release fallback
did not share it.

**Fix:** both release modes expose the repository secret
`RELEASE_PULL_REQUEST_TOKEN` as step-local `GH_TOKEN`. The shared helper gets a
non-secret boolean availability flag and refuses to push/create anything when
the secret is absent. A least-privilege PAT unblocks the immediate deployment;
a short-lived custom GitHub App token generated with GitHub's official
`actions/create-github-app-token` is the preferred long-term credential.

**Required operator action:** a repository administrator must provision
`RELEASE_PULL_REQUEST_TOKEN` before the next protected-branch release. Source
code cannot securely manufacture or commit this credential.

### 3. Permanent policy errors were mislabeled as transient

**Observed:** each failed release retried the exact policy rejection ten times
over roughly 50 seconds after validation had already completed.

**Root cause:** the merge helper treated every message containing "not
mergeable" as GitHub's short post-creation computation race, even when the same
message explicitly said base-branch policy prohibited the merge.

**Fix:** retry only mergeability-computation messages that are not accompanied
by base-policy, required-check, or review-policy errors. Production text is
covered by a regression that requires exactly one attempt.

### 4. Check discovery has a real short race

**Risk:** immediately after PR creation, `gh pr checks` can temporarily answer
`no checks reported` before workflows become visible.

**Fix:** only that exact condition gets a bounded 30-attempt, two-second
discovery retry. Once checks exist, the CLI watcher owns completion polling.
Any failed check or unrelated CLI failure propagates immediately.

### 5. yargs freshness failure was a true positive

**Observed:** prepared run 35571181990 reported 147/148 current declarations and
the exact stale declaration `src/use-with-retry.lib.mjs#USE_M_PACKAGE_VERSIONS:
yargs 18.1.0 -> 18.2.0`.

**Root cause:** the exact bootstrap declaration lagged the npm registry.

**Fix:** update the declaration to 18.2.0. The local dependency freshness gate
then passes; registry metadata is captured in research.

### 6. Plain-text warning audit

GitHub emitted no `##[warning]` annotations in the collected runs. Broad text
matching initially found many false positives: warning-focused test names and
assertions, CodeQL's printed command-schema description of an unused deprecated
option, and the preflight's `0 warning(s)` summary. One genuine but intentional
runtime deprecation banner did appear when the execution job invoked the legacy
`start-screen.mjs` entry point solely to verify `--auto-fork` compatibility.
That invocation now sets the product's documented
`HIVE_MIND_SUPPRESS_DEPRECATIONS=1` flag and asserts that the banner stays out of
the compatibility-test log; the dedicated deprecation regression continues to
verify the banner itself in isolation.

## Options considered

| Option | Decision |
| --- | --- |
| Keep explicit `workflow_dispatch` validation | Rejected: it can test code but cannot satisfy a PR required check. |
| Manually approve every release PR run | Valid emergency workaround, rejected for normal operation because releases cease to be unattended. |
| Remove `Pipeline Status` or add a bypass actor | Rejected: hides failures or weakens the policy the fallback is meant to honor. |
| Forge a commit status named `Pipeline Status` | Rejected: creates a security-significant synthetic signal rather than executing the required PR workflow, and the ruleset pins the GitHub Actions integration. |
| Use a dedicated fine-grained PAT | Selected as the smallest deployable change; it must be repository-scoped and least privilege. |
| Use a custom GitHub App installation token | Preferred follow-up: short lived, repository scoped, and independently attributable, but it requires administrator provisioning beyond a code-only PR. |
| Adopt `peter-evans/create-pull-request` | Not needed for this fix; it solves branch/PR lifecycle that this repository already implements, and still requires the same external token. |
| Add merge queue | Not a root-cause fix; it needs a `merge_group` trigger and still cannot turn an ineligible dispatch check into a PR check. |

## Complete template comparison

The current template and repository intentionally differ substantially: this
repository has many product-specific workflows, release jobs, security scans,
tests, and maintenance scripts. The comparison therefore used complete trees
and SHA inventories, not filename sampling. The unified `.github` and `scripts`
diffs preserve every content difference; one-sided inventories classify files
that cannot appear in a two-file content diff.

The inventory contains 59 template CI/CD files and 68 repository CI/CD files:
29 paths are shared (all 29 differ), 31 are template-only, and 40 are
repository-only. The `.github` diff covers 13 file operations (1,404 additions,
1,391 deletions); the scripts diff covers 86 operations (6,318 additions,
7,644 deletions). Many apparent one-sided pairs are deliberate refactors from
template monoliths to testable `*.lib.mjs` plus thin entry points—for example
preflight credentials, command execution, release-needed detection, and version
commit logic. Repository-only workflows add CodeQL configuration, Dependabot,
test-repository cleanup, Formal AI, and release preflight. Template-only files
include example-app/DockerHub examples and generic lint, preview, and package
smoke helpers that do not apply to hive-mind's product-specific Docker/Helm and
test machinery. The precise path lists and every shared-path hash are retained,
so this classification is auditable rather than inferred from a sample.

The relevant shared component is `scripts/land-via-pull-request.mjs` /
`release-pull-request.lib.mjs`. The template uses the same built-in-token PR
creation followed by immediate merge retries and therefore has the original
deadlock. It does not contain hive-mind's later dispatch workaround. Upstream
issue #192 already reports the defect, so the correct action is to append the
new evidence and replace its invalid suggested solution rather than file a
duplicate.

No template component supplies an alternative that would make a manually
dispatched workflow eligible. The reusable external components found online
all converge on the chosen external-token strategy.

## Verification matrix

| Verification | Purpose | Result location |
| --- | --- | --- |
| Pre-fix regression | Prove old dispatch behavior misses PR checks | `local/regression-before-fix.log` |
| Issue #2279 regression | PR-check ordering, no dispatch, check discovery race, missing-token fail-closed, both release jobs | `local/node-tests-release-required-checks-2279-test-mjs.log` |
| Corrected #2274 regression | A passing PR check permits merge; a failing check prevents merge | `local/node-tests-release-required-checks-2274-test-mjs.log` |
| #2175 release helper suite | Existing rule fallback plus permanent-policy classification | `local/node-tests-release-pull-request-2175-test-mjs.log` |
| Version/release regressions | Preserve prior versioning and Changesets guards | corresponding `local/*.log` files |
| Dependency freshness | Confirm all exact declarations current | `local/dependency-freshness.log` |
| actionlint, syntax, line limits | Workflow/syntax/static limits | corresponding `local/*.log` files |
| Auto-fork compatibility script | Preserve legacy flag coverage without leaking its intentional deprecation warning into CI | `local/auto-fork-option.log` |
| format, ESLint, duplication, secretlint | Repository lint gates | corresponding `local/*.log` files |
| Complete default suite | All 498 repository default test files | `local/npm-test.log.gz` |
| GitHub integration suite | Live integration regressions | `local/github-integration.log` |
| Current-head GitHub Actions | Authoritative merge-candidate validation | final run list and downloaded non-passing logs in this bundle |

## Residual constraints

- The fix is intentionally fail-closed until an administrator provisions the
  named secret. The repository secret listing proves it was not configured at
  investigation time.
- A strict ruleset can reject a PR if `main` advances after its checks. That is
  a distinct concurrency case; the helper now reports the real policy failure
  immediately instead of claiming an indefinite mergeability calculation.
- Release branches are not deleted because the repository's global
  no-destruction ruleset forbids deletion; unique run IDs preserve retry safety.
- The live integration harness intentionally preserved its generated fixture
  repository. Cleanup of the exact test-only repository was attempted, but the
  authenticated token lacks `delete_repo`; the URL and 403 are recorded in
  `local/integration-cleanup.txt` for administrator cleanup.

## Pre-push verification result

- The complete default suite passed all 498 selected test files.
- The live GitHub integration suite passed all four assertions.
- Focused #2175, #2274, and #2279 release regressions passed.
- actionlint, dependency freshness, status-gate, Changesets guards, shell and
  JavaScript syntax, line limits, ESLint, Prettier, duplication, secretlint,
  and the auto-fork compatibility test all passed.
- `origin/main` at `b439b710ea5863e5e9fbd77cbf0e94d45751fd0b`
  is an ancestor of this branch; the explicit final merge check reported
  `Already up to date.`
