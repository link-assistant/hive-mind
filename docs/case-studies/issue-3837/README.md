# Issue #3837: resource-aware solver prompts

The solver prompts required every test to run locally even when CI already provided that coverage. The fix replaces that conflict with shared preferences for focused validation, awareness of compilation costs, and minimal local CPU, memory, and disk use. Existing CI and complete-delivery requirements remain in place.

## Requirements and evidence

The [complete issue snapshot](data/issue.json) is the source of this inventory. There were no issue comments, required sub-issues, PR conversation comments, inline comments, or reviews when research began; the four comment/review snapshots and the empty sub-issue response are in `data/`.

| Requirement                                                                  | Solution and plan carried out                                                                                                                                                     | Verification                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Prefer single specific local tests when full suites already run in CI        | Add one shared preference to all six backend builders                                                                                                                             | Six backend regression cases render default and workspace/visual profiles                                                 |
| A selected test should not silently cause full source compilation            | Tell the solver to inspect command build behavior before running it                                                                                                               | Each backend case checks the build-cost instruction; Cargo research explains why name filtering is insufficient           |
| Include resource mindfulness in the solver's self-description                | Append one shared identity sentence favoring minimal local CPU, memory, and disk use                                                                                              | Assert the first rendered line for every backend; check all four translated intros                                        |
| Leave CPU-intensive full suites and builds to existing CI/CD                 | Prefer current-commit CI evidence and avoid unnecessary local repetition                                                                                                          | Each backend case checks current-commit evidence and the exception for user requirements or uncovered failures            |
| Suggest the project's CI/CD practices when adding coverage was not requested | Include the exact best-practices link in the shared validation paragraph                                                                                                          | Assert one link and the requested-work exception in every rendered prompt                                                 |
| Let the owner decide about adding CI while continuing required work          | State the owner's decision and completion of validation with available resources                                                                                                  | Backend assertions and translated-owner assertions; no workflow changes or new approval mechanism                         |
| Be concise, use preferences, avoid duplicated instructions                   | Remove repeated reproduction rules, API endpoint examples, CI todo reminders, PR reminders, and obvious planning/division advice; replace blanket verbosity with targeted tracing | No verbatim duplicated conditional bullets in the twelve rendered prompts; before/after size audit below                  |
| Check system-message size                                                    | Render fixed profiles for every backend and measure UTF-8 bytes, Unicode characters, and whitespace-delimited words                                                               | Reusable `experiments/issue-3837-prompt-size.mjs`; raw before/after JSON in `data/`; test prevents exceeding the baseline |
| Collect data, conduct a deep case study and online research                  | Preserve issue/review evidence, baseline source locations, failed/passing tests, size data, and primary-source research here                                                      | This report, [source audit](data/source-audit.json), and [research notes](data/research.json)                             |
| List each requirement, options, plans, and existing components               | Inventory above; alternatives and component review below                                                                                                                          | Full implementation spans all six builders and English, Russian, Chinese, and Hindi catalogs                              |
| Deliver everything in this PR                                                | One shared implementation, regression coverage, translations, release Changeset, and review documentation                                                                         | PR #3838; final validation recorded below and in its description                                                          |

## Timeline and root cause

- 2026-10-28: read issue #3837 and every available comment/review endpoint for PR #3838. The prepared branch started at `976a5a95a10a74f3f85feca2ef94a22afe80e2ca`.
- Traced prompt rendering through the direct backend modules and `agent-commander.lib.mjs`. Both routes use the same six builders. The locale catalogs retain equivalent prompt templates but are not used to build the current backend system text; the working-language directive is appended separately.
- Found unconditional full-local-suite instructions in all six builders and all four catalogs. Claude, Codex, Gemini, and the catalogs also required local CI checks before commits without considering their cost. The workspace logging example recommended `npm test`, encouraging a full-suite invocation even for small changes.
- Added a focused reproducer and rendered the original source. All ten cases failed on the conflicting instructions; [the failed output](data/test-before.log) records assertion failures rather than build or dependency errors.
- Added shared resource preferences, removed the conflicting lines, aligned catalogs, and trimmed repeated advice. All ten regression cases pass; [passing output](data/test-after.log) is preserved.

The root cause was contradictory static guidance copied across backend-specific templates. The existing small-function testing advice did not qualify the later demand to run every test locally. Fixing only one backend, or appending a preference while leaving that demand intact, would preserve the conflict. The shared component is inserted once at the validation section; the identity sentence is shared separately so it appears in each solver's first line.

The test and audit resolve use-m's pinned imports from already installed packages, avoiding a remote loader bootstrap. An initial development probe using plain `import(specifier)` could not resolve version-suffixed package names; correcting that harness produced the recorded behavioral failures on the unchanged baseline. No runtime dependency change was necessary.

## Options and existing components

| Option/component                                                                                                       | Assessment and decision                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change only the self-review line                                                                                       | Too narrow: pre-commit instructions, workspace examples, and other backends would still encourage costly local work                                              |
| Append guidance without removing contradictions                                                                        | Retains competing instructions and increases prompt size; rejected                                                                                               |
| Rewrite every solver into one generic prompt                                                                           | Could erase backend-specific behavior; unnecessary for this issue                                                                                                |
| Existing shared subprompts such as `issue-completion.prompts.lib.mjs` and `report-dependencies-issues.prompts.lib.mjs` | Reuse their small import-and-interpolate pattern for `resource-aware-testing.prompts.lib.mjs`                                                                    |
| Existing `node:test` and suite discovery                                                                               | Use these for offline regression coverage; mark the new file for the default CI suite, without changing CI or package scripts                                    |
| Node test-file/name selection and concurrency controls                                                                 | Suitable existing facilities for cheap focused tests; no new test framework needed                                                                               |
| Cargo test filtering and job controls                                                                                  | Useful counterexample: choosing a test name still allows compilation. Keep the prompt language tool-neutral rather than prescribing a supposedly cheap command   |
| Tokenizer libraries such as `tiktoken`                                                                                 | Unnecessary dependency and model-specific tokenization for a six-provider audit. Measure exact bytes/characters/words and explicitly avoid claiming token counts |
| Existing CI/CD guide and pipeline templates                                                                            | Link the existing guide when coverage is missing; leave additions to the repository owner. Do not install a new pipeline in this prompt change                   |

Recent related work was reviewed: [PR #2851](https://github.com/link-assistant/hive-mind/pull/2851) requires solvers to resolve pre-existing CI failures, and [PR #2754](https://github.com/link-assistant/hive-mind/pull/2754) shares dependency-reporting guidance across all backends. Their descriptions are preserved in `data/`. The fix preserves CI completion, full issue delivery, reproduction evidence, screenshot guidance, native goal usage, and all optional prompt sections.

## Primary-source research

- [OpenAI prompt-generation documentation](https://developers.openai.com/api/docs/guides/prompt-generation) supports specific, concise instructions and avoiding unnecessary guidance while preserving task requirements. Applying that to the conflicting rules is our design inference, not a measured improvement in model behavior.
- [Node's test-runner documentation](https://nodejs.org/api/test.html) documents selected files, name filters, and concurrency controls. The regression uses the existing runner with small string-rendering cases.
- [Cargo's test command](https://doc.rust-lang.org/cargo/commands/cargo-test.html) documents compilation and filtering of the resulting test binaries. A name filter alone does not establish a cheap local run; this is why the new prompt asks about compilation before executing the command.

These sources were opened on 2026-10-28; concise findings and application notes are preserved in [research.json](data/research.json). The repository's [CI/CD best-practices guide](../../CI-CD-BEST-PRACTICES.md) supplies the adoption recommendation.

## Prompt-size audit

The experiment renders the six production builders using fixed synthetic repository identifiers. `default` uses no optional sections; `workspace-visual` enables a workspace, vision, Playwright guidance, and the additional requirements reminder. Other opt-in sections remain untouched. Only the generated system text is measured; the provider's own system instructions, user prompt, and tokenizer are outside this measurement.

| Backend  | Default bytes before | Default bytes after | Reduction | Workspace/visual bytes before |  After | Reduction |
| -------- | -------------------: | ------------------: | --------: | ----------------------------: | -----: | --------: |
| Agent    |               11,407 |              10,896 |      4.5% |                        15,894 | 15,382 |      3.2% |
| Claude   |               14,408 |              13,327 |      7.5% |                        18,911 | 17,829 |      5.7% |
| Codex    |               13,711 |              12,630 |      7.9% |                        17,077 | 15,995 |      6.3% |
| Gemini   |               11,915 |              10,982 |      7.8% |                        14,311 | 13,377 |      6.5% |
| OpenCode |               11,624 |              11,113 |      4.4% |                        16,112 | 15,600 |      3.2% |
| Qwen     |               11,348 |              10,837 |      4.5% |                        15,847 | 15,335 |      3.2% |

[Before](data/prompt-size-before.json) and [after](data/prompt-size-after.json) also record characters, words, duplicate conditional bullets, and hashes. Each rendered prompt is smaller despite including the new preferences. The audit does not estimate tokens or claim measured CPU savings from a live AI session.

## Reproduction and validation

```sh
node --max-old-space-size=96 --test tests/resource-aware-prompts-3837.test.mjs
node --max-old-space-size=96 experiments/issue-3837-prompt-size.mjs
```

To reproduce the original failure, run the regression against the six builder files and four locale catalogs from baseline commit `976a5a95a10a74f3f85feca2ef94a22afe80e2ca`, retaining the new test and size fixture. All ten cases fail on unconditional local-validation guidance. With this change they all pass, including both prompt profiles, translated catalogs, uniqueness, byte-size reductions, complete-delivery wording, and CI requirements.

Local checks use a 96 MiB Node heap limit and run sequentially because this container has a shared 2.92 GiB memory limit. Dependencies were installed from the lockfile with lifecycle scripts disabled. The full default and integration suites already run in the repository's CI; this change uses focused local checks and current-commit CI evidence for the broad checks. The final PR description records CI results.

Focused local verification passed: 10 new regression cases, 26 i18n cases (including locale key parity), 140 thinking-prompt cases, the screenshot/case-study prompt check, and the existing no-progress/CI-completion regression. ESLint on changed source and tests, Prettier on changed JavaScript/Markdown/JSON, file line limits, and `git diff --check` passed. The latest default branch and automated development-log commits were merged without conflicts.
