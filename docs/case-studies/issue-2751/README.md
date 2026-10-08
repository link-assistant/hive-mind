# Dependency updates and upstream feedback

[Issue #2751](https://github.com/link-assistant/hive-mind/issues/2751) asks for
dependency updates to enable upstream reporting automatically, with an independent
switch to disable it. [PR #2754](https://github.com/link-assistant/hive-mind/pull/2754)
implements the complete change.

## Evidence and scope

The [issue snapshot](data/issue.json) and [issue comments](data/issue-comments.json)
contain the specification; the issue has no comments. All three PR comment
surfaces were collected: [conversation](data/pr-conversation-comments.json),
[inline review comments](data/pr-review-comments.json), and
[reviews](data/pr-reviews.json). The previous session failed on a missing local
file before implementing the feature. Its failure comment is evidence of an
agent execution failure, rather than a failing software regression.

The starting branch had only a PR placeholder and development log. Recent
completed Workflows, Broken Link Checker, Security and Checks and release runs
all passed for `a4ac48262c184f1df61a48488990468f5a479710`, after that commit's
07:09:39 UTC timestamp on 2026-10-08. A separate Security run,
`37741750426`, was `action_required`, had no jobs, and returned
`log not found`; the completed successful Security run was `37741766154`.
This does not provide a code failure to fix. Fresh checks are required for the
implementation commit.

The latest relevant implementation is
[merged PR #2214](https://github.com/link-assistant/hive-mind/pull/2214), preserved
in [related-pr-2214.json](data/related-pr-2214.json). It introduced the ecosystem
inventory, shared dependency-update paragraphs, `/fix` mode, six tool prompt
integrations and solve/hive passthrough. These existing components provide the
implementation pattern. The current default branch was merged without rewriting
the prepared branch's history.

The more recent dependency-maintenance work in
[PR #2265](https://github.com/link-assistant/hive-mind/pull/2265), preserved in
[related-pr-2265.json](data/related-pr-2265.json), adds the freshness inventory
and grouped Dependabot updates. Its investigation also reports dependency
publication and executable defects upstream while preserving a local fallback.
That is a concrete example of the requested reporting workflow. This change
uses the existing freshness check for validation and keeps update automation
complementary to the solver's analysis of upstream logic and feature gaps.

## Root cause

Three independent paths explain the missing behavior:

1. `SOLVE_OPTION_DEFINITIONS` has no `report-dependencies-issues` entry. Strict
   solve parsing rejects the requested flag and its negative form.
2. The existing `REPORT_UPSTREAM_PARAGRAPH` only mentions bugs blocking an update.
   It is tagged as supplied by `--deep-analysis`. `/fix` forwards that option,
   so `buildStandardPrompt` removes the paragraph from the generated issue.
   This misses both the requested issue-body instruction and reporting shared
   logic, duplicated implementations and feature gaps.
3. `/fix` passes solve options to the child but never uses them to configure issue
   generation. Telegram's generated `/task` mode similarly sends only repository
   and logging settings to the generator. Adding a solve-only opt-out would leave
   a mandatory report instruction in the issue the solver receives.

The [regression evidence](evidence/regression-before.log.gz), recorded before the
implementation, shows 10 failures out of 11 initial tests. The missing boolean
definition, absent default paragraph, strict-parser rejection, missing tool
sections and discarded Telegram opt-out all fail independently. The final suite
also checks default inclusion and explicit omission through the issue creator's
actual `--body-file` contents. Strengthening that check caught a test-fixture
mistake: the initial mock looked for `--body`, which this repository does not use.
The corrected mock reads the published body file before it is removed.

## Requirements and solutions

| Requirement from the issue                                   | Implementation plan and verification                                                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--update-all-dependencies` enables reporting by default     | Resolve `reportDependenciesIssues ?? updateAllDependencies` in one shared helper. Verify dependency updates enable reporting in all six solver prompts.                                                                                 |
| `/fix` includes a reporting paragraph in the generated issue | Keep the shared paragraph unconditional with respect to `--deep-analysis`; control inclusion with the resolved reporting setting. Test the default body and preview the real CLI with `--dry-run`.                                      |
| Report general logic that belongs upstream                   | Name general logic explicitly in the paragraph; include it in both generated issues and solver reporting instructions.                                                                                                                  |
| Report duplicated code                                       | Explicitly ask for upstream feedback on duplicated code; verify the generated paragraph covers it.                                                                                                                                      |
| Report missing features                                      | Include feature proposals as well as bug fixes, rather than only update blockers.                                                                                                                                                       |
| Report bugs that lead to local workarounds                   | Preserve minimal reproducers and proposed code fixes; add affected versions and the actual workaround.                                                                                                                                  |
| Workarounds may stay to avoid blocking the PR                | State that necessary workarounds can remain and upstream fixes must not block the PR.                                                                                                                                                   |
| `--report-dependencies-issues` is independently controllable | Add a shared boolean solve definition, leaving its omitted value undefined. Verify opt-in without updates and opt-out during updates; use existing hive and Telegram solve validation.                                                  |
| Explicit opt-out works for `/fix`                            | Parse reporting options with the existing yargs factory and shared option definition before issue preparation. Preserve raw passthrough for the solve child. Test negative, equals-false, separate-false, and repeated-option ordering. |
| Compile issue data under `docs/case-studies/issue-{id}`      | Store all issue and PR comment surfaces, related implementation, research sources, regression evidence and this analysis under this directory.                                                                                          |
| Research online facts and existing components                | Consult primary documentation for lino-arguments, GitHub CLI, Dependabot and Renovate; record findings in [research-sources.json](research-sources.json).                                                                               |
| Propose solutions and plans for every requirement            | This matrix and [plan.md](plan.md) cover design, testing, release preparation and PR finalization.                                                                                                                                      |
| Complete everything in one PR                                | Include implementation, automated tests, translated documentation, example, evidence and Changeset in PR #2754; verify local and fresh remote checks.                                                                                   |

## Design and alternatives

The option has three input states: unspecified, explicitly true, explicitly false.
Unspecified inherits whether dependency updates are enabled. Explicit false must
remain distinct from unspecified. A normal `default: false` would erase that
distinction and make automatic activation impossible; a normal `default: true`
would request reporting on ordinary tasks that never opted into it.

Resolution occurs when building the reporting prompt. Keeping the raw omitted
value undefined also fits hive's existing forwarding logic: it skips unspecified
booleans and forwards `--no-...` for explicitly false booleans whose default is
undefined. No new hive forwarding implementation is needed.

The dependency-update prompt omits its report paragraph because the separate
reporting section provides the shared wording. This keeps a single reporting
section per system prompt and supports reporting without a dependency update.
Generated issue text retains the paragraph: it must be readable without a solve
session, including `--dry-run`, `--no-solve` and `/task` workflows.

`--no-report-dependencies-issues`, `--report-dependencies-issues=false`, and
`--report-dependencies-issues false` use the existing yargs boolean behavior.
Repeated switches follow the parser's ordering rules. `/fix` preserves those raw
arguments for solve and derives the same effective setting for the generated
issue. Telegram `/task` passes it to the issue generator and includes the negative
flag in its suggested solve command when disabled.

Alternatives considered:

- Keep reporting inside `--deep-analysis`: it cannot provide independent control
  and still omits the required generated-issue paragraph.
- Only add a solve flag: it cannot disable instructions already written into the
  generated issue, and `/task` would lose the preference at the handoff.
- Write another boolean argument scanner: yargs already parses negative forms,
  explicit values and ordering. Reusing it avoids a second parsing policy.
- Add a dependency update or issue-reporting service: unnecessary for this prompt
  feature. The existing AI tools perform analysis and can use upstream trackers;
  GitHub CLI already supports noninteractive issue creation and file-based bodies.
- Replace the workflow with Dependabot or Renovate: their documented purpose is
  version and lockfile update PRs. Inference: deciding which repository logic
  belongs upstream and proposing feature or bug reports still needs the solver's
  analysis; those tools remain complementary.

Reporting remains a solver instruction, consistent with the dependency-update
feature. This change does not enumerate every possible upstream issue itself or
promise that a third-party tracker accepts every submission. Existing unrelated
deep-analysis guidance retains its own behavior; the opt-out controls the
dependency-reporting instruction introduced here.

## Fresh CI investigation

The initial local freshness check reported 168/168 declarations current. The
first implementation run,
[Checks and release #37759757893](https://github.com/link-assistant/hive-mind/actions/runs/37759757893),
started at 09:53:24 UTC for `5ba4ccc9`, after that commit's 09:53:09 timestamp;
its [run metadata](data/checks-and-release-37759757893.json) records the head SHA and jobs.
It failed before feature tests ran: lines 2723–2727 of the
[preserved log](evidence/checks-and-release-37759757893.log.gz) report
165/168 current declarations and three stale Box 2.10.2 pins in `Dockerfile`,
`Dockerfile.dind` and `coolify/Dockerfile`, with no unresolved declarations.

[Box v2.10.3](https://github.com/link-foundation/box/releases/tag/v2.10.3) was
published at 09:38:56 UTC. Its [release snapshot](data/box-v2.10.3.json) and
[comparison with v2.10.2](data/box-v2.10.3-diff.json) show attachment file/MIME
support added to the essentials image chain and its image checks, with no runtime
installation changes. The authenticated local freshness check reproduces the
same three stale pins. An initial anonymous retry encountered GitHub API rate
limits; using the existing GitHub CLI credential resolves that access problem
without changing the gate.

The follow-up refreshes those three base-image pins to 2.10.3 and adjusts the
existing Docker pin/runtime test expectations. It also synchronizes the current
task-image metadata and the two existing image-verification scripts; historical
experiment baselines retain their original versions. The
[pin regression before the refresh](evidence/box-pins-before.log.gz) fails on
the old Dockerfile reference. The same test and the four related image tests
pass after the refresh (52 runtime assertions and 22 task-language assertions).
The [post-refresh freshness check](evidence/dependency-freshness-after-box-update.log.gz)
returns 168/168 current declarations. This follow-up is required by the repository's CI gate; the
dependency-reporting implementation remains the change requested by #2751.

## Reproduction and validation

The smallest offline reproduction exercises the generated issue body and all
prompt builders; it needs neither GitHub writes nor an AI execution:

```bash
node --test tests/report-dependencies-issues.test.mjs
node tests/test-fix-update-dependencies.mjs
node examples/dependency-reporting-preview.mjs
node examples/dependency-reporting-preview.mjs --no-report-dependencies-issues
```

The CLI can also be checked against a readable repository without creating an
issue or starting solve:

```bash
node src/fix.mjs link-assistant/hive-mind --update-all-dependencies --dry-run
node src/fix.mjs link-assistant/hive-mind --update-all-dependencies --no-report-dependencies-issues --dry-run
```

The focused regression suite covers solve/hive parsing, argument ordering,
generated issue inclusion and omission, mocked GitHub issue creation, six tool
prompt builders, `/fix` passthrough and the Telegram `/task` generator and solve
suggestion. It uses finite fixtures and five-second timeouts for the async cases.
The default suite discovers it through its `@hive-mind-test-suite default` marker.

Validation logs are saved locally under `ci-logs/` and compressed evidence is
stored in `evidence/`. All 579 default test files passed again after the Box
2.10.3 refresh; the complete
[default-suite log](evidence/default-tests.log.gz) preserves that result. The
final validation results are recorded in
[validation.json](validation.json). Documentation is updated in English,
Russian, Chinese and Hindi, and the Changeset prepares a minor release without
manually editing the package version.
