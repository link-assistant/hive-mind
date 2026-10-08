# Requirements audit after review

The [review request](https://github.com/link-assistant/hive-mind/pull/2754#issuecomment-6063814951)
asks that every requirement be checked again. This audit compares the complete
[issue](data/issue-review.json), its [comments](data/issue-comments-review.json),
and all three PR comment surfaces with the implementation and executable tests.
The existing [analysis](README.md) retains the original reproducer, alternatives,
research, and solution plans. The refreshed snapshots also preserve the edited
PR description and the reported conflicts.

## Requirement coverage

| Requirement                                                        | Verified implementation and evidence                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Updating all dependencies enables reporting by default             | The shared resolver inherits `updateAllDependencies` only when reporting is unspecified. All six solver prompt builders include exactly one reporting section. Ordinary tasks remain off unless explicitly enabled.                                             |
| `/fix` includes a reporting paragraph in its generated issue       | The issue builder includes the shared paragraph independently of `--deep-analysis`. The mocked issue creator checks the actual `--body-file` contents. The real `/fix --dry-run` output includes the paragraph.                                                 |
| Report general logic that belongs in a dependency                  | The shared paragraph explicitly names general logic; the issue-body regression verifies that wording.                                                                                                                                                           |
| Report duplicated code                                             | The same shared paragraph explicitly names duplicated code; the issue-body regression verifies it.                                                                                                                                                              |
| Report missing features                                            | The paragraph names missing features and permits a feature proposal alongside suggested code fixes.                                                                                                                                                             |
| Report bugs that cause workarounds                                 | Instructions require an upstream report with a minimal reproducer, affected versions, the workaround, and a suggested fix. Existing upstream reports are searched first; reports are linked from the PR.                                                        |
| Keep workarounds to avoid blocking the PR                          | The paragraph explicitly permits necessary local workarounds and says upstream fixes must not block the PR. The regression verifies both concepts.                                                                                                              |
| Provide independent control through `--report-dependencies-issues` | The shared solve option accepts opt-in without an update, negative flags, equals-false, separate-false, and repeated switches in order. Six tool tests cover opt-in and opt-out with deep analysis.                                                             |
| Disable reporting separately during dependency updates             | `/fix` uses the resolved setting for issue preparation and preserves the raw arguments for solve. The real opt-out dry run omits the paragraph. Dependency-update instructions remain enabled.                                                                  |
| Preserve control through supported handoffs                        | Seven cases run the real `/hive` entry point against its existing offline collaborators and check the command passed to the solver. Telegram's generator, generated body, and suggested solve command are checked together for the same seven choices.          |
| Collect data under `docs/case-studies/issue-{id}`                  | This directory contains original and refreshed issue/PR snapshots, online research, related PR snapshots, the failed reproducer, complete compressed logs, plans, and validation records.                                                                       |
| Research online facts and existing components                      | The primary sources below were revisited. The existing lino-arguments parser, shared option registration, issue creator, and six prompt builders supply the required components. Related merged PRs #2214 and #2265 remain documented in the original analysis. |
| Analyze requirements and propose solutions and plans for each      | The original requirements matrix and alternatives explain the selected design. This audit maps every requested behavior to implementation and verification; `plan.md` tracks finalization.                                                                      |
| Complete all work in one PR                                        | Implementation, translated documentation, example, Changeset, regression tests, and both audit phases are included in PR #2754. Current validation is recorded in `review-validation.json` and the PR checks.                                                   |

Reporting is an instruction to the solving tool, matching the existing
dependency-update feature and the issue's requested generated paragraph. The
option controls this dedicated instruction. Existing `--deep-analysis` guidance
for bug-typed issues and `--prompt-issue-reporting` guidance for unrelated issues
retain their separate behavior, including their existing report instructions.
This audit does not claim that an upstream tracker accepts every report or that
the solver discovers every possible dependency defect.

## Additional verification

The original reporting suite still passes all 13 tests. Its Telegram test now
checks default reporting, explicit opt-in, all three opt-out spellings, and both
orders of repeated positive/negative switches. Each case verifies the generated
issue body and parses the suggested solve command to prove that its effective
setting agrees with the generator.

Seven additional cases reuse the offline fixture in
`experiments/issue-2685/`. They run the production hive parser, scheduler, and
argument forwarder through a spawned solver. The default preserves the omitted
reporting value and forwards dependency updates; explicit choices reach the
child as the corresponding positive or negative reporting flag. Together, the
two affected suites pass 46 tests. No new runtime defect was found in the
reporting implementation.

## Merge conflicts

The updated default branch is `3466bca1` (version 2.34.3). Its changes include
Codex process diagnostics from merged PR #2746 and the same Box 2.10.3 base pins.
The three Docker conflicts concern comments: the default branch's comments
correctly describe attachment validation and runtime replacement when base and
pin differ. They are retained in full. Both case-study exclusions are retained
in `.prettierignore`. The merge preserves history and the new Codex behavior;
the complete default suite validates both features together.

## Primary-source research and dependency freshness

- [lino-arguments](https://github.com/link-foundation/lino-arguments) documents
  the existing yargs integration and configuration precedence. The regression
  tests verify this repository's exact boolean behavior.
- [GitHub CLI issue creation](https://cli.github.com/manual/gh_issue_create)
  supports repository selection and file-based issue bodies, which the existing
  issue creator already uses.
- [Dependabot](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependabot-version-updates)
  and [Renovate](https://docs.renovatebot.com/) document automatic dependency
  update PRs. Inference: these remain complementary to the solver's analysis of
  logic, feature gaps, and workaround-causing bugs.

The authenticated freshness check reproduced four stale declarations after
the merge: both Sentry package ranges and both lockfile entries remained at
11.5.0 (lines 2–5 of `evidence/review-freshness-before.log.gz`).
[Sentry 11.6.0](https://github.com/getsentry/sentry-javascript/releases/tag/11.6.0)
was published at 15:12:09 UTC on October 8, after the previous PR checks. Its
release notes describe telemetry clock fixes and Node listener fixes; both npm
packages retain a Node engine range compatible with this repository. The native
profiler dependency remains `^2.4.4`. Release and npm metadata are preserved in
`data/sentry-*.json`.

The follow-up refreshes the two Sentry packages together and synchronizes the
existing dependency-pin regression. npm changes only seven aligned Sentry
packages in the lockfile; the native profiler and unrelated packages retain
their versions. The pin regression fails against 11.5.0 before the refresh and
passes afterward. `experiments/issue-2751/sentry-upgrade-smoke.mjs` verifies SDK
initialization, the native profiling integration, a span callback, and clean
shutdown using an in-memory transport. It passes before and after the upgrade.
The reporting implementation needs no changes. Before/after freshness and
pin-regression logs, plus the final complete default-suite log and local checks,
are preserved in `evidence/review-*.log.gz`.
