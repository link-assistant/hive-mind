#!/usr/bin/env node

/**
 * Bundled model catalogue for hive-mind.
 *
 * The alias maps, defaults and capability lists that ship with an installation,
 * with no behaviour attached: every function that maps, validates or describes a
 * model lives in ./index.mjs, which re-exports this module so the public surface
 * is unchanged.
 *
 * Split out of ./index.mjs when the new-model additions of issue #2202 pushed it
 * over the 1350-line early-warning threshold of
 * scripts/check-file-line-limits.sh, following the extraction precedent of issue
 * #2198. Keeping the catalogue in a leaf module also gives the live catalogue
 * (issue #2202) one obvious thing to merge against: this file is the "bundled
 * with the installation" half of that merge.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1473
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { FORMAL_AI_MODEL_ALIAS, FORMAL_AI_PROVIDER_MODEL_ID } from '../formal-ai-model.lib.mjs';

const formalAiNativeModelAliases = {
  [FORMAL_AI_MODEL_ALIAS]: FORMAL_AI_MODEL_ALIAS,
  [FORMAL_AI_PROVIDER_MODEL_ID]: FORMAL_AI_MODEL_ALIAS,
};

const formalAiProviderModelAliases = {
  [FORMAL_AI_MODEL_ALIAS]: FORMAL_AI_PROVIDER_MODEL_ID,
  [FORMAL_AI_PROVIDER_MODEL_ID]: FORMAL_AI_PROVIDER_MODEL_ID,
};
// Claude models (Anthropic API)
// Updated for Opus 4.5/4.6/4.7/4.8/5, Sonnet 4.6/5, and Fable 5/5.1 / Mythos 5/5.1 support
// (Issue #1221, Issue #1238, Issue #1329, Issue #1433, Issue #1620, Issue #1832, Issue #1875, Issue #2003, Issue #2096, Issue #2202)
export const claudeModels = {
  ...formalAiNativeModelAliases,
  sonnet: 'claude-sonnet-5', // Sonnet 5 (Issue #2003)
  opus: 'claude-opus-5', // Opus 5 (default, Issue #2096)
  haiku: 'claude-haiku-4-5-20251001', // Haiku 4.5
  'haiku-3-5': 'claude-3-5-haiku-20241022', // Haiku 3.5
  'haiku-3': 'claude-3-haiku-20240307', // Haiku 3
  opusplan: 'opusplan', // Special mode: Opus for planning, Sonnet for execution (Issue #1223)
  // Claude Fable 5.1 — the current Mythos-class flagship; Fable 5 moved to the
  // legacy list when 5.1 shipped, so the bare `fable` alias follows the vendor
  // (same precedent as `opus` → Opus 5 in Issue #2096) while `fable-5` stays
  // pinned for anyone who asked for that exact generation (Issue #2202)
  fable: 'claude-fable-5-1', // Fable 5.1 alias (Issue #2202)
  'fable-5-1': 'claude-fable-5-1', // Fable 5.1 short alias (Issue #2202)
  'claude-fable-5-1': 'claude-fable-5-1', // Fable 5.1 full ID (Issue #2202)
  // Claude Fable 5 — Anthropic's most capable widely released (Mythos-class) model, GA 2026-06-09 (Issue #1875)
  'fable-5': 'claude-fable-5', // Fable 5 short alias
  'claude-fable-5': 'claude-fable-5', // Fable 5 full ID
  // Claude Mythos 5.1 — Fable 5.1's capabilities without safety classifiers; invite only (Project Glasswing) (Issue #2202)
  'mythos-5-1': 'claude-mythos-5-1', // Mythos 5.1 short alias (Issue #2202)
  'claude-mythos-5-1': 'claude-mythos-5-1', // Mythos 5.1 full ID (Issue #2202)
  // Claude Mythos 5 — shares Fable 5's capabilities without safety classifiers; limited availability (Project Glasswing) (Issue #1875)
  'mythos-5': 'claude-mythos-5', // Mythos 5 short alias
  'claude-mythos-5': 'claude-mythos-5', // Mythos 5 full ID
  // Shorter version aliases (Issue #1221, Issue #1329 - PR comment feedback)
  'sonnet-5': 'claude-sonnet-5', // Sonnet 5 short alias (Issue #2003)
  'sonnet-4-6': 'claude-sonnet-4-6', // Sonnet 4.6 short alias (Issue #1329)
  'opus-5': 'claude-opus-5', // Opus 5 short alias (Issue #2096)
  'opus-4-8': 'claude-opus-4-8', // Opus 4.8 short alias (Issue #1832)
  'opus-4-7': 'claude-opus-4-7', // Opus 4.7 short alias (backward compatibility)
  'opus-4-6': 'claude-opus-4-6', // Opus 4.6 short alias (backward compatibility)
  'opus-4-5': 'claude-opus-4-5-20251101', // Opus 4.5 short alias
  'sonnet-4-5': 'claude-sonnet-4-5-20250929', // Sonnet 4.5 short alias (backward compatibility)
  'haiku-4-5': 'claude-haiku-4-5-20251001', // Haiku 4.5 short alias
  // Version aliases for backward compatibility (Issue #1221, Issue #1329, Issue #1620, Issue #1832, Issue #2096)
  'claude-opus-5': 'claude-opus-5', // Opus 5 (Issue #2096)
  'claude-opus-4-8': 'claude-opus-4-8', // Opus 4.8 (Issue #1832)
  'claude-opus-4-7': 'claude-opus-4-7', // Opus 4.7 (backward compatibility)
  'claude-sonnet-5': 'claude-sonnet-5', // Sonnet 5 (Issue #2003)
  'claude-sonnet-4-6': 'claude-sonnet-4-6', // Sonnet 4.6 (Issue #1329)
  'claude-opus-4-6': 'claude-opus-4-6', // Opus 4.6 (backward compatibility)
  'claude-opus-4-5': 'claude-opus-4-5-20251101', // Opus 4.5
  'claude-sonnet-4-5': 'claude-sonnet-4-5-20250929', // Sonnet 4.5 (backward compatibility)
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001', // Haiku 4.5
};

// Agent models (OpenCode API and Kilo Gateway via agent CLI)
// Issue #1300: Updated free models to match agent PR #191
// Issue #1543: Added qwen3.6-plus-free (former default) and nemotron-3-super-free per agent PR #234
// Issue #1563: qwen3.6-plus-free free promotion ended (April 2026), nemotron-3-super-free is now default per agent PR #243
export const agentModels = {
  ...formalAiProviderModelAliases,
  // OpenCode Zen free models (current)
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'opencode/gpt-5-nano',
  'minimax-m2.5-free': 'opencode/minimax-m2.5-free', // Upgraded from M2.1 (Issue #1391)
  'nemotron-3-super-free': 'opencode/nemotron-3-super-free', // Default: NVIDIA hybrid Mamba-Transformer (Issue #1563)
  // Kilo Gateway free models (Issue #1282, updated in #1300)
  // Short names for Kilo-exclusive models (Issue #1300)
  'glm-5-free': 'kilo/glm-5-free', // Kilo-exclusive
  'glm-4.5-air-free': 'kilo/glm-4.5-air-free', // Kilo-exclusive: agent-centric model
  'deepseek-r1-free': 'kilo/deepseek-r1-free', // Kilo-exclusive: reasoning model
  'giga-potato-free': 'kilo/giga-potato-free', // Kilo-exclusive
  'trinity-large-preview': 'kilo/trinity-large-preview', // Kilo-exclusive
  // Full names with kilo/ prefix
  'kilo/glm-5-free': 'kilo/glm-5-free',
  'kilo/glm-4.5-air-free': 'kilo/glm-4.5-air-free',
  'kilo/minimax-m2.5-free': 'kilo/minimax-m2.5-free', // Also on OpenCode Zen
  'kilo/deepseek-r1-free': 'kilo/deepseek-r1-free',
  'kilo/giga-potato-free': 'kilo/giga-potato-free',
  'kilo/trinity-large-preview': 'kilo/trinity-large-preview',
  // Deprecated free models (kept for backward compatibility)
  'qwen3.6-plus-free': 'opencode/qwen3.6-plus-free', // Deprecated: free promotion ended April 2026 (Issue #1563)
  'kimi-k2.5-free': 'opencode/kimi-k2.5-free', // Deprecated: not supported (Issue #1391)
  'glm-4.7-free': 'opencode/glm-4.7-free', // Deprecated: no longer free
  'minimax-m2.1-free': 'opencode/minimax-m2.1-free', // Deprecated: replaced by m2.5
  'kilo/glm-4.7-free': 'kilo/glm-4.7-free', // Deprecated: replaced by glm-4.5-air-free
  'kilo/kimi-k2.5-free': 'kilo/kimi-k2.5-free', // Deprecated: not recommended
  'kilo/minimax-m2.1-free': 'kilo/minimax-m2.1-free', // Deprecated: replaced by m2.5
  // Premium models
  sonnet: 'anthropic/claude-3-5-sonnet',
  haiku: 'anthropic/claude-3-5-haiku',
  opus: 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
};

// OpenCode models (OpenCode API)
export const opencodeModels = {
  ...formalAiProviderModelAliases,
  gpt4: 'openai/gpt-4',
  gpt4o: 'openai/gpt-4o',
  claude: 'anthropic/claude-3-5-sonnet',
  sonnet: 'anthropic/claude-3-5-sonnet',
  opus: 'anthropic/claude-3-opus',
  gemini: 'google/gemini-pro',
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
};

// Codex models (OpenAI API)
export const codexModels = {
  ...formalAiNativeModelAliases,
  // GPT-6 Astra — the first GPT-6 model, limited preview from 2026-09-03 (Issue #2202)
  'gpt-6-astra': 'gpt-6-astra',
  gpt5: 'gpt-5',
  'gpt-5': 'gpt-5',
  'gpt-5.5': 'gpt-5.5',
  'gpt-5.5-mini': 'gpt-5.5-mini',
  'gpt-5.5-nano': 'gpt-5.5-nano',
  'gpt-5.6-sol': 'gpt-5.6-sol',
  'gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt-5.6-luna': 'gpt-5.6-luna',
  'gpt-5.6-cyber': 'gpt-5.6-cyber', // Daybreak-program security model (Issue #2202)
  'gpt-5.4': 'gpt-5.4',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4-nano': 'gpt-5.4-nano',
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.3-codex-spark': 'gpt-5.3-codex-spark',
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
  // Daybreak aliases already advertised by the installed Codex CLI (Issue #2202)
  'gpt-daybreak-blue-latest': 'gpt-daybreak-blue-latest',
  'gpt-daybreak-red-latest': 'gpt-daybreak-red-latest',
  'openai.gpt-5.5': 'openai.gpt-5.5',
  'openai.gpt-5.4': 'openai.gpt-5.4',
  'openai.gpt-5.6-sol': 'openai.gpt-5.6-sol',
  'openai.gpt-5.6-terra': 'openai.gpt-5.6-terra',
  'openai.gpt-5.6-luna': 'openai.gpt-5.6-luna',
  'codex-auto-review': 'codex-auto-review',
  'o3-mini': 'o3-mini',
  gpt4: 'gpt-4',
  'gpt-4': 'gpt-4',
  gpt4o: 'gpt-4o',
  'gpt-4o': 'gpt-4o',
};

const CODEX_GENERATION_ALIAS_PATTERN = /^gpt-(\d+(?:\.\d+)?)-(sol|terra|luna)$/;
const OPENAI_MODEL_PREFIX_PATTERN = /^openai([/.])/;

/**
 * Resolve sol/terra/luna to the newest generation that contains the complete
 * alias family. A complete family prevents a partially rolled-out catalog from
 * moving only some aliases to a newer generation.
 */
export const getLatestCodexGenerationAliases = (models = codexModels) => {
  const generations = new Map();

  for (const modelId of Object.values(models)) {
    const bareModelId = modelId.replace(OPENAI_MODEL_PREFIX_PATTERN, '');
    const match = bareModelId.match(CODEX_GENERATION_ALIAS_PATTERN);
    if (!match) continue;

    const [, generation, alias] = match;
    if (!generations.has(generation)) generations.set(generation, {});
    generations.get(generation)[alias] = bareModelId;
  }

  const latestCompleteGeneration = [...generations.entries()].filter(([, aliases]) => ['sol', 'terra', 'luna'].every(alias => aliases[alias])).sort(([left], [right]) => right.localeCompare(left, undefined, { numeric: true }))[0];

  return latestCompleteGeneration?.[1] || {};
};
const getCodexModelVariants = () => {
  const bareModels = [...new Set(Object.values(codexModels).map(modelId => modelId.replace(OPENAI_MODEL_PREFIX_PATTERN, '')))];
  const aliases = getLatestCodexGenerationAliases();
  const variants = { ...codexModels, ...aliases };

  for (const [name, modelId] of Object.entries({ ...Object.fromEntries(bareModels.map(modelId => [modelId, modelId])), ...aliases })) {
    variants[`openai/${name}`] = `openai/${modelId}`;
    variants[`openai.${name}`] = `openai.${modelId}`;
  }

  return variants;
};

export const CODEX_MODEL_VARIANTS = getCodexModelVariants();

// Qwen Code models
export const qwenModels = {
  ...formalAiNativeModelAliases,
  qwen: 'qwen3-coder-plus',
  'qwen-coder': 'qwen3-coder-plus',
  qwen3: 'qwen3-coder-plus',
  'qwen3-coder': 'qwen3-coder',
  'qwen3-coder-plus': 'qwen3-coder-plus',
  'qwen3-coder-flash': 'qwen3-coder-flash',
  'qwen3.6-plus': 'qwen3.6-plus',
  'qwen3.6-coder-plus': 'qwen3.6-coder-plus',
};

// Gemini models (Google Gemini CLI)
// Keep aliases aligned with the Gemini CLI model aliases documented in
// docs/cli/cli-reference.md: auto, pro, flash, and flash-lite.
export const geminiModels = {
  ...formalAiNativeModelAliases,
  auto: 'auto',
  gemini: 'gemini-2.5-flash',
  flash: 'gemini-2.5-flash',
  '2.5-flash': 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
  '2.5-pro': 'gemini-2.5-pro',
  lite: 'gemini-2.5-flash-lite',
  '2.5-lite': 'gemini-2.5-flash-lite',
  'flash-lite': 'gemini-2.5-flash-lite',
  '3-flash': 'gemini-3-flash-preview',
  '3-pro': 'gemini-3-pro-preview',
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-3-flash-preview': 'gemini-3-flash-preview',
  'gemini-3-pro-preview': 'gemini-3-pro-preview',
};

// Default model for each tool (Issue #1473: centralized to avoid scattered hardcoded defaults)
export const defaultModels = {
  claude: 'opus', // Issue #2033: Opus is the preferred default for Claude; sonnet remains available explicitly. Opus now maps to Opus 5 (Issue #2096)
  agent: 'nemotron-3-super-free', // Issue #1563: changed from qwen3.6-plus-free (free promotion ended) per agent PR #243
  opencode: 'grok-code-fast-1',
  codex: 'gpt-5.6-sol', // Issue #2027: GPT-5.6 Sol is the released Codex flagship; runtime falls back to gpt-5.5 when Sol is not in the local catalog
  qwen: 'qwen3-coder-plus',
  gemini: 'flash',
};

// Models that support 1M token context window via [1m] suffix (Issue #1221, Issue #1238, Issue #1329, Issue #1832)
// See: https://code.claude.com/docs/en/model-config
export const MODELS_SUPPORTING_1M_CONTEXT = [
  'claude-fable-5-1', // Fable 5.1 — 1M context by default (Issue #2202)
  'claude-mythos-5-1', // Mythos 5.1 — 1M context by default (Issue #2202)
  'fable-5-1', // Fable 5.1 short alias (Issue #2202)
  'mythos-5-1', // Mythos 5.1 short alias (Issue #2202)
  'claude-fable-5', // Fable 5 — 1M context by default (Issue #1875)
  'claude-mythos-5', // Mythos 5 — 1M context by default (Issue #1875)
  'fable', // Fable alias — now resolves to Fable 5.1 (Issue #2202)
  'fable-5', // Fable 5 short alias (Issue #1875)
  'mythos-5', // Mythos 5 short alias (Issue #1875)
  'claude-opus-4-8', // Opus 4.8 (Issue #1832)
  'claude-opus-4-7', // Opus 4.7 (Issue #1620)
  'claude-opus-4-6',
  'claude-opus-4-5-20251101',
  'claude-sonnet-5', // Sonnet 5 — 1M context (Issue #2003)
  'claude-sonnet-4-6', // Sonnet 4.6 (Issue #1329)
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5',
  'claude-opus-5', // Opus 5 — 1M context (Issue #2096)
  'sonnet', // Now maps to Sonnet 5 (Issue #2003)
  'sonnet-5', // Short alias (Issue #2003)
  'sonnet-4-6', // Short alias (Issue #1329)
  'opus', // Now maps to Opus 5 (Issue #2096)
  'opus-5', // Short alias (Issue #2096)
  'opus-4-8', // Short alias (Issue #1832)
  'opus-4-7', // Short alias (Issue #1620)
  'opus-4-6', // Short alias (Issue #1221 - PR comment feedback)
  'opus-4-5', // Short alias (Issue #1238)
  'sonnet-4-5', // Short alias (Issue #1221 - PR comment feedback)
];

// Free model to base model mapping for pricing lookup (Issue #1250, Issue #1473)
// Free models like "kimi-k2.5-free" should use pricing from base model "kimi-k2.5"
export const freeToBaseModelMap = {
  'kimi-k2.5-free': 'kimi-k2.5',
  'glm-4.7-free': 'glm-4.7',
  'minimax-m2.1-free': 'minimax-m2.1',
  'minimax-m2.5-free': 'minimax-m2.5',
  'qwen3.6-plus-free': 'qwen3.6-plus', // Issue #1543
  'nemotron-3-super-free': 'nemotron-3-super', // Issue #1543
  'glm-5-free': 'glm-5',
  'glm-4.5-air-free': 'glm-4.5-air',
  'deepseek-r1-free': 'deepseek-r1',
  'giga-potato-free': 'giga-potato',
  'trinity-large-preview-free': 'trinity-large-preview',
};

// ─── VALIDATION-EXTENDED MODEL MAPS ──────────────────────────────────────────
// These extend the base maps with full model ID identity entries for validation
// (e.g., 'claude-sonnet-4-5-20250929' → 'claude-sonnet-4-5-20250929')
// so that full model IDs are also accepted as valid inputs
export const CLAUDE_MODELS = {
  ...claudeModels,
  'claude-fable-5-1': 'claude-fable-5-1', // Fable 5.1 full ID (Issue #2202)
  'claude-mythos-5-1': 'claude-mythos-5-1', // Mythos 5.1 full ID (Issue #2202)
  'claude-fable-5': 'claude-fable-5', // Fable 5 full ID (Issue #1875)
  'claude-mythos-5': 'claude-mythos-5', // Mythos 5 full ID (Issue #1875)
  'claude-opus-5': 'claude-opus-5', // Opus 5 full ID (Issue #2096)
  'claude-opus-4-8': 'claude-opus-4-8', // Opus 4.8 full ID (Issue #1832)
  'claude-opus-4-7': 'claude-opus-4-7', // Opus 4.7 full ID (Issue #1620)
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101': 'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
  'claude-3-5-haiku-20241022': 'claude-3-5-haiku-20241022',
  'claude-3-haiku-20240307': 'claude-3-haiku-20240307',
};

export const OPENCODE_MODELS = {
  ...opencodeModels,
  'openai/gpt-4': 'openai/gpt-4',
  'openai/gpt-4o': 'openai/gpt-4o',
  'anthropic/claude-3-5-sonnet': 'anthropic/claude-3-5-sonnet',
  'anthropic/claude-3-opus': 'anthropic/claude-3-opus',
  'google/gemini-pro': 'google/gemini-pro',
  'opencode/grok-code': 'opencode/grok-code',
};

export const CODEX_MODELS = {
  ...CODEX_MODEL_VARIANTS,
  'gpt-6-astra': 'gpt-6-astra', // Issue #2202
  'gpt-5': 'gpt-5',
  'gpt-5.5': 'gpt-5.5',
  'gpt-5.5-mini': 'gpt-5.5-mini',
  'gpt-5.5-nano': 'gpt-5.5-nano',
  'gpt-5.6-sol': 'gpt-5.6-sol',
  'gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt-5.6-luna': 'gpt-5.6-luna',
  'gpt-5.6-cyber': 'gpt-5.6-cyber', // Issue #2202
  'gpt-5.4': 'gpt-5.4',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4-nano': 'gpt-5.4-nano',
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.3-codex-spark': 'gpt-5.3-codex-spark',
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
  'gpt-daybreak-blue-latest': 'gpt-daybreak-blue-latest', // Issue #2202
  'gpt-daybreak-red-latest': 'gpt-daybreak-red-latest', // Issue #2202
  'openai.gpt-5.5': 'openai.gpt-5.5',
  'openai.gpt-5.4': 'openai.gpt-5.4',
  'openai.gpt-5.6-sol': 'openai.gpt-5.6-sol',
  'openai.gpt-5.6-terra': 'openai.gpt-5.6-terra',
  'openai.gpt-5.6-luna': 'openai.gpt-5.6-luna',
  'codex-auto-review': 'codex-auto-review',
  'gpt-4': 'gpt-4',
  'gpt-4o': 'gpt-4o',
};

export const QWEN_MODELS = {
  ...qwenModels,
  'qwen3-coder': 'qwen3-coder',
  'qwen3-coder-plus': 'qwen3-coder-plus',
  'qwen3-coder-flash': 'qwen3-coder-flash',
  'qwen3.6-plus': 'qwen3.6-plus',
  'qwen3.6-coder-plus': 'qwen3.6-coder-plus',
};

export const GEMINI_MODELS = {
  ...geminiModels,
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-3-flash-preview': 'gemini-3-flash-preview',
  'gemini-3-pro-preview': 'gemini-3-pro-preview',
};

export const AGENT_MODELS = {
  ...agentModels,
  'opencode/grok-code': 'opencode/grok-code',
  'opencode/big-pickle': 'opencode/big-pickle',
  'opencode/gpt-5-nano': 'opencode/gpt-5-nano',
  'opencode/minimax-m2.5-free': 'opencode/minimax-m2.5-free',
  'opencode/nemotron-3-super-free': 'opencode/nemotron-3-super-free', // Issue #1563: now default
  'opencode/qwen3.6-plus-free': 'opencode/qwen3.6-plus-free', // Deprecated: free promotion ended (Issue #1563)
  'opencode/kimi-k2.5-free': 'opencode/kimi-k2.5-free', // Deprecated
  'opencode/glm-4.7-free': 'opencode/glm-4.7-free', // Deprecated
  'opencode/minimax-m2.1-free': 'opencode/minimax-m2.1-free', // Deprecated
  'anthropic/claude-3-5-sonnet': 'anthropic/claude-3-5-sonnet',
  'anthropic/claude-3-5-haiku': 'anthropic/claude-3-5-haiku',
  'anthropic/claude-3-opus': 'anthropic/claude-3-opus',
  'google/gemini-3-pro': 'google/gemini-3-pro',
};
