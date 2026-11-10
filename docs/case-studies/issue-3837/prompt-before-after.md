# Prompt wording before and after

This comparison addresses the [review request](https://github.com/link-assistant/hive-mind/pull/3838#issuecomment-6474498697). “Before” is the original issue baseline, `976a5a95a10a74f3f85feca2ef94a22afe80e2ca`. “After” is the implemented prompt wording in this PR. The comparison renders the production builders in English, so moving a template from JavaScript to Lino does not count as a wording change.

Across Agent, Claude, Codex, Gemini, OpenCode, and Qwen, each default system prompt has **9 added/replacement lines and 18–20 removed/replaced lines**. The workspace/visual and all-options profiles each have one extra replacement for the logging example. All 18 user-prompt renderings are byte-identical to the original baseline. This documentation follow-up preserves the existing implementation's wording; all 24 pre-extraction English corpus hashes still match.

## Resource preferences

Before, the identity named the solver without a resource preference. For example:

```text
You are an AI issue solver using OpenAI Codex.
```

After, each backend keeps its own identity and appends exactly one shared sentence:

```text
You are an AI issue solver using OpenAI Codex. Prefer minimal local CPU, memory, and disk use during development.
```

Before, every backend required the following self-review step:

```text
   - When you check your solution draft, run all tests locally.
```

Claude and Codex additionally required local CI checks before every commit/push, and Gemini had a shorter version of that instruction:

```text
   - When you are about to commit or push code, run local CI checks first if they are available in contributing guidelines (like ruff check, mypy, eslint, etc.) to catch errors before pushing.
```

After, those unconditional requirements are removed. The testing section contains these four shared preferences, once per rendered system prompt:

```text
   - When implementing changes, prefer drafting code for all requirements before starting verification, then use focused checks and existing CI/CD coverage.
   - When validating changes, prefer a single relevant test or small focused checks; check whether the command triggers a full source build before running it.
   - When CI/CD already covers full test suites or CPU-intensive builds, prefer leaving those to CI/CD and checking results for the current commit; avoid duplicating them locally unless user requirements or uncovered failures call for it.
   - When CI/CD coverage is missing and adding it was not requested, suggest https://github.com/link-assistant/hive-mind/blob/main/docs/CI-CD-BEST-PRACTICES.md; let the repository owner decide whether to add it, and meanwhile complete required validation with available resources.
```

These cover the issue's bulk-drafting, focused-testing, compilation-cost, existing-CI, and owner-decision requirements. They allow required local work and additional validation for uncovered failures. Existing requirements to pass CI, fix failures already present on the default branch, reproduce bugs, and finish every issue/sub-issue remain in the prompts.

## Other wording edits

These are the remaining changes visible in the rendered diffs. They implement the issue's request to reduce duplication and obvious advice while limiting changes to the affected guidance.

| Area                           | Before                                                                                                                                                                                                           | After and reason                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diagnostic verbosity           | `When facing a complex problem, do as much tracing as possible and turn on all verbose modes.`                                                                                                                   | `When diagnosing a complex problem, prefer targeted tracing and enable verbose output only where useful.` Avoid unnecessary local output and work.                                           |
| Planning                       | `When you start, create a detailed plan for yourself and follow your todo list step by step. Add as many relevant points from these guidelines to the todo list as practical so you can track the work clearly.` | `When you start, outline the work and track requirements and verification in your plan.` Preserve planning with less boilerplate.                                                            |
| Small tests                    | `When you test:` followed by small-function scripts and mocked-unit-test advice; then `When you test integrations, use existing framework.`                                                                      | `When writing tests, prefer small cases with mocks and the existing integration framework.` Combine overlapping advice.                                                                      |
| Bug reproduction               | Four overlapping instructions: create a reproducer when an issue is solvable, reproduce before fixing a bug, write a failing test for logic bugs, and prefer a minimal reproducer.                               | `When fixing a bug, prefer a minimal regression test that fails before the fix and passes afterward.` The existing requirement that a fix without a reproducing test is incomplete remains.  |
| Workspace logging example      | `When saving command output with stderr:` followed by `npm test 2>&1 \| tee /tmp/work/test-output.log`                                                                                                           | `When saving focused-check output, redirect stdout and stderr to /tmp/work/test-output.log.` Keep logging without suggesting a full suite. The directory still comes from `workspaceTmpDir`. |
| Repeated CI todo reminder      | Claude, Codex, and Gemini repeat the CI investigation steps in the planning section.                                                                                                                             | Remove that reminder; keep the existing detailed CI log investigation protocol.                                                                                                              |
| Repeated GitHub API examples   | Four generic CLI examples repeat the review-comment, conversation-comment, review, and issue-comment endpoints.                                                                                                  | Remove the generic duplicates; retain the repository-specific endpoints and pagination instruction in the research section.                                                                  |
| Repeated PR reminder           | Five backends repeat that the prepared PR already exists.                                                                                                                                                        | Remove the later duplicate; retain the existing-PR instruction in the workflow section. Gemini already had no duplicate.                                                                     |
| Obvious problem-solving advice | `When you face something extremely hard, use divide and conquer.`                                                                                                                                                | Remove the line; keep concrete planning and research instructions.                                                                                                                           |

## Catalog migration

The larger source diff also implements the [earlier localization review](https://github.com/link-assistant/hive-mind/pull/3838#issuecomment-6468133471): templates move into `locales/prompts/system/` for system instructions and `locales/prompts/` for other AI messages; UI messages move to `locales/`. Builders retrieve those templates using the work locale. Existing translated text is reused, with English fallback for missing translated keys.

That relocation adds no further English wording edits: the existing regression compares **24/24 pre-extraction backend outputs**, and a separate corpus compares **12/12 live-feedback/intervention outputs**, byte for byte. The recursive locale adapter changes catalog loading; its upstream report is [link-foundation/lino-i18n#35](https://github.com/link-foundation/lino-i18n/issues/35). Upstream 0.5.0 now supports recursion, and this PR uses that release. The strict merger remains to reject conflicting definitions instead of upstream's last-file-wins policy.

## Complete rendered diffs and sizes

Each diff below includes default, workspace/visual, and all-options profiles, with system and user messages. `-` lines are the original rendered wording; `+` lines are the final wording. Identical user messages are explicitly identified. The all-options profile also exercises fork screenshots, continuation feedback, development logs, dependency reporting, architecture, handoff, and deep analysis.

| Backend  | Rendered diff                                      | Default UTF-8 bytes before → after | Reduction |
| -------- | -------------------------------------------------- | ---------------------------------: | --------: |
| Agent    | [agent.diff](data/rendered-diffs/agent.diff)       |                    11,407 → 11,053 |      3.1% |
| Claude   | [claude.diff](data/rendered-diffs/claude.diff)     |                    14,408 → 13,484 |      6.4% |
| Codex    | [codex.diff](data/rendered-diffs/codex.diff)       |                    13,711 → 12,787 |      6.7% |
| Gemini   | [gemini.diff](data/rendered-diffs/gemini.diff)     |                    11,915 → 11,139 |      6.5% |
| OpenCode | [opencode.diff](data/rendered-diffs/opencode.diff) |                    11,624 → 11,270 |      3.0% |
| Qwen     | [qwen.diff](data/rendered-diffs/qwen.diff)         |                    11,348 → 10,994 |      3.1% |

[summary.json](data/rendered-diffs/summary.json) records before/after byte counts, hashes, and changed-line counts for all 36 renderings. Workspace/visual prompts shrink by 2.2–5.4%; all-options prompts shrink by 1.6–4.0%. These are byte measurements, not tokenizer counts or measured runtime savings.

Reproduce from this branch after installing its locked dependencies:

```sh
node --max-old-space-size=96 experiments/issue-3837-before-after.mjs /tmp/issue-3837-before-after
node --max-old-space-size=96 --test --test-concurrency=1 tests/resource-aware-prompts-3837.test.mjs tests/prompt-catalogues-3837.test.mjs
```

The comparison exports the baseline's sources into a temporary directory, renders both versions in separate bounded-heap processes, checks the original size/hash fixtures and pre-extraction corpus, writes six unified diffs, and removes the temporary sources. It invokes no solver, compilation, or full test suite. Only repository paths and the Node executable path are normalized in generated prompt text.
