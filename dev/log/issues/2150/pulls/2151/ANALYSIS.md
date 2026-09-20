# Issue 2150 / PR 2151 investigation

Collected and analyzed on 2026-08-11 UTC. This document is the index and
conclusion for the raw evidence stored beside it. All timestamps below are UTC.

## Scope and method

The investigation covered:

1. every issue and pull-request body, event, commit, review, conversation
   comment, and inline review comment available at collection time;
2. the complete logs and job metadata for the cited failing default-branch run
   and the prepared PR's initial run;
3. a fresh clone and full file tree of the JavaScript CI/CD template at commit
   `9af528` (release `0.11.27`), including its open and closed issue history;
4. every Hive Mind and template workflow and every top-level CI/CD script;
5. npm registry metadata and a Node 20/Node 24 package-version matrix for
   `use-m` and `command-stream`;
6. dependency audit, clean-install, syntax, formatting, lint, duplication,
   line-limit, regression, and full-suite results.

The complete file inventories are `hive-mind-file-tree.txt` and
`template-file-tree.txt`. `workflow-structure-comparison.txt` contains the raw
workflow/script comparison. The `ci-logs/` directory contains the unabridged
logs. This avoids basing conclusions on filtered GitHub annotations alone.

There were no screenshots or user-attachment URLs in the issue, PR, or
comments. There were also no issue comments, PR conversation comments, inline
review comments, or submitted reviews at initial collection time. CodeQL later
posted one informational setup comment during hosted validation; the final API
files preserve it. No human feedback or review was present at final collection.

## Timeline

| Time                      | Event and evidence                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-31 20:23          | `use-m@8.15.0` was published. It was still the latest version during this incident (`npm-use-m.json`).                                                                                                                                                                               |
| 2026-08-07 20:21          | `command-stream@0.18.0` was published with the behavior previously consumed by Hive Mind.                                                                                                                                                                                            |
| 2026-08-11 10:26–11:28    | `command-stream` 0.18.1, 0.18.2, and 0.19.0 were published. Version 0.19.0 changed the package's CommonJS entry behavior and became `latest` (`npm-command-stream-full.json`).                                                                                                       |
| 2026-08-11 13:49          | Main commit `4873c0d` triggered Checks and release run `31498219981`. The unchanged application dynamically resolved the newly published dependency.                                                                                                                                 |
| 2026-08-11 13:56          | Run `31498219981` failed in `test-suites`, `test-execution`, and `memory-check-linux`. Its other passing jobs emitted Git, action-runtime, and file-size warnings.                                                                                                                   |
| 2026-08-11 14:15          | Issue #2150 was opened from that run, requesting a complete CI/CD audit and template comparison.                                                                                                                                                                                     |
| 2026-08-11 14:16          | Draft PR #2151 and commit `a4a5663` were created. Run `31500665379` was green, but all substantive checks were skipped because the scaffold changed only `.gitkeep`; it did not validate a solution.                                                                                 |
| 2026-08-11 investigation  | Exact Node/package matrix reproduced the crash only with Node 24 and `command-stream@0.19.0`; Node 20 and `command-stream@0.18.0` were controls. Regression tests were captured before the fix.                                                                                      |
| 2026-08-11 investigation  | An upstream reproducer, workaround, root cause, and proposed code fix were reported as [`use-m` issue #72](https://github.com/link-foundation/use-m/issues/72).                                                                                                                      |
| 2026-08-11 implementation | Runtime dependency pins and CommonJS namespace normalization restored all Node 24 command entry points. CI false-negative paths, false-positive tests, security gaps, dependency warnings, action warnings, and file-size warnings were then addressed and regression-tested.        |
| 2026-08-11 verification   | A clean global-install test exposed npm alias executable collisions when both `latest` and pinned `use-m` aliases coexist. The repair was regression-tested and reported upstream as [`use-m` issue #73](https://github.com/link-foundation/use-m/issues/73).                        |
| 2026-08-11 verification   | Running the newly strict execution contract exposed a nonexistent network fixture that always exits 1. It was replaced by a deterministic invalid-URL contract that accepts only the exact expected status and reason.                                                               |
| 2026-08-11 hosted CI      | Security run `31514274130` initially failed because GitHub's dependency-diff API returned 403 while the repository Dependency Graph was disabled. The documented admin endpoint enabled vulnerability alerts and the graph; attempt 2 passed Dependency Review and both CodeQL jobs. |

Run metadata, including exact SHA and job conclusions, is in
`ci-run-31498219981.json` and `ci-run-31500665379.json`. This timestamp/SHA check
is important: the initially green PR run predates the substantive fixes.

## Requirements inventory and disposition

### Requirements stated by issue #2150

| #   | Requirement                                                                                  | Disposition                                                                                                                                                                                                                                                      |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | Find and fix all CI/CD false positives.                                                      | The memory-check `--help` test could pass on a crash; it now requires a zero exit status and real help content. Legitimate timeout handling is explicit rather than treating arbitrary errors as success.                                                        |
| I2  | Find and fix all CI/CD false negatives.                                                      | Removed error swallowing from command smoke tests, log verification, and dry-run probes. Added a terminal pipeline gate that fails on every failed dependency and on cancelled jobs on `main`.                                                                   |
| I3  | Fix all CI/CD warnings.                                                                      | Upgraded checkout/setup actions to v6, supplied Git's initial-branch configuration before checkout, approved the reviewed install script by exact version, removed all 19 line-headroom warnings, and updated vulnerable transitive dependencies.                |
| I4  | Fix all CI/CD errors.                                                                        | Reproduced and fixed the Node 24 `$ is not a function` failure across every runtime-loaded dependency consumer. All three failing jobs shared this root cause.                                                                                                   |
| I5  | Compare the full Hive Mind and JavaScript-template file trees, workflows, and CI/CD scripts. | Full inventories and structural comparison are preserved. Shared practices were reconciled; project-specific template files were classified rather than copied blindly.                                                                                          |
| I6  | Reuse all applicable template best practices to prevent future errors.                       | Adopted the template's terminal gate, security workflow, current actions, Git warning suppression, permissions, cancellation semantics, and strict command-status handling. Existing Hive Mind equivalents were retained where stronger or application-specific. |
| I7  | Follow `docs/CI-CD-BEST-PRACTICES.md`.                                                       | Audited every one of its twelve principles; results are below.                                                                                                                                                                                                   |
| I8  | Report the same issue to the template when present.                                          | No new duplicate reports were filed: template issues #41, #99, #123, and #126 already cover the matching file-warning, Git-warning, cancellation false-negative, and jscpd cases. The novel loader defect belongs to `use-m` and was reported there as #72.      |
| I9  | Plan and execute everything in one PR.                                                       | All application, workflow, test, dependency, evidence, and changeset changes are contained in PR #2151.                                                                                                                                                          |

### Additional execution requirements supplied with the task

| #   | Requirement                                                                               | Disposition                                                                                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Collect all issue/PR/CI evidence under this exact folder.                                 | Raw issue, PR, API, run, log, template, registry, experiment, and test artifacts are stored here.                                                                                                                                  |
| U2  | Reconstruct the sequence and find the root cause of each problem.                         | Timeline above and problem matrix below provide both.                                                                                                                                                                              |
| U3  | Create a reproducing test before fixing a bug.                                            | Before logs show the Node 24 loader and `$`-validation regressions failing; after logs show them passing. CI integrity and security tests also have failing-before evidence.                                                       |
| U4  | Search online for facts and reusable components.                                          | Primary-source results and the template/upstream comparison are documented below.                                                                                                                                                  |
| U5  | Add opt-in verbose tracing if evidence is insufficient.                                   | Evidence was sufficient. Existing `HIVE_MIND_USE_M_DEBUG` and `PREINSTALL_USE_M_VERBOSE=1` paths were retained and expanded with pin/normalization diagnostics; both default to off.                                               |
| U6  | Report defects in a related project with reproducer, workaround, and fix suggestion.      | `use-m` #72 and #73 each contain all three. Template duplicates were not reopened.                                                                                                                                                 |
| U7  | Apply a cross-cutting defect everywhere it occurs.                                        | All eight bare runtime package dependencies are pinned at their common loader boundary and preinstaller; every command consumer benefits. All workflow action occurrences were upgraded. Every warning-threshold file was reduced. |
| U8  | Include automated checks and a release trigger.                                           | Regression tests and a patch changeset are included. This repository releases through Changesets, so `package.json`'s version was intentionally not edited by hand.                                                                |
| U9  | Finalize the existing PR, preserve evidence, and validate fresh CI against the final SHA. | PR metadata is complete. Hosted Security attempt 2 passed against code SHA `023586b2`; the matching Checks and release run is preserved and verified below.                                                                        |

## Root-cause and solution matrix

### 1. Node 24 command-loader failure (three failed jobs)

**Observed:** The default suite failed at `src/log-upload.lib.mjs`; log-file
verification and all memory checks failed at `src/memory-check.mjs`. Each
ultimately reported `TypeError: $ is not a function`. See the full log around
lines 17,810, 18,953, and 19,292, plus the extracted diagnostics.

**Root cause:** Hive Mind intentionally uses `use-m` for runtime dependencies.
Bare package names allowed `use-m@8.15.0` to resolve npm's mutable `latest` tag.
`command-stream@0.19.0` was published 141 minutes before the failing main run
and its package metadata selects `./src/$.cjs` as `main`. Node 23+ adds a
synthetic `module.exports` named export to CommonJS namespace objects. `use-m`
does not classify that property as namespace metadata, so on Node 24 it returns
the namespace object instead of unwrapping the callable default export. Thus
destructuring `$` produces `undefined`. Node 20 exposes only `default`, which
`use-m` unwraps, explaining the control result.

The version/export matrix in `command-stream-export-matrix.txt` and
`use-m-command-stream-version-matrix.txt` isolates all variables. The reusable
experiment is `experiments/issue-2150/inspect-command-stream-exports.mjs`.

**Implemented solution:**

- pin `use-m` bootstrap URLs to `use-m@8.15.0` on both CDNs;
- centrally pin all eight runtime-loaded npm dependencies, including
  `command-stream@0.18.0`, rather than repairing one caller;
- normalize only the distinctive Node namespace shape where `default` and
  `module.exports` exist and are identical, preserving genuine ESM namespaces;
- make the CI preinstaller consume the same central version map;
- validate that the loaded `$` export is callable at a common early boundary;
- retain opt-in pin and normalization tracing under `HIVE_MIND_USE_M_DEBUG`.

**Alternatives considered:** Pinning only `command-stream` removes today's
failure but leaves seven packages mutable. Downgrading CI to Node 20 violates
the package engine and hides the interoperability defect. Replacing `use-m`
throughout is much larger and unnecessary for this PR. The upstream fix should
teach `use-m` to recognize Node's `module.exports` marker; issue #72 proposes
that change.

The pinned aliases also exposed a second upstream defect during clean global
installation: npm refuses to install `zx-v-8.8.5` when the existing
`zx-v-latest` alias owns the shared `bin/zx` symlink. `use-m` does not disable
bin links or recover from this expected alias collision, so pinning alone could
make a previously initialized machine fail with `EEXIST`. The loader now
repairs only this narrowly verified case: it confirms the conflicting symlink
belongs to another alias of the same package, then installs the pinned alias
with npm's `--no-bin-links`. It refuses unrelated conflicts. The isolated
before/after reproducer and tests are preserved, and issue #73 proposes the
equivalent upstream fix.

### 2. Memory-check false-positive help assertion

**Observed:** The `--help` subtest printed the full stack trace above and still
reported `PASSED`, while seven functional subtests failed.

**Root cause:** The assertion accepted generic output/nonzero behavior instead
of requiring successful help output. Any startup crash therefore satisfied it.

**Implemented solution:** Require exit code zero plus expected help semantics.
`test-memory-check-after.log` and the end-to-end reproduction show 10/10 tests
passing; the before evidence preserves the false positive.

### 3. Command and dry-run false negatives

**Observed:** Multiple smoke paths used `|| true` or converted a command error
to a warning. A crash could therefore leave the job green. The release dry-run
also treated timeout status and every unrelated failure identically.

**Root cause:** Status suppression was added for expected timeouts and optional
cleanup, but its scope covered startup/import/argument errors too. Piped output
also hid the program status unless `PIPESTATUS` was inspected. After removing
the suppression, the log smoke test exposed a second defect: it targeted the
nonexistent `test/repo`, so a correct command deterministically returned 1.

**Implemented solution:** Help/version smoke checks now fail on command errors;
the log test uses a non-GitHub URL, requires status 1 plus the exact validation
reason, rejects timeout/runtime-error output, and then verifies the generated
log. This removes live-repository dependence without accepting arbitrary
failures. Other dry-run paths no longer swallow status. Cleanup-only
best-effort operations remain explicitly non-fatal.

### 4. Cancelled/failed jobs could yield a misleading pipeline result

**Observed:** The workflow had no terminal observer. GitHub represents a job
killed by `timeout-minutes` as `cancelled`, and dependent write jobs simply skip.
This can make a required timeout indistinguishable from a superseded PR run.

**Root cause:** Individual `if: !cancelled()` gates safely stop writers but do
not convert a main-branch cancellation into a workflow failure.

**Implemented solution:** The template's `check-pipeline-status.sh` pattern was
adapted as a final job that observes every other release job. Any failure is an
error. Cancellation on `main` is an error; cancellation on a PR is a warning so
superseded read-only runs remain cancellable. A structural regression test
ensures newly added jobs cannot silently escape the observer.

### 5. Git and JavaScript-action runtime warnings

**Observed:** Every checkout emitted Git's default-initial-branch hint and
setup-node v5 emitted `DEP0040` (`punycode`) warnings under the forced Node 24
action runtime.

**Root cause:** Git initializes checkout's temporary repository before a normal
workflow step can configure it. Older action bundles brought older runtime
dependencies.

**Implemented solution:** Supply `init.defaultBranch=main` through Git's
`GIT_CONFIG_COUNT/KEY/VALUE` environment contract, available to checkout from
process start. Upgrade every checkout and setup-node occurrence in both
existing workflows to v6. Security uses the same versions. Regression tests
scan every workflow, not one occurrence.

### 6. Nineteen file-headroom warnings

**Observed:** Nineteen `.mjs` files and `release.yml` exceeded the repository's
1,350-line warning threshold, several at exactly 1,500. They did not fail the
hard 1,500-line gate but created real concurrent-merge risk.

**Root cause:** Responsibilities and whitespace accumulated while the hard
ceiling allowed files to reach the point where normal parallel PRs could push
them over the limit.

**Implemented solution:** Extracted Claude connection validation, pure GitHub
URL parsing, and the dynamic tool-specific uncommitted-change loader into three
tested modules. In the remaining files only blank lines were removed or
consecutive line comments were joined without deleting comment text. The
mechanical accounting is in `line-headroom-compaction-report.txt`. Every warned
file is now at or below the 1,350-line early-warning threshold, and extracted
modules leave their former parents smaller still. An AST/template-literal audit
also verifies that the mechanical compaction preserved runtime values and code
structure. The final line-limit log has no warning annotation. The 1,500 hard
limit and 1,350 early-warning policy were not weakened.

### 7. Dependency vulnerabilities and install-script warning

**Observed:** `npm audit` found four high-severity transitive vulnerabilities:
`brace-expansion`, `fast-uri`, `flatted`, and `js-yaml`. A clean npm 11 install
also warned that `@sentry/node-cpu-profiler@2.4.2` had an unreviewed install
script.

**Root cause:** The lockfile resolved vulnerable transitive versions and npm's
new lifecycle-script review policy had no project decision for the profiler.

**Implemented solution:** `npm audit fix` refreshed only compatible transitive
resolutions, taking the audit from four high findings to zero. The existing
Sentry profiler's build check was reviewed and approved through npm's official
command, producing an exact-version `allowScripts` entry rather than trusting
all future releases. A clean Node 24 `npm ci` installs 443 packages with no
warning and audits 444 packages with zero vulnerabilities.

### 8. Missing continuous security analysis

**Observed:** Hive Mind had secret scanning in local/pre-commit dependencies and
an npm audit step, but no CodeQL workflow or PR dependency-review enforcement.
The JavaScript template has both.

**Root cause:** The repository's older specialized workflow predated the
template security workflow and had not inherited it.

**Implemented solution:** Added the template-aligned `security.yml`: CodeQL for
both JavaScript/TypeScript and Actions on PRs, main, manual dispatch, and weekly
schedule; dependency review on PRs fails at high severity; permissions are
least-privilege, jobs are bounded by timeouts, and read-only runs cancel when
superseded. The first hosted run then found that the repository-level Dependency
Graph prerequisite was disabled: both the workflow token and an admin token got
HTTP 403 from the dependency-diff endpoint. Enabling vulnerability alerts through
GitHub's documented repository API also enabled the Dependency Graph; the same
15-change diff became readable and an unchanged workflow rerun passed. The gate
was not weakened with `continue-on-error`.

### 9. Duplication output and initial green PR run (not defects)

`jscpd` reports clone locations as diagnostic output. Hive Mind already limits
analysis to JavaScript and fails above 11%; the final measured duplication is
9.5%, so suppressing clone locations would hide useful evidence. Template
issue #126 concerned a different configuration (`format: console`) that
analyzed zero files; Hive Mind does not have that false positive.

The initial PR run's green status is also not evidence of a corrected pipeline:
change detection deliberately excludes `.gitkeep`, as required by the best
practices document. The job graph correctly skipped substantive work. Fresh
post-push runs must be matched to the final commit SHA before acceptance.

## Template and best-practice reconciliation

### Full tree comparison

The template has `release.yml`, `security.yml`, `example-app.yml`, and
`links.yml`. Hive Mind now has application-specific `release.yml`,
`cleanup-test-repos.yml`, and template-aligned `security.yml`.

- `example-app.yml` deploys the template repository's demonstration app. Hive
  Mind has no equivalent static example deployment target, so copying it would
  add an invalid deployment rather than a best practice.
- `links.yml` manages template-specific link/archive assets. Hive Mind's docs
  validator and release workflow are its applicable equivalents; the template
  service-specific workflow is not portable.
- Template package/release helpers absent from Hive Mind either have a Hive
  Mind equivalent (`detect-code-changes`, syntax, line limits, changesets,
  version checks, release notes, npm publishing) or implement template-only
  preview, archive, and example-package behavior. The raw names and structures
  are preserved in the comparison evidence.
- Hive Mind's Docker, Helm, global-command, memory, Telegram, test-repository
  cleanup, and multi-command checks are application-specific and were retained.

### `CI-CD-BEST-PRACTICES.md` checklist

| Principle                         | Result                                                                                                                                                                                       |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Relevant-change detection      | Existing `detect-changes` retained; source, workflows, dependencies, docs, Docker, and Helm outputs gate appropriate jobs. `.gitkeep`, evidence, and experiments do not trigger code checks. |
| 2. File-size limits               | Existing 1,500 gate retained and synchronized with ESLint; all 1,350 headroom warnings removed.                                                                                              |
| 3. Formatting                     | Prettier remains in local hooks and CI; workflow changesets are now checked strictly.                                                                                                        |
| 4. Static analysis                | ESLint and duplication gates retained; CodeQL added.                                                                                                                                         |
| 5. Fast-fail ordering             | Compilation, lint, line limits, docs, and changeset checks continue to gate slower unit/integration/container jobs.                                                                          |
| 6. Changeset versioning           | Patch changeset added; no forbidden manual package version edit.                                                                                                                             |
| 7. Actual merge-result validation | Existing fresh-base merge simulation and conflict rejection retained across required jobs.                                                                                                   |
| 8. Pre-commit hooks               | Existing Husky/lint-staged checks retained and exercised by commits.                                                                                                                         |
| 9. Release automation             | Existing validated Changesets, npm OIDC publishing, Docker, and Helm writers retained.                                                                                                       |
| 10. Concurrency                   | Distinct cancellable read jobs and shared non-cancellable main-writer groups retained; terminal cancellation semantics added.                                                                |
| 11. Secrets detection             | Existing secretlint enforcement retained; workflow permissions reduced and CodeQL added.                                                                                                     |
| 12. Documentation validation      | Existing multilingual documentation validation retained and gated on doc changes.                                                                                                            |

## Online and reusable-component research

Only primary/maintainer sources informed implementation:

- [Node.js ESM/CommonJS interoperability](https://nodejs.org/download/release/v24.19.0/docs/api/esm.html#commonjs-namespaces)
  documents the `default` and `'module.exports'` CommonJS namespace markers
  that explain the Node 24-only shape.
- [`actions/setup-node`](https://github.com/actions/setup-node) documents that
  v6 uses the Node 24 action runtime, recommends explicitly selecting Node, and
  shows checkout/setup-node v6 together.
- [GitHub dependency-review configuration](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/manage-your-dependency-security/configure-dependency-review-action)
  recommends a PR action with explicit `contents: read` and severity policy.
- [GitHub's repository REST API](https://docs.github.com/en/rest/repos/repos#enable-vulnerability-alerts)
  documents that enabling vulnerability alerts also enables the Dependency
  Graph, which resolved the hosted dependency-review prerequisite without
  suppressing the check.
- [GitHub CodeQL for Actions](https://docs.github.com/en/code-security/reference/code-scanning/codeql/codeql-queries/actions-built-in-queries)
  confirms that workflow permissions and other Actions-specific weaknesses are
  analyzable, motivating the `actions` matrix entry.
- [npm `approve-scripts`](https://docs.npmjs.com/cli/v11/commands/npm-approve-scripts/)
  states that this command is the recommended way to manage `allowScripts` and
  defaults to exact-version approvals.
- The requested [JavaScript pipeline template](https://github.com/link-foundation/js-ai-driven-development-pipeline-template)
  supplied the security workflow and terminal-gate patterns. Its existing
  issues [#41](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/41),
  [#99](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/99),
  [#123](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/123),
  and [#126](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/126)
  prevent duplicate reports.
- Upstream [`use-m` issue #72](https://github.com/link-foundation/use-m/issues/72)
  records the Node 24 CommonJS namespace defect, while
  [`use-m` issue #73](https://github.com/link-foundation/use-m/issues/73)
  records the npm alias-bin collision discovered while validating the pinning
  strategy.

No additional library is needed. Node's namespace is safely normalized at the
existing loader boundary; adopting another process library would not repair
`use-m`'s module classification. CodeQL, dependency-review-action, npm audit,
ESLint, Prettier, jscpd, secretlint, Changesets, Husky, and the repository's
existing test runner collectively cover the identified CI/CD failure classes.

## Verification map

| Claim                                    | Evidence                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Original CI root errors                  | `ci-logs/checks-and-release-31498219981.log`, diagnostics extracts                                                                                                       |
| Exact Node/package reproduction          | `reproduction-node24-use-m-command-stream-shape.log`, `control-node20-use-m-command-stream-shape.log`, package/export matrices                                           |
| Regression fails before and passes after | `local-tests/regression-use-m-node24-before.log`, `local-tests/regression-use-m-node24-after.log`, `$`-validation before/after logs                                      |
| Memory false positive corrected          | `reproduction-node24-memory-check-before.log`, `local-tests/reproduction-node24-memory-check-after.log`, `local-tests/test-memory-check-after.log`                       |
| Security workflow absent then enforced   | `local-tests/security-workflow-before.log`, `local-tests/ci-integrity-with-security-after.log`                                                                           |
| Pipeline-gate semantics                  | `local-tests/ci-cancellation-and-gate-after.log`                                                                                                                         |
| Deterministic log smoke contract         | `local-tests/log-file-content-smoke-final.log`, `local-tests/deterministic-log-smoke-regression-before.log`, `local-tests/deterministic-log-smoke-after.log`             |
| Source syntax                            | `local-tests/check-mjs-syntax-after.log`                                                                                                                                 |
| ESLint / formatting / duplication        | `local-tests/npm-run-lint-after.log`, `local-tests/npm-run-format-check-after.log`, `local-tests/npm-run-duplication-after.log`                                          |
| No line warnings / semantic compaction   | `local-line-limit-before.log`, `local-line-limit-final.log`, `line-headroom-compaction-report.txt`, `local-tests/compaction-semantics-final.log`                         |
| Audit and install warning cleanup        | `npm-audit-before-fix.json`, `npm-audit-after-fix.json`, `local-npm-ci-before.log`, `local-npm-ci-after.log`                                                             |
| Full unit behavior                       | `full-default-suite-final.log`                                                                                                                                           |
| Upstream report                          | `upstream-use-m-issue-body.md`, `upstream-use-m-created-issue.json`                                                                                                      |
| Safe pinned-alias migration              | `local-tests/regression-bin-links-before.log`, `local-tests/regression-bin-links-after.log`, `local-tests/preinstall-all-pinned-after.log`                               |
| Second upstream report                   | `upstream-use-m-bin-alias-issue-body.md`, `upstream-use-m-bin-alias-created-issue.json`                                                                                  |
| Hosted security prerequisite and pass    | `ci-logs/security-31514274130-attempt-1.log`, `ci-logs/security-31514274130-attempt-2.log`, `dependency-graph-enabled-response.txt`, `dependency-diff-after-enable.json` |

Fresh hosted runs `31514274130` (Security) and `31514274046` (Checks and release)
were created at 2026-08-11 16:47:46 for code SHA
`023586b227416e1ce59f11b8eb7525c0403ee4bf`; they supersede the green scaffold
run at `a4a56635`. Their complete logs and metadata are stored beside this file.
