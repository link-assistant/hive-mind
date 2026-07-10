#!/usr/bin/env node
import { ensureUseM } from '../use-m-bootstrap.lib.mjs';

/**
 * Unified models module for hive-mind
 * Single source of truth for all model data, mapping, validation, and info.
 *
 * Consolidates the former:
 * - model-mapping.lib.mjs (model data, maps, tool-model functions)
 * - model-validation.lib.mjs (validation, fuzzy matching, 1M context)
 * - model-info.lib.mjs (display names, models.dev API, PR comment helpers)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1473
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}

import { log } from '../lib.mjs';

const execFileAsync = promisify(execFile);

// ─── MODEL DATA ──────────────────────────────────────────────────────────────

// Claude models (Anthropic API)
// Updated for Opus 4.5/4.6/4.7/4.8, Sonnet 4.6/5, and Fable 5 / Mythos 5 support
// (Issue #1221, Issue #1238, Issue #1329, Issue #1433, Issue #1620, Issue #1832, Issue #1875, Issue #2003)
export const claudeModels = {
  sonnet: 'claude-sonnet-5', // Sonnet 5 (default, Issue #2003)
  opus: 'claude-opus-4-8', // Opus 4.8 (Issue #1832)
  haiku: 'claude-haiku-4-5-20251001', // Haiku 4.5
  'haiku-3-5': 'claude-3-5-haiku-20241022', // Haiku 3.5
  'haiku-3': 'claude-3-haiku-20240307', // Haiku 3
  opusplan: 'opusplan', // Special mode: Opus for planning, Sonnet for execution (Issue #1223)
  // Claude Fable 5 — Anthropic's most capable widely released (Mythos-class) model, GA 2026-06-09 (Issue #1875)
  fable: 'claude-fable-5', // Fable 5 alias
  'fable-5': 'claude-fable-5', // Fable 5 short alias
  'claude-fable-5': 'claude-fable-5', // Fable 5 full ID
  // Claude Mythos 5 — shares Fable 5's capabilities without safety classifiers; limited availability (Project Glasswing) (Issue #1875)
  'mythos-5': 'claude-mythos-5', // Mythos 5 short alias
  'claude-mythos-5': 'claude-mythos-5', // Mythos 5 full ID
  // Shorter version aliases (Issue #1221, Issue #1329 - PR comment feedback)
  'sonnet-5': 'claude-sonnet-5', // Sonnet 5 short alias (Issue #2003)
  'sonnet-4-6': 'claude-sonnet-4-6', // Sonnet 4.6 short alias (Issue #1329)
  'opus-4-8': 'claude-opus-4-8', // Opus 4.8 short alias (Issue #1832)
  'opus-4-7': 'claude-opus-4-7', // Opus 4.7 short alias (backward compatibility)
  'opus-4-6': 'claude-opus-4-6', // Opus 4.6 short alias (backward compatibility)
  'opus-4-5': 'claude-opus-4-5-20251101', // Opus 4.5 short alias
  'sonnet-4-5': 'claude-sonnet-4-5-20250929', // Sonnet 4.5 short alias (backward compatibility)
  'haiku-4-5': 'claude-haiku-4-5-20251001', // Haiku 4.5 short alias
  // Version aliases for backward compatibility (Issue #1221, Issue #1329, Issue #1620, Issue #1832)
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
  gpt5: 'gpt-5',
  'gpt-5': 'gpt-5',
  'gpt-5.5': 'gpt-5.5',
  'gpt-5.5-mini': 'gpt-5.5-mini',
  'gpt-5.5-nano': 'gpt-5.5-nano',
  'gpt-5.6-sol': 'gpt-5.6-sol',
  'gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt-5.6-luna': 'gpt-5.6-luna',
  'gpt-5.4': 'gpt-5.4',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4-nano': 'gpt-5.4-nano',
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.3-codex-spark': 'gpt-5.3-codex-spark',
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
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

// Qwen Code models
export const qwenModels = {
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
  claude: 'opus', // Issue #2033: Opus is the preferred default for Claude; sonnet remains available explicitly
  agent: 'nemotron-3-super-free', // Issue #1563: changed from qwen3.6-plus-free (free promotion ended) per agent PR #243
  opencode: 'grok-code-fast-1',
  codex: 'gpt-5.6-sol', // Issue #2027: GPT-5.6 Sol is the released Codex flagship; runtime falls back to gpt-5.5 when Sol is not in the local catalog
  qwen: 'qwen3-coder-plus',
  gemini: 'flash',
};

// Models that support 1M token context window via [1m] suffix (Issue #1221, Issue #1238, Issue #1329, Issue #1832)
// See: https://code.claude.com/docs/en/model-config
export const MODELS_SUPPORTING_1M_CONTEXT = [
  'claude-fable-5', // Fable 5 — 1M context by default (Issue #1875)
  'claude-mythos-5', // Mythos 5 — 1M context by default (Issue #1875)
  'fable', // Fable 5 alias (Issue #1875)
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
  'sonnet', // Now maps to Sonnet 5 (Issue #2003)
  'sonnet-5', // Short alias (Issue #2003)
  'sonnet-4-6', // Short alias (Issue #1329)
  'opus', // Now maps to Opus 4.8 (Issue #1832)
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
  'claude-fable-5': 'claude-fable-5', // Fable 5 full ID (Issue #1875)
  'claude-mythos-5': 'claude-mythos-5', // Mythos 5 full ID (Issue #1875)
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
  ...codexModels,
  'gpt-5': 'gpt-5',
  'gpt-5.5': 'gpt-5.5',
  'gpt-5.5-mini': 'gpt-5.5-mini',
  'gpt-5.5-nano': 'gpt-5.5-nano',
  'gpt-5.6-sol': 'gpt-5.6-sol',
  'gpt-5.6-terra': 'gpt-5.6-terra',
  'gpt-5.6-luna': 'gpt-5.6-luna',
  'gpt-5.4': 'gpt-5.4',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4-nano': 'gpt-5.4-nano',
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.3-codex-spark': 'gpt-5.3-codex-spark',
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
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

// ─── MODEL MAPPING FUNCTIONS ─────────────────────────────────────────────────

/**
 * Get the model map object for a given tool
 * @param {string} tool - The tool name (claude, agent, opencode, codex, qwen, gemini)
 * @returns {Object} The model mapping for the tool
 */
export const getModelMapForTool = tool => {
  switch (tool) {
    case 'claude':
      return claudeModels;
    case 'agent':
      return agentModels;
    case 'opencode':
      return opencodeModels;
    case 'codex':
      return codexModels;
    case 'gemini':
      return geminiModels;
    case 'qwen':
      return qwenModels;
    default:
      return claudeModels;
  }
};

/**
 * Get the default model for a given tool
 * @param {string} tool - The tool name (claude, agent, opencode, codex, qwen, gemini)
 * @returns {string} The default model alias for the tool
 */
export const getDefaultModelForTool = tool => {
  return defaultModels[tool] || defaultModels.claude;
};

let cachedInstalledCodexModelsPromise = null;
// Issue #2027: With gpt-5.6-sol as the preferred default, the fallback chain is only
// consulted when Sol is absent from the local catalog. Prefer the previous stable
// default (gpt-5.5) first, then the remaining GPT-5.6 preview tiers, then older models.
const CODEX_DEFAULT_FALLBACK_CHAIN = ['gpt-5.5', 'openai.gpt-5.5', 'gpt-5.6-terra', 'gpt-5.6-luna', 'openai.gpt-5.6-sol', 'openai.gpt-5.6-terra', 'openai.gpt-5.6-luna', 'gpt-5.4', 'openai.gpt-5.4', 'gpt-5.5-mini', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.5-nano', 'gpt-5.4-nano'];

export const getInstalledCodexModels = async () => {
  if (!cachedInstalledCodexModelsPromise) {
    cachedInstalledCodexModelsPromise = (async () => {
      try {
        const { stdout } = await execFileAsync('codex', ['debug', 'models'], {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        });
        const parsed = JSON.parse(stdout);
        const modelSlugs = parsed?.models?.map(model => model?.slug).filter(Boolean);
        return Array.isArray(modelSlugs) ? [...new Set(modelSlugs)] : null;
      } catch {
        return null;
      }
    })();
  }

  return cachedInstalledCodexModelsPromise;
};

export const resolveRuntimeDefaultModel = async (tool, options = {}) => {
  const toolName = (tool || 'claude').toString().toLowerCase();
  const preferredDefault = defaultModels[toolName] || defaultModels.claude;

  if (toolName !== 'codex') {
    return preferredDefault;
  }

  const availableCodexModels = options.availableCodexModels === undefined ? await getInstalledCodexModels() : options.availableCodexModels;

  if (!Array.isArray(availableCodexModels) || availableCodexModels.length === 0) {
    return preferredDefault;
  }

  if (availableCodexModels.includes(preferredDefault)) {
    return preferredDefault;
  }

  return CODEX_DEFAULT_FALLBACK_CHAIN.find(model => availableCodexModels.includes(model)) || preferredDefault;
};

/**
 * Map model name to full model ID for a specific tool
 * @param {string} tool - The tool name (claude, agent, opencode, codex, qwen, gemini)
 * @param {string} model - The model name or alias
 * @returns {string} The full model ID
 */
export const mapModelForTool = (tool, model) => {
  switch (tool) {
    case 'claude':
      return claudeModels[model] || model;
    case 'agent':
      return agentModels[model] || model;
    case 'opencode':
      return opencodeModels[model] || model;
    case 'codex':
      return codexModels[model] || model;
    case 'gemini':
      return geminiModels[model] || model;
    case 'qwen':
      return qwenModels[model] || model;
    default:
      return model;
  }
};

/**
 * Validate if a model is compatible with a tool
 * @param {string} tool - The tool name (claude, agent, opencode, codex, qwen, gemini)
 * @param {string} model - The model name or alias
 * @returns {boolean} True if the model is compatible with the tool
 */
export const isModelCompatibleWithTool = (tool, model) => {
  const mappedModel = mapModelForTool(tool, model);

  switch (tool) {
    case 'claude':
      return mappedModel.startsWith('claude-') || mappedModel === 'opusplan';
    case 'agent':
      return mappedModel.includes('/') || Object.keys(agentModels).includes(model);
    case 'opencode':
      return mappedModel.includes('/') || Object.keys(opencodeModels).includes(model);
    case 'codex':
      return Object.keys(codexModels).includes(model) || mappedModel.startsWith('gpt-');
    case 'gemini':
      return Object.keys(geminiModels).includes(model) || mappedModel.startsWith('gemini-');
    case 'qwen':
      return Object.keys(qwenModels).includes(model) || mappedModel.startsWith('qwen');
    default:
      return true;
  }
};

/**
 * Get a list of valid model names for a tool
 * @param {string} tool - The tool name
 * @returns {string[]} Array of valid model names
 */
export const getValidModelsForTool = tool => {
  switch (tool) {
    case 'claude':
      return Object.keys(claudeModels);
    case 'agent':
      return Object.keys(agentModels);
    case 'opencode':
      return Object.keys(opencodeModels);
    case 'codex':
      return Object.keys(codexModels);
    case 'gemini':
      return Object.keys(geminiModels);
    case 'qwen':
      return Object.keys(qwenModels);
    default:
      return [];
  }
};

// Primary (non-alias, non-deprecated) short names shown in CLI help descriptions
// These are the recommended model names users should see in --model help text
export const primaryModelNames = {
  claude: ['opus', 'sonnet', 'haiku', 'opusplan', 'fable'],
  opencode: ['grok', 'gpt4o'],
  codex: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
  agent: ['nemotron-3-super-free', 'minimax-m2.5-free', 'big-pickle', 'gpt-5-nano', 'glm-5-free', 'deepseek-r1-free'],
  qwen: ['qwen3-coder-plus', 'qwen3-coder', 'qwen3-coder-flash'],
  gemini: ['flash', 'pro', 'flash-lite', 'auto'],
};

/**
 * Build the --model CLI option description string dynamically from centralized model data.
 * @returns {string} Description like "Model to use (for claude: opus, sonnet, ...; for agent: ...)"
 */
export const buildModelOptionDescription = () => {
  const parts = Object.entries(primaryModelNames).map(([tool, names]) => `for ${tool}: ${names.join(', ')}`);
  return `Model to use (${parts.join('; ')})`;
};

/**
 * Get the primary choices for Claude model selection (used in review.mjs and task.mjs).
 * Returns short aliases plus key full model IDs for backward compatibility.
 * @returns {string[]}
 */
export const getClaudeModelChoices = () => {
  return Object.keys(claudeModels);
};

/**
 * Validate tool-model compatibility and throw descriptive error if invalid
 * @param {string} tool - The tool name
 * @param {string} model - The model name
 * @throws {Error} If the model is not compatible with the tool
 */
export const validateToolModelCompatibility = (tool, model) => {
  if (!isModelCompatibleWithTool(tool, model)) {
    const validModels = getValidModelsForTool(tool);
    const mappedModel = mapModelForTool(tool, model);

    throw new Error(`Model '${model}' (mapped to '${mappedModel}') is not compatible with --tool ${tool}.\n` + `Valid models for ${tool}: ${validModels.join(', ')}\n` + 'Hint: Different tools use different model APIs and naming conventions.');
  }
};

// ─── MODEL VALIDATION FUNCTIONS ──────────────────────────────────────────────

/**
 * Get the model map for a given tool (validation-extended version with full ID entries)
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex', 'agent', 'qwen', 'gemini')
 * @returns {Object} The model mapping for the tool
 */
const getValidationModelMapForTool = tool => {
  switch (tool) {
    case 'opencode':
      return OPENCODE_MODELS;
    case 'codex':
      return CODEX_MODELS;
    case 'gemini':
      return GEMINI_MODELS;
    case 'agent':
      return AGENT_MODELS;
    case 'qwen':
      return QWEN_MODELS;
    case 'claude':
    default:
      return CLAUDE_MODELS;
  }
};

/**
 * Get the list of available model names for a tool (for display in help/error messages)
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex', 'agent', 'qwen', 'gemini')
 * @returns {string[]} Array of available model short names
 */
export const getAvailableModelNames = tool => {
  const modelMap = getValidationModelMapForTool(tool);
  // Get unique short names (aliases) - exclude full model IDs that contain '/' or long claude- prefixed IDs
  const aliases = Object.keys(modelMap).filter(key => {
    // Keep short aliases only - exclude:
    // - Full model IDs with slashes (e.g., 'openai/gpt-4')
    // - Long claude-prefixed model IDs (e.g., 'claude-sonnet-4-5-20250929')
    // - Full gpt- prefixed IDs that are ONLY version numbers (e.g., 'gpt-4', 'gpt-4o', 'gpt-5')
    // But keep descriptive aliases like 'gpt-5-nano', 'gpt-5.3-codex', 'o3-mini', 'gpt5', etc.
    // Issue #1185: Updated regex to not filter out gpt-5-nano (a valid short alias)
    if (key.includes('/')) return false;
    if (key.match(/^claude-.*-\d{8}$/)) return false; // Full claude model IDs with date
    if (key.match(/^gpt-\d+[a-z]?$/)) return false; // Full gpt-N or gpt-No model IDs only (e.g., gpt-4, gpt-4o, gpt-5)
    return true;
  });
  return [...new Set(aliases)];
};

/**
 * Calculate Levenshtein distance between two strings (case-insensitive)
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} The edit distance between the strings
 */
export const levenshteinDistance = (a, b) => {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  const matrix = [];

  for (let i = 0; i <= bLower.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= aLower.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bLower.length; i++) {
    for (let j = 1; j <= aLower.length; j++) {
      if (bLower.charAt(i - 1) === aLower.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[bLower.length][aLower.length];
};

/**
 * Find the closest matching model names using fuzzy matching
 * @param {string} input - The user-provided model name
 * @param {string[]} validModels - Array of valid model names
 * @param {number} maxSuggestions - Maximum number of suggestions to return
 * @param {number} maxDistance - Maximum Levenshtein distance to consider
 * @returns {string[]} Array of suggested model names
 */
export const findSimilarModels = (input, validModels, maxSuggestions = 3, maxDistance = 3) => {
  const suggestions = validModels
    .map(model => ({
      model,
      distance: levenshteinDistance(input, model),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxSuggestions)
    .map(({ model }) => model);

  return suggestions;
};

/**
 * Parse model name to extract base model and optional [1m] suffix
 * @param {string} model - The model name (e.g., "opus[1m]", "claude-opus-4-6[1m]")
 * @returns {{ baseModel: string, has1mSuffix: boolean }}
 */
export const parseModelWith1mSuffix = model => {
  if (!model || typeof model !== 'string') {
    return { baseModel: model, has1mSuffix: false };
  }

  const match = model.match(/^(.+?)\[1m\]$/i);
  if (match) {
    return { baseModel: match[1], has1mSuffix: true };
  }

  return { baseModel: model, has1mSuffix: false };
};

/**
 * Check if a model supports the [1m] context window
 * @param {string} model - The base model name (without [1m] suffix)
 * @param {string} tool - The tool name
 * @returns {boolean} True if the model supports 1M context
 */
export const supports1mContext = (model, tool = 'claude') => {
  if (tool !== 'claude') {
    return false;
  }

  const normalizedModel = model.toLowerCase();

  for (const supportedModel of MODELS_SUPPORTING_1M_CONTEXT) {
    if (supportedModel.toLowerCase() === normalizedModel) {
      return true;
    }
  }

  const modelMap = getValidationModelMapForTool(tool);
  const matchedKey = Object.keys(modelMap).find(key => key.toLowerCase() === normalizedModel);
  if (matchedKey) {
    const mappedModel = modelMap[matchedKey];
    for (const supportedModel of MODELS_SUPPORTING_1M_CONTEXT) {
      if (supportedModel.toLowerCase() === mappedModel.toLowerCase()) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Validate a model name against the available models for a tool
 * Supports [1m] suffix for 1 million token context (Issue #1221)
 * @param {string} model - The model name to validate (e.g., "opus", "opus[1m]", "claude-opus-4-6[1m]")
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex', 'agent', 'qwen', 'gemini')
 * @returns {{ valid: boolean, message?: string, suggestions?: string[], mappedModel?: string, has1mSuffix?: boolean }}
 */
export const validateModelName = (model, tool = 'claude') => {
  if (!model || typeof model !== 'string') {
    return {
      valid: false,
      message: 'Model name is required',
      suggestions: [],
    };
  }

  const { baseModel, has1mSuffix } = parseModelWith1mSuffix(model);

  const modelMap = getValidationModelMapForTool(tool);
  const availableNames = Object.keys(modelMap);

  const normalizedModel = baseModel.toLowerCase();
  const matchedKey = availableNames.find(key => key.toLowerCase() === normalizedModel);

  if (matchedKey) {
    const mappedModel = modelMap[matchedKey];

    if (has1mSuffix) {
      if (!supports1mContext(baseModel, tool)) {
        const supportedModels = MODELS_SUPPORTING_1M_CONTEXT.filter(m => !m.includes('-')).join(', ');
        return {
          valid: false,
          message: `Model "${baseModel}" does not support [1m] context window.\n   Models supporting 1M context: ${supportedModels}`,
          suggestions: [],
        };
      }
      return {
        valid: true,
        mappedModel: `${mappedModel}[1m]`,
        has1mSuffix: true,
      };
    }

    return {
      valid: true,
      mappedModel,
      has1mSuffix: false,
    };
  }

  // Model not found - provide helpful error with suggestions
  const shortNames = getAvailableModelNames(tool);
  const suggestions = findSimilarModels(baseModel, shortNames);

  let message = `Unrecognized model: "${model}"`;

  if (suggestions.length > 0) {
    message += `\n   Did you mean: ${suggestions.map(s => `"${s}"`).join(', ')}?`;
  }

  message += `\n   Available models for ${tool}: ${shortNames.join(', ')}`;

  if (tool === 'claude') {
    message += `\n   Tip: Use [1m] suffix for 1M context (e.g., opus[1m], sonnet[1m])`;
  }

  return {
    valid: false,
    message,
    suggestions,
  };
};

export const CLAUDE_SUB_AGENT_MODEL_INHERIT = 'inherit';

export const normalizeClaudeSubAgentModelName = model => {
  if (model === undefined || model === null) return model;
  if (typeof model !== 'string') return model;

  const trimmed = model.trim();
  return trimmed.toLowerCase() === CLAUDE_SUB_AGENT_MODEL_INHERIT ? CLAUDE_SUB_AGENT_MODEL_INHERIT : trimmed;
};

const looksLikeClaudeProviderModelId = model => {
  if (typeof model !== 'string') return false;
  const normalized = model.toLowerCase();
  return normalized.startsWith('claude-') || normalized.startsWith('anthropic/') || normalized.startsWith('anthropic.') || normalized.includes('.anthropic.');
};

/**
 * Validate the Claude Code subagent/agent-team model override.
 *
 * Claude Code documents CLAUDE_CODE_SUBAGENT_MODEL as accepting full provider
 * model IDs, normal Claude model aliases, and the special value "inherit".
 * Keep "inherit" scoped to this option so it does not become a valid main
 * session model.
 *
 * @param {string} model - The subagent model override value
 * @returns {{ valid: boolean, message?: string, suggestions?: string[], mappedModel?: string }}
 */
export const validateClaudeSubAgentModelName = model => {
  const normalized = normalizeClaudeSubAgentModelName(model);

  if (normalized === CLAUDE_SUB_AGENT_MODEL_INHERIT) {
    return {
      valid: true,
      mappedModel: CLAUDE_SUB_AGENT_MODEL_INHERIT,
    };
  }

  const validation = validateModelName(normalized, 'claude');
  if (validation.valid) return validation;
  if (looksLikeClaudeProviderModelId(normalized)) {
    return {
      valid: true,
      mappedModel: normalized,
    };
  }

  return validation;
};

export const mapClaudeSubAgentModelToEnvValue = model => {
  const result = validateClaudeSubAgentModelName(model);
  if (result.valid && result.mappedModel) return result.mappedModel;
  const normalized = normalizeClaudeSubAgentModelName(model);
  return mapModelForTool('claude', normalized);
};

/**
 * Validate model name and exit with error if invalid
 * This is the main entry point for model validation in solve.mjs, hive.mjs, etc.
 * @param {string} model - The model name to validate
 * @param {string} tool - The tool name ('claude', 'opencode', 'codex', 'agent', 'qwen', 'gemini')
 * @param {Function} exitFn - Function to call for exiting (default: process.exit)
 * @returns {Promise<boolean>} True if valid, exits process if invalid
 */
export const validateAndExitOnInvalidModel = async (model, tool = 'claude', exitFn = null) => {
  const result = validateModelName(model, tool);

  if (!result.valid) {
    await log(`\u274C ${result.message}`, { level: 'error' });

    if (exitFn) {
      await exitFn(1, 'Invalid model name');
    } else {
      process.exit(1);
    }
    return false;
  }

  return true;
};

/**
 * Validate --sub-agent-model and exit with error if invalid.
 *
 * This option maps to Claude Code's CLAUDE_CODE_SUBAGENT_MODEL, so it is only
 * meaningful for the Claude tool even when solve/hive supports multiple tools.
 *
 * @param {string} model - The subagent model override value
 * @param {string} tool - The selected tool
 * @param {Function} exitFn - Function to call for exiting (default: process.exit)
 * @returns {Promise<boolean>} True if valid, exits process if invalid
 */
export const validateAndExitOnInvalidClaudeSubAgentModel = async (model, tool = 'claude', exitFn = null) => {
  if (model === undefined || model === null || model === '') return true;

  if (tool !== 'claude') {
    await log(`❌ --sub-agent-model is only supported with --tool claude (current tool: ${tool})`, { level: 'error' });
    if (exitFn) {
      await exitFn(1, '--sub-agent-model requires --tool claude');
    } else {
      process.exit(1);
    }
    return false;
  }

  const result = validateClaudeSubAgentModelName(model);

  if (!result.valid) {
    await log(`❌ Invalid --sub-agent-model: ${result.message}`, { level: 'error' });

    if (exitFn) {
      await exitFn(1, 'Invalid sub-agent model name');
    } else {
      process.exit(1);
    }
    return false;
  }

  return true;
};

/**
 * Format the list of available models for help text
 * @param {string} tool - The tool name
 * @returns {string} Formatted list of available models
 */
export const formatAvailableModelsForHelp = (tool = 'claude') => {
  const names = getAvailableModelNames(tool);
  return names.join(', ');
};

// ─── MODEL INFO FUNCTIONS ────────────────────────────────────────────────────

/**
 * Map tool identifier to user-friendly display name.
 * @param {string|null} tool - The tool identifier (claude, codex, opencode, agent, qwen, gemini)
 * @returns {string} User-friendly display name
 */
export const getToolDisplayName = tool => {
  const name = (tool || '').toString().toLowerCase();
  switch (name) {
    case 'claude':
      return 'Anthropic Claude Code';
    case 'codex':
      return 'OpenAI Codex';
    case 'opencode':
      return 'OpenCode';
    case 'agent':
      return 'Agent CLI';
    case 'gemini':
      return 'Google Gemini CLI';
    case 'qwen':
      return 'Qwen Code';
    default:
      return 'AI tool';
  }
};

/**
 * Cached models.dev API response to avoid repeated network requests.
 */
let modelsDevCache = null;

/**
 * Fetch the full models.dev API data with caching.
 * @returns {Promise<Object|null>} The full API response or null on failure
 */
const fetchModelsDevApi = async () => {
  if (modelsDevCache) return modelsDevCache;
  try {
    const https = (await globalThis.use('https')).default;
    return new Promise((resolve, reject) => {
      https
        .get('https://models.dev/api.json', res => {
          let data = '';
          res.on('data', chunk => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              modelsDevCache = JSON.parse(data);
              resolve(modelsDevCache);
            } catch (parseError) {
              reject(parseError);
            }
          });
        })
        .on('error', err => {
          reject(err);
        });
    });
  } catch {
    return null;
  }
};

/**
 * Fetch model metadata from models.dev API.
 * @param {string} modelId - The model ID (e.g., "claude-opus-4-6", "opencode/grok-code")
 * @returns {Promise<Object|null>} Model metadata or null if not found
 */
export const fetchModelInfoForComment = async modelId => {
  if (!modelId) return null;
  try {
    const apiData = await fetchModelsDevApi();
    if (!apiData) return null;

    const lookupId = modelId.includes('/') ? modelId.split('/').pop() : modelId;

    if (apiData.anthropic?.models?.[lookupId]) {
      const modelInfo = { ...apiData.anthropic.models[lookupId] };
      modelInfo.provider = apiData.anthropic.name || 'Anthropic';
      return modelInfo;
    }

    for (const provider of Object.values(apiData)) {
      if (provider.models && provider.models[lookupId]) {
        const modelInfo = { ...provider.models[lookupId] };
        modelInfo.provider = provider.name || provider.id;
        return modelInfo;
      }
    }

    if (lookupId !== modelId) {
      for (const provider of Object.values(apiData)) {
        if (provider.models && provider.models[modelId]) {
          const modelInfo = { ...provider.models[modelId] };
          modelInfo.provider = provider.name || provider.id;
          return modelInfo;
        }
      }
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Normalize model ID for comparison purposes (strip suffixes, lowercase).
 * @param {string} modelId - A model ID or alias
 * @returns {string} Normalized ID
 */
const normalizeForComparison = modelId => {
  if (!modelId) return '';
  return modelId
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
    .trim();
};

/**
 * Check if a requested model alias matches an actual model ID.
 * @param {string} requestedModel - The --model flag value (alias or full ID)
 * @param {string} actualModelId - The actual model ID from CLI output
 * @param {string|null} tool - The tool being used
 * @returns {boolean}
 */
const doesRequestedMatchActual = (requestedModel, actualModelId, tool) => {
  if (!requestedModel || !actualModelId) return false;
  const resolvedRequested = resolveModelId(requestedModel, tool);
  const normResolved = normalizeForComparison(resolvedRequested);
  const normActual = normalizeForComparison(actualModelId);
  if (normResolved === normActual) return true;
  if (normActual.startsWith(normResolved) || normResolved.startsWith(normActual)) return true;
  return false;
};

/**
 * Build model information string for PR/issue comments.
 *
 * @param {Object} options - Model info options
 * @param {string|null} options.requestedModel - The model requested via --model flag
 * @param {string|null} options.tool - The tool used (claude, agent, opencode, codex, qwen, gemini)
 * @param {Object|null} options.pricingInfo - Pricing info from tool result
 * @param {Object|null} options.modelInfo - Pre-fetched model metadata from models.dev
 * @param {Array<{modelId: string, modelInfo: Object|null}>|null} options.modelsUsed - Actual models used from CLI JSON output
 * @returns {string} Formatted markdown string for model info section
 */
export const buildModelInfoString = ({ requestedModel = null, tool = null, pricingInfo = null, modelInfo = null, modelsUsed = null, thinkingInfo = null, fallbackModel = null } = {}) => {
  const hasRequested = requestedModel !== null && requestedModel !== undefined;
  const hasModelsUsed = Array.isArray(modelsUsed) && modelsUsed.length > 0;
  const hasModelInfo = modelInfo !== null;
  const hasPricingModel = pricingInfo?.modelId || pricingInfo?.modelName;

  if (!hasRequested && !hasModelsUsed && !hasModelInfo && !hasPricingModel) return '';

  let info = '\n\n### \uD83E\uDD16 **Models used:**';

  if (tool) {
    info += `\n- Tool: ${getToolDisplayName(tool)}`;
  }

  if (hasRequested) {
    // Issue #1949: the bare alias (e.g. "opus") is ambiguous \u2014 show the full model
    // ID it resolves to so reviewers know exactly which model ran, e.g.
    // "Requested: `opus` (`claude-opus-4-8`)". When the alias already equals its
    // resolved ID (or cannot be resolved) we just print the alias once.
    const resolvedRequested = resolveModelId(requestedModel, tool);
    if (resolvedRequested && String(resolvedRequested).toLowerCase() !== String(requestedModel).toLowerCase()) {
      info += `\n- Requested: \`${requestedModel}\` (\`${resolvedRequested}\`)`;
    } else {
      info += `\n- Requested: \`${requestedModel}\``;
    }
  }

  // Issue #1949: surface the requested thinking level alongside the model so the
  // comment records how deeply the model was asked to think (null = tool default).
  if (thinkingInfo) {
    info += `\n- Thinking level: ${thinkingInfo}`;
  }

  if (hasModelsUsed) {
    const [mainEntry, ...supportingEntries] = modelsUsed;
    const mainModelId = mainEntry.modelId;
    const mainModelMeta = mainEntry.modelInfo;

    const mainMatches = hasRequested ? doesRequestedMatchActual(requestedModel, mainModelId, tool) : true;

    const mainModelName = mainModelMeta?.name || mainModelId;
    const modelLabel = supportingEntries.length > 0 ? 'Main model' : 'Model';

    // Issue #2037: A mismatch between the requested model and the model that
    // actually ran is *expected* when the run was deliberately downgraded to the
    // configured fallback model (e.g. Codex reported the requested `gpt-5.6-sol`
    // was "at capacity", so the retry loop switched to `gpt-5.5`). In that case
    // the fallback did its job, so surface an informational note instead of an
    // alarming \u26A0\uFE0F warning that reads like a defect.
    const matchesFallback = hasRequested && !mainMatches && fallbackModel ? doesRequestedMatchActual(fallbackModel, mainModelId, tool) : false;

    if (mainMatches) {
      info += `\n- **${modelLabel}: ${mainModelName}** (\`${mainModelId}\`)`;
    } else {
      info += `\n- **${modelLabel}: ${mainModelName}** (\`${mainModelId}\`)`;
      if (hasRequested && matchesFallback) {
        info += `\n- \u2139\uFE0F Requested model \`${requestedModel}\` was unavailable; automatically fell back to \`${mainModelId}\``;
      } else if (hasRequested) {
        info += `\n- \u26A0\uFE0F **Warning**: Main model \`${mainModelId}\` does not match requested model \`${requestedModel}\``;
      }
    }

    if (supportingEntries.length > 0) {
      info += '\n- **Additional models:**';
      for (const entry of supportingEntries) {
        const name = entry.modelInfo?.name || entry.modelId;
        info += `\n  *  **${name}** (\`${entry.modelId}\`)`;
      }
    }
  } else if (hasModelInfo) {
    const mainModelName = modelInfo.name || (pricingInfo?.modelId ? pricingInfo.modelId : null) || 'Unknown';
    info += `\n- Model: ${mainModelName}`;
    if (modelInfo.id) info += ` (ID: \`${modelInfo.id}\`)`;
    if (modelInfo.provider) info += `\n- Provider: ${modelInfo.provider}`;
    if (modelInfo.knowledge) info += `\n- Knowledge cutoff: ${modelInfo.knowledge}`;
  } else if (hasPricingModel) {
    const modelId = pricingInfo.modelId || null;
    const modelName = pricingInfo.modelName || modelId || 'Unknown';
    if (modelId && modelId !== modelName) {
      info += `\n- Model: ${modelName} (ID: \`${modelId}\`)`;
    } else {
      info += `\n- Model: ${modelName}`;
    }
    if (pricingInfo.provider) info += `\n- Provider: ${pricingInfo.provider}`;
  }

  return info;
};

/**
 * Resolve the full model ID from a user-provided alias using the model mapping.
 * @param {string|null} requestedModel - The model alias (e.g., "opus", "sonnet")
 * @param {string|null} tool - The tool being used
 * @returns {string|null} The full model ID or null
 */
export const resolveModelId = (requestedModel, tool) => {
  if (!requestedModel) return null;

  try {
    const toolName = (tool || 'claude').toString().toLowerCase();
    const cleanModel = requestedModel.replace(/\[1m\]$/i, '');
    return mapModelForTool(toolName, cleanModel);
  } catch {
    return requestedModel;
  }
};

export const defaultFallbackModels = {
  claude: {
    // Claude Fable 5's safety classifiers can refuse high-risk requests and hand them
    // off to Claude Opus 4.8; mirror that documented fallback here (Issue #1875).
    // See: https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5
    'claude-fable-5': 'opus',
    // Claude Mythos 5 (limited availability) falls back to the generally available
    // Mythos-class model, Claude Fable 5 (Issue #1875).
    'claude-mythos-5': 'fable',
    'claude-opus-4-8': 'opus-4-7',
    'claude-opus-4-7': 'opus-4-6',
    // Claude Sonnet 5 falls back to the prior Sonnet generation (Issue #2003).
    'claude-sonnet-5': 'sonnet-4-6',
  },
  codex: {
    'gpt-5.6-sol': 'gpt-5.5',
    'gpt-5.6-terra': 'gpt-5.5',
    'gpt-5.6-luna': 'gpt-5.5',
    'openai.gpt-5.6-sol': 'openai.gpt-5.5',
    'openai.gpt-5.6-terra': 'openai.gpt-5.5',
    'openai.gpt-5.6-luna': 'openai.gpt-5.5',
    'openai.gpt-5.5': 'openai.gpt-5.4',
    'gpt-5.5': 'gpt-5.4',
  },
};

export const resolveDefaultFallbackModel = (tool, model) => {
  if (!model) return null;

  const toolName = (tool || 'claude').toString().toLowerCase();
  const resolvedModel = resolveModelId(model, toolName);
  return defaultFallbackModels[toolName]?.[resolvedModel] || null;
};

/**
 * Fetch model info and build the complete model information string for PR comments.
 * Uses actual models from CLI JSON output when available.
 *
 * @param {Object} options
 * @param {string|null} options.requestedModel - The --model flag value
 * @param {string|null} options.tool - The tool used (claude, agent, opencode, codex, qwen, gemini)
 * @param {Object|null} options.pricingInfo - Pricing info from tool result
 * @param {Array<string>|null} options.actualModelIds - Actual model IDs from CLI JSON output
 * @returns {Promise<string>} Formatted markdown model info section
 */
export const getModelInfoForComment = async ({ requestedModel = null, tool = null, pricingInfo = null, actualModelIds = null, thinkingInfo = null, fallbackModel = null } = {}) => {
  let modelIds = [];

  if (Array.isArray(actualModelIds) && actualModelIds.length > 0) {
    modelIds = actualModelIds;
  } else if (pricingInfo?.modelId) {
    modelIds = [pricingInfo.modelId];
  } else if (requestedModel) {
    const resolved = resolveModelId(requestedModel, tool);
    if (resolved) modelIds = [resolved];
  }

  const modelsUsed = [];
  for (const modelId of modelIds) {
    let meta = null;
    try {
      meta = await fetchModelInfoForComment(modelId);
    } catch {
      await log('  \u26A0\uFE0F  Could not fetch model info from models.dev', { verbose: true });
    }
    modelsUsed.push({ modelId, modelInfo: meta });
  }

  const firstModelInfo = modelsUsed.length > 0 ? modelsUsed[0].modelInfo : null;

  return buildModelInfoString({
    requestedModel,
    tool,
    pricingInfo,
    modelInfo: modelsUsed.length === 0 ? firstModelInfo : null,
    modelsUsed: modelsUsed.length > 0 ? modelsUsed : null,
    thinkingInfo,
    fallbackModel,
  });
};
