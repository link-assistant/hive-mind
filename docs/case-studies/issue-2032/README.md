# Issue 2032 Case Study: Omitted `--think` Means Off

## Summary

Issue 2032 requires Hive Mind to treat an omitted `--think` option exactly like
`--think off` and make the strongest available effort to disable or minimize
thinking for every tool. It also requires a complete requirement inventory,
raw research data, online research, analysis of reusable components, and
solution alternatives in this directory.

The root problem was a split contract: the parser returned `undefined`, Codex
independently mapped that absence to `none`, older Claude models received a
zero token budget, and the remaining adapters merely omitted a positive prompt
hint. Callers could not rely on one canonical default, and adaptive-only Claude
models inherited their provider's relatively high default effort.

The implemented contract normalizes omission to `think: 'off'`. Codex maps it
to `model_reasoning_effort=none`; Claude uses a zero thinking budget where that
control is supported and `CLAUDE_CODE_EFFORT_LEVEL=low` where disabling
adaptive thinking is unsafe or impossible. Other adapters receive the same
canonical off value without a positive thinking prompt; no portable structured
off control exists across their current model/provider combinations.

## Requirements

- R1: Treat no `--think` argument as `--think off`.
- R2: Apply that default to all tools (`claude`, `codex`, `agent`, `opencode`,
  `gemini`, and `qwen`, including related execution paths).
- R3: Make the best effort per tool: disable thinking, set a zero budget,
  configure an explicit no-reasoning mode, or select the lowest supported
  effort.
- R4: Preserve explicit `--think` values.
- R5: Preserve explicit `--thinking-budget` as an alternative control; the new
  implicit default must not override it.
- R6: Collect issue and related-work data in
  `docs/case-studies/issue-2032/`, research current upstream behavior online,
  enumerate all requirements, identify reusable components/libraries, and
  propose solutions and plans for each requirement.
- R7: Plan and execute the complete solution in PR 2035.

## Evidence and Root Cause

Before the fix, `SOLVE_OPTION_DEFINITIONS.think.default` was `undefined`.
`parseArguments()` passed that value through, so omission was not represented
as off. Downstream behavior then diverged:

- Codex's existing `resolveCodexReasoningEffort()` returned `none` for an
  absent value, but labelled the source `default` rather than `--think off`.
- Claude's `getClaudeEnv()` already emitted `MAX_THINKING_TOKENS=0` for models
  that accept manual budgets. For adaptive-only models it removed that
  variable and emitted no effort override, allowing the provider default.
- Agent/OpenCode/Gemini/Qwen prompt builders only add positive thinking words
  for supported model/tool combinations. They have no shared provider-neutral
  structured reasoning switch.

The official Anthropic documentation says adaptive-thinking effort is soft
guidance and `low` minimizes thinking; some always-adaptive models reject a
disabled configuration. The official Codex source exposes an explicit `none`
reasoning effort. Details and URLs are recorded in
`data/upstream-source-notes.md`.

## Requirement-to-Solution Plan

| Requirement    | Solution                                                                                                                           | Verification                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| R1/R2          | Set the shared parser default to `off`, making every adapter receive the same canonical value.                                     | Parse an omitted flag for a non-Codex tool and assert `think === 'off'`.                                 |
| R3/Codex       | Reuse `resolveCodexReasoningEffort`; its existing `off` mapping emits `none`.                                                      | Assert omitted parsing produces `{ reasoningEffort: 'none', source: '--think off' }`.                    |
| R3/Claude      | Reuse `resolveThinkingSettings` and `getClaudeEnv`; emit budget `0` where supported, otherwise the lowest adaptive effort (`low`). | Assert Haiku gets `MAX_THINKING_TOKENS=0` and adaptive Sonnet gets effort `low` without a manual budget. |
| R3/other tools | Pass canonical `off` through existing prompt gating; do not invent unsupported provider flags.                                     | Existing prompt-gating tests plus the parser regression prevent positive hints.                          |
| R4             | Keep yargs choices and explicit-value precedence unchanged.                                                                        | Assert explicit `--think medium` remains `medium`.                                                       |
| R5             | Detect an explicit `--thinking-budget` and clear only the implicit `think: off` default.                                           | Assert budget `16000` still resolves to Codex `medium`.                                                  |
| R6/R7          | Store raw issue/comments, related PR metadata, upstream notes/source, analysis, test, changeset, and PR description.               | Repository/PR review and CI.                                                                             |

## Alternatives Considered

- Keep `undefined` and teach every adapter to interpret it as off. Rejected:
  this preserves the divergent internal contract and makes new execution paths
  easy to miss.
- Default `--thinking-budget` to zero. Rejected: the budget is an alternate
  explicit input, and a global default would conflict with explicit positive
  `--think` levels and tools that use effort rather than token budgets.
- Set `MAX_THINKING_TOKENS=0` for every Claude model. Rejected: current
  adaptive-only models may ignore or reject manual-budget/disabled thinking
  controls.
- Force a guessed `--reasoning none` option into Agent, OpenCode, Gemini, and
  Qwen. Rejected: these wrappers span heterogeneous providers and models; no
  one supported option has portable semantics. Canonical off plus existing
  model-aware prompt gating is safer than passing invalid flags.
- Use a prompt such as “do not think.” Rejected as the primary control because
  structured CLI/API controls are stronger and prompts cannot guarantee hidden
  model behavior. Prompt fallback remains appropriate only when a known model
  supports no structured control.

## Existing Components Reused

- `SOLVE_OPTION_DEFINITIONS` and `parseArguments()` as the single CLI contract.
- `resolveCodexReasoningEffort()` for Codex structured effort mapping.
- `resolveThinkingSettings()`, `getClaudeEnv()`, and Claude model-capability
  predicates for budget/effort selection.
- `getThinkingPromptInstruction()` and each adapter's existing prompt builder
  for safe model-aware prompt gating.
- The default test-suite marker and Changesets release workflow.

No new dependency or external library is needed; the defect is normalization
and capability mapping within existing components.

## Reproduction and Verification

`tests/test-issue-2032-default-think-off.mjs` is the minimum regression. Before
the fix it failed with `actual: undefined`, `expected: 'off'`. It now covers
omission, explicit level precedence, explicit budget precedence, Codex `none`,
Claude zero budget, and Claude adaptive-low fallback.

Focused verification:

```bash
node tests/test-issue-2032-default-think-off.mjs
node tests/test-codex-support.mjs
node tests/test-claude-think-prompt-gating.mjs
```

The full default suite, lint, format, syntax, line-limit, changeset validation,
and diff checks are run before PR finalization.

## Source Data

- `data/issue-2032.json`: authenticated issue metadata and body.
- `data/issue-2032-comments.json`: complete issue comments (empty at research
  time).
- `data/pr-2029.json`: metadata for the most recent directly related merged PR.
- `data/openai-codex-config-types.rs`: upstream reasoning/config type snapshot.
- `data/upstream-source-notes.md`: official source URLs and extracted findings.
