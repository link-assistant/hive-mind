# Case Study: Issue #2033 — Default Claude Runs to Opus

## Overview

Issue [#2033](https://github.com/link-assistant/hive-mind/issues/2033) asks Hive Mind to use `--model opus` when `--tool claude` is selected and the user did not choose a model. The implementation changes the centralized Claude default from `sonnet` to `opus`; it does not remap either alias or remove any model.

## Requirements

1. Make `opus` the implicit model for `--tool claude`.
2. Keep explicit model choices, including `--model sonnet`, working.
3. Collect issue-related data in `docs/case-studies/issue-2033`.
4. Perform a deep analysis, list every requirement, research relevant facts and existing components, and propose and execute a solution for each requirement in PR [#2036](https://github.com/link-assistant/hive-mind/pull/2036).

## Evidence and root cause

The model registry in `src/models/index.mjs` is the single source of truth for per-tool defaults. Before this change, `defaultModels.claude` was `sonnet`. Both CLI configurations consume that registry:

- `src/solve.config.lib.mjs` uses it for `solve` argument parsing and recomputes the default when `--tool` is supplied without an explicit model.
- `src/hive.config.lib.mjs` uses it for the `hive` model option; `src/hive.mjs` performs the same tool-specific resolution before starting workers.

The previous Sonnet-default implementation in [PR #2004](https://github.com/link-assistant/hive-mind/pull/2004) deliberately kept `defaultModels.claude === 'sonnet'` and changed what the `sonnet` alias meant. That is not appropriate here: issue #2033 asks to default Claude runs to the existing `opus` alias. Changing only the default preserves `sonnet` as an explicit selection and avoids altering model identities.

The same centralized-default pattern was used for Codex in [PR #2029](https://github.com/link-assistant/hive-mind/pull/2029). No new library or configuration layer is needed.

Anthropic's model overview describes Opus and Sonnet as distinct model choices. Hive Mind already registers both aliases and maps `opus` to its current Opus model ID, so the requested behavior is a policy change rather than new model support. Source snapshot metadata is recorded in `data/research-sources.md`.

## Solution plan and execution

| Requirement | Solution                                                                                                                                      | Verification                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| R1          | Set `defaultModels.claude` to `opus`. Existing solve/hive consumers inherit it.                                                               | Regression test parses default `solve`, explicit `--tool claude`, and `hive --tool claude`.                       |
| R2          | Do not change `claudeModels`, model validation, plan-mode expansion, or escalation defaults.                                                  | Regression test asserts explicit `--model sonnet` remains `sonnet`. Existing model suites cover alias resolution. |
| R3          | Store raw issue comments and curated metadata/source records under `data/`.                                                                   | Files are committed with this case study.                                                                         |
| R4          | Document requirements, architecture, alternatives, related PRs, and test evidence here; add a changeset and synchronize user-facing defaults. | Documentation and changeset validation run in CI.                                                                 |

## Alternatives considered

- Remap `sonnet` to an Opus ID: rejected because it would make an explicit `--model sonnet` misleading and break alias semantics.
- Hard-code `opus` separately in solve and hive: rejected because it duplicates policy and risks the entry points drifting apart.
- Change `--plan` execution from Sonnet to Opus: rejected because plan mode explicitly defines an Opus planner and Sonnet worker; it is not an implicit Claude default.
- Remove Sonnet: rejected because the issue only changes the default and users must retain an explicit lower-cost model choice.

## Test-first reproduction

`tests/test-issue-2033-claude-default-model.mjs` was added before the implementation. On the original code it failed with `actual: 'sonnet', expected: 'opus'` at the centralized-default assertion. After the one-line registry change, it passes and also verifies both CLI entry points plus explicit override preservation.

## Data files

- `data/issue-2033.json` — curated issue metadata and complete issue body.
- `data/issue-2033-comments.json` — all issue comments (none at collection time).
- `data/pr-2036.json` — curated PR metadata at the start of implementation.
- `data/research-sources.md` — source URLs, access dates, and findings.
