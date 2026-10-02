# Issue 2406: a correctly linked pull request could still merge with unfinished requirements

[Agent PR #326](https://github.com/link-assistant/agent/pull/326) merged after passing CI even though its own description left [Agent issue #322](https://github.com/link-assistant/agent/issues/322) unfinished. The [issue 2335 case study](../issue-2335/README.md) covers the first failure: the PR was not linked to its issue. [PR #2336](https://github.com/link-assistant/hive-mind/pull/2336) fixes that. This document covers the second failure, [split out on request](https://github.com/link-assistant/hive-mind/pull/2336#issuecomment-5948156787) into [#2406](https://github.com/link-assistant/hive-mind/issues/2406): automatic merging checked CI and mergeability, but never checked that the issue's requirements were done.

This change requires current completion evidence before every automated merge of an issue-scoped pull request. It gives every tool's prompts the same complete-delivery goal, keeps Codex goals enabled, and retries incomplete work automatically. The [operating guide](../../ISSUE_COMPLETION.md) explains the report and retry behavior.

## Evidence

The incident evidence comes from the same capture as #2335 and is kept in `../issue-2335/data` and inventoried by its [evidence manifest](../issue-2335/data/evidence-manifest.json). It includes:

- [Agent issue #322](../issue-2335/data/agent-issue-322.json) and the [PR description and conversation](../issue-2335/data/agent-pr-326.json).
- The [session log](../issue-2335/data/agent-pr-326-session.log).
- The [CI manifest](../issue-2335/data/agent-ci-manifest.json).

The completion-specific additions are:

- [completion-before.log](../issue-2335/data/completion-before.log): the gate reproduction failing before the fix.
- The [Codex goal schemas](../issue-2335/data/codex-ThreadGoalSetParams.json) and [notes](../issue-2335/data/codex-goals.md).
- The validation record [validation.json](../issue-2335/data/validation.json) with its compressed logs.

`node --max-old-space-size=256 experiments/issue-2335/verify-evidence.mjs` checks the inventory, hashes and links of both case studies.

## What remained incomplete in Agent #322

| Acceptance criterion                                                                      | State at merge                                                                                                                   | Evidence                                                                                         |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OpenTUI supports current `web-tree-sitter`.                                               | Blocked. OpenTUI 0.5.13 retains the exact 0.25.10 peer; the maintainer had confirmed 0.26+ was unsupported.                      | PR description; `opentui-issue-1201.json`, `opentui-pr-1203.json`, `opentui-latest-package.json` |
| Agent's bash parser loads the current WASM and passes bash tests.                         | Implemented locally, including permitted commands and denied chains/substitutions.                                               | Final JS CI, upstream experiment and diff                                                        |
| The packed Agent installs without peer warnings and its direct pin is upgraded to latest. | Blocked. Production stays at 0.25.10. The experimental 0.27.0 install intentionally expects an incorrect peer and `ELSPROBLEMS`. | Experiment script and README, final PR description                                               |

Green CI therefore verified a partial implementation and its documented incompatibility, not completion of all three criteria. A repaired link would not have changed that.

## Root causes and implementation

### 1. Merging did not ask whether the work was complete

Passing CI and GitHub mergeability were sufficient for an automated merge. Since #2336, a missing or unconfirmed issue link also blocks it, but a correctly linked partial PR still passes.

`issue-completion.lib.mjs` builds on the link check from #2336 (`issue-link-verification.lib.mjs`). It reads the same required issue scope once, and adds the issue bodies and comments plus all three PR feedback endpoints, with full pagination and retries. Malformed data and API failures block merging. The links are checked first. Then the requirements report in the description is checked:

- It must match the current head SHA and the digests of the requirement sources.
- It must list every explicit acceptance criterion.
- It must not have a missing, duplicate or foreign issue inventory, or entries that are unfinished or have empty evidence.

The shared `mergePullRequest` runs this check right before every actual merge, including the merge queue and retries. It also passes `--match-head-commit`, so a concurrent push cannot merge code that was not verified. Merges into non-default branches close all verified issues afterwards and report individual failures.

The report template never certifies success: it starts as `pending`. Explicit checkboxes and acceptance lists are the minimum required criteria; the agent must also inventory prose and feedback. Known automation bookkeeping is filtered out, so publishing a work log does not invalidate its own evidence. Human feedback that mentions automation still counts.

### 2. Completion was optional in prompts, and native goals were disabled

The incident log confirms `features.goals=false`. Complete delivery otherwise depended on optional finalize or restart switches, and the short Claude resume prompt had no persistent objective.

All six tools (Claude, Codex, Agent, OpenCode, Gemini and Qwen) now receive the same complete-delivery goal and report instructions in their initial and continuation prompts. The short Claude resume prompt keeps the objective. Every issue-scoped solve runs a bounded completion loop before readiness and merge handling, without optional flags. The loop:

- Repairs links and reads fresh verification.
- Continues work in the same PR and refreshes logs after each iteration.
- Leaves unresolved work unmerged.
- Stops safely after three consecutive read or tool failures, or on a usage limit.

Both Codex invocations (direct and agent-commander) explicitly enable goals, independent of the memory and auxiliary-call policies. The [official goals cookbook](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex) and the generated local 0.159.2 schema establish `thread/goal/set` as the native API. `codex exec --help` exposes no `--goal` flag. The prompts therefore ask the tool to use the supported API when it is exposed, and to keep a persistent plan when it is not.

### 3. Completion messages called unfinished work ready

The auto-merge-blocked comment said every merge requirement was satisfied and suggested a manual merge. When completion blocks the merge, the comment now asks for the remaining requirements and a refreshed report instead. Completion restarts are included in the final log attachment.

## Requirements of #2406

| Requirement                   | Delivered mechanism / evidence                                                                                                                    | Practical limit                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Prompts for every tool.       | Six initial and continuation prompt tests and a minimal resume regression (`tests/issue-completion-prompts-2335.test.mjs`).                       | Applications outside this repository are not controlled by these prompts. |
| Native goals.                 | Codex goals enabled in both adapters, independent of `--auxiliary-model-calls-disabled`; supported API instruction with persistent-plan fallback. | The current exec interface does not expose every app-server API.          |
| Completion evidence.          | Requirements report tied to the head SHA and source digests; standalone `issue-requirements-snapshot.mjs` template.                               | Agent-written evidence still needs review; see limits.                    |
| Merge guard.                  | Shared `mergePullRequest` guard, fail-closed reads, `--match-head-commit`, actual merge subprocess fixture.                                       | A body or feedback edit after the final read remains a race.              |
| Automatic completion retries. | `solve.issue-completion.lib.mjs` loop with failure and usage-limit caps.                                                                          | External blockers stay explicitly unfinished and the PR stays unmerged.   |
| Docs and tests.               | [Operating guide](../../ISSUE_COMPLETION.md) in four languages; 100% line, branch and function coverage of the focused modules.                   | Coverage is measured for the new modules, not the whole application.      |

## Reproduction and verification

```bash
node --test tests/issue-completion-2335.test.mjs
node --test tests/issue-completion-prompts-2335.test.mjs
node --test tests/issue-link-verification-2335.test.mjs
npm test -- --continue-on-failure
```

The fake GitHub fixture is finite, rejects unknown endpoints, requires pagination flags, and never merges a live PR. A subprocess imports the actual shared merge function. It proves that no merge command runs without completion evidence, then checks `--match-head-commit` on an allowed merge. The PR #326 replay stays blocked even after its closing link is repaired.

[validation.json](../issue-2335/data/validation.json) records the checks run before the split. They were run on the combined state of #2336, so it uses the old file names. [archive-validation.mjs](../../../experiments/issue-2335/archive-validation.mjs) and [archive-post-merge-validation.mjs](../../../experiments/issue-2335/archive-post-merge-validation.mjs) can regenerate it.

## Limits

A requirements report can be false, and a model can omit a prose requirement. Explicit criteria are mechanically mandatory; whether the prose inventory and evidence are true still needs review. Green CI, `done` text, 100% coverage or a native goal cannot prove that arbitrary natural-language requirements are met.

GitHub has no atomic transaction that locks the PR body, issue descriptions, comments and head together. `--match-head-commit` protects the code; an edit to the body or feedback after the final read remains a race. A human can still merge outside hive-mind. When verification fails, the merge stays blocked with actionable evidence; relaxing these conditions is not a workaround.

Agent #322 itself remains an upstream compatibility task ([OpenTUI #1550](https://github.com/anomalyco/opentui/issues/1550)). With this change, the solver keeps such a PR unmerged with its unmet criteria listed, instead of treating a preparatory patch as complete.
