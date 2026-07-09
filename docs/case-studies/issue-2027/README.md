# Issue 2027 Case Study: GPT-5.6 Sol Default and Predictable Thinking Levels

## Summary

Issue 2027 asks hive-mind to make `gpt-5.6-sol` the default model for
`--tool codex`, to confirm every other Codex model stays supported, and to make
the thinking/effort levels predictable and consistent across both `codex` and
`claude`. It also asks that, by default, both tools run the model as-is with no
thinking level enforced.

The change flips the Codex default from `gpt-5.5` to `gpt-5.6-sol`, keeps the
full existing model catalog and its runtime fallback chain, and introduces a
predictable identity mapping from hive-mind's unified `--think` scale to Codex
reasoning efforts (`low`/`medium`/`high`/`xhigh`/`ultra`/`max`). GPT-5.6 Sol's
multi-agent `ultra` mode is always paired with a `rollout_token_budget` cap. The
Claude side gains matching `ultra`/`xhigh` levels so the two tools line up. When
no `--think` level is given, both tools emit no reasoning enforcement.

## Requirements

- R1: Set `gpt-5.6-sol` as the default model for `--tool codex` (previously
  `gpt-5.5`).
- R2: Double-check that every other available Codex model stays fully supported.
- R3: Make the thinking/effort levels predictable across `low`, `medium`,
  `high`, `xhigh`, `ultra`, and `max` for Codex.
- R4: Do the same for `--tool claude`, whose `ultracode` level matches `ultra`
  thinking.
- R5: By default, both `claude` and `codex` run the model as-is, with no thinking
  level enforced (switched off, or lower than `low`).
- R6: Collect research data under `docs/case-studies/issue-2027/`, analyze each
  requirement, propose a solution per requirement, and check for existing
  components/libraries before writing new code.

## Findings

- The local `codex debug models` catalog (`codex-cli 0.142.5`) lists `gpt-5.5`,
  `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.2`, and hidden
  `codex-auto-review`, each supporting reasoning efforts
  `low`/`medium`/`high`/`xhigh`. The catalog does not yet expose the GPT-5.6
  preview models.
- hive-mind's Codex model registry already accepts the GPT-5.6 Sol/Terra/Luna
  IDs (added in issue 1992), in both plain and Bedrock-prefixed forms, so R1 only
  needs a default flip plus fallback/primary ordering updates, not new model
  validation.
- The OpenAI GPT-5.6 Sol preview extends the reasoning ladder: it keeps
  `xhigh`, adds `max` above it for the deepest single-agent effort, and adds an
  `ultra` multi-agent mode. `none` disables reasoning entirely.
- OpenAI's guidance is that `ultra` must always be paired with a
  `rollout_token_budget` cap, because the multi-agent fan-out is otherwise
  unbounded. The recommended default cap is `500000`.
- The Claude effort side already supported `low`/`medium`/`high`/`xhigh`/`max`
  via `CLAUDE_CODE_EFFORT_LEVEL`, and the thinking-prompt layer already had an
  `Ultrathink.` message, so R4 mainly needs the `ultra` level threaded through
  the shared choices, prompt gating, and budget mapping.

## Root Cause

There was no single defect; the issue is an enhancement with several gaps:

- `defaultModels.codex` was pinned to `gpt-5.5`, and the fallback/primary
  ordering did not lead with `gpt-5.6-sol`.
- The Codex `--think` mapping did not cover `xhigh`, `ultra`, or `max`, and had
  no plumbing for the `rollout_token_budget` cap that `ultra` requires.
- The unified `--think` choices, Claude prompt gating, and token-budget mapping
  did not include `ultra`, so the two tools were not aligned.

## Decision

- R1: Set `defaultModels.codex = 'gpt-5.6-sol'`, move `gpt-5.6-sol` to the front
  of `primaryModelNames.codex`, and keep `gpt-5.5` as the first runtime fallback
  so environments whose local catalog lacks Sol still resolve a working model.
- R2: Preserve the entire existing Codex allowlist and `CODEX_DEFAULT_FALLBACK_CHAIN`;
  no model IDs were removed. Regression tests assert the catalog still validates.
- R3: Use an identity mapping `THINK_LEVEL_TO_CODEX_REASONING` so each hive level
  maps to the same-named Codex effort (`off`→`none`, `low`→`low`, ...,
  `xhigh`→`xhigh`, `ultra`→`ultra`, `max`→`max`). This is the most predictable
  mapping and matches the model's own vocabulary.
- R3/ultra: Pair every `ultra` selection with `rollout_token_budget`
  (`CODEX_ULTRA_ROLLOUT_TOKEN_BUDGET = 500000`), overridable via a new
  `--rollout-token-budget` option. Budget-derived effort caps at `xhigh` so a
  token budget alone never triggers `max`/`ultra`.
- R4: Add `ultra` to the shared `--think` choices, the Claude thinking-prompt
  gating (`Ultrathink.`), and the token-budget mapping. `ultra` resolves to the
  highest Claude effort available on the model (`max`, else `xhigh`, else
  `high`), matching Claude's `ultracode`.
- R5: Keep the default effort source as `default` with no `--think`, which emits
  `model_reasoning_effort=none` for Codex and no effort enforcement for Claude.

## Alternatives Considered

- Map `xhigh`→`high` and treat `max` as the top (assuming GPT-5.6 dropped
  `xhigh`). Rejected: `codex debug models` shows `xhigh` is natively supported
  today, and the GPT-5.6 preview keeps `xhigh` while adding `max` above it.
- Enable `ultra` without a `rollout_token_budget` cap. Rejected: OpenAI's
  guidance is explicit that unbounded multi-agent runs must not be launched; the
  cap keeps `--think ultra` safe by default.
- Let a large `--max-thinking-budget` alone escalate to `max`/`ultra`. Rejected:
  the extreme tiers should be an explicit, deliberate choice via `--think`.
- Make `gpt-5.6-sol` the default but drop older models from the catalog.
  Rejected: R2 requires every other model to stay supported.

## Verification

- `tests/test-codex-support.mjs` asserts the new default `gpt-5.6-sol`, the
  updated primary/fallback ordering, the runtime fallback to `gpt-5.5` when Sol
  is absent, and the identity reasoning mapping including `ultra` (with a
  `rolloutTokenBudget` of `500000`, overridable to `250000`), `max` (no budget),
  the `xhigh` budget cap, and the `none` default/off behavior.
- `tests/test-agent-commander-option.mjs` asserts the Codex extra args for
  `xhigh`, `max`, and `ultra` (the latter appends `rollout_token_budget`),
  including a custom `--rollout-token-budget` override.
- `tests/test-claude-think-prompt-gating.mjs` and
  `tests/test-opus-48-model-support.mjs` cover the `ultra` level in the Claude
  thinking-prompt gating and the token/effort mapping.
- The default suite (`node scripts/run-tests.mjs --suite default`) is run before
  finalizing; results are recorded in the pull request description.

## Source Data

- `data/issue-2027.json`
- `data/issue-2027-comments.json`
- `data/pr-2029.json`
- `data/codex-debug-models.json`
- `data/codex-debug-models-summary.json`
- `data/codex-version.txt`
- `data/gpt-5-6-sol-reasoning-notes.md`

## Existing Components Reused

- Codex model registry, `CODEX_DEFAULT_FALLBACK_CHAIN`, and
  `resolveRuntimeDefaultModel` in `src/models/index.mjs` (from issue 1992).
- `resolveCodexReasoningEffort` in `src/codex.options.lib.mjs`, already the
  single source of truth for Codex effort resolution.
- Claude effort/token machinery in `src/config.lib.mjs`
  (`thinkLevelToEffortLevel`, `getThinkingLevelToTokens`) and the
  `THINK_PROMPT_MESSAGES` table in `src/thinking-prompt.lib.mjs`.
