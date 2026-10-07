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
import { FORMAL_AI_MODEL_ALIAS, isFormalAiModel } from '../formal-ai-model.lib.mjs';

const execFileAsync = promisify(execFile);

// ─── MODEL DATA ──────────────────────────────────────────────────────────────

// Defined in a leaf module so callers that only need the identity check (the
// Formal AI sidecar lifecycle, issue #2146) do not have to import this catalogue
// and its `use-m` bootstrap. Re-exported here so the public surface is unchanged.
export { FORMAL_AI_MODEL_ALIAS, FORMAL_AI_PROVIDER_MODEL_ID, isFormalAiModel } from '../formal-ai-model.lib.mjs';

// The bundled catalogue itself lives in ./catalog.mjs (issue #2202); everything
// it exports is re-exported here, so `src/models/index.mjs` remains the single
// import site for callers. The named import is what the functions below read —
// `export *` re-exports without binding the names locally.
export * from './catalog.mjs';
import { AGENT_MODELS, agentModels, CLAUDE_MODELS, claudeModels, CODEX_FAMILY_ALIASES, CODEX_MODEL_VARIANTS, CODEX_MODELS, defaultModels, GEMINI_MODELS, geminiModels, HIDDEN_CODEX_MODEL_IDS, LEGACY_CLAUDE_MODEL_ALIASES, legacyCodexModels, MODELS_SUPPORTING_1M_CONTEXT, OPENCODE_MODELS, opencodeModels, QWEN_MODELS, qwenModels } from './catalog.mjs';
import { deriveClaudeFamilyAliases, deriveCodexFamilyAliases, getRuntimeModelAlias, listClaudeFamilies, registerRuntimeModelAlias } from './aliases.mjs';
export { clearRuntimeModelAliases, deriveClaudeFamilyAliases, deriveCodexFamilyAliases, getRuntimeModelAlias, registerRuntimeModelAlias } from './aliases.mjs';

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
      return CODEX_MODEL_VARIANTS;
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
let cachedInstalledCodexCatalogue = null;
// Issue #2591: a long-running process (the Telegram bot) must notice models the
// Codex CLI starts advertising after an upgrade, so the catalogue is re-read
// once this TTL passes. Override with HIVE_MIND_CODEX_MODELS_CACHE_TTL_MS.
const parsedCodexModelsCacheTtl = Number.parseInt(process.env.HIVE_MIND_CODEX_MODELS_CACHE_TTL_MS ?? '', 10);
const CODEX_MODELS_CACHE_TTL_MS = Number.isFinite(parsedCodexModelsCacheTtl) && parsedCodexModelsCacheTtl >= 0 ? parsedCodexModelsCacheTtl : 60 * 60 * 1000;
// Issue #2290: the preferred default is discovered from the installed Codex
// catalogue. This chain is only consulted when that catalogue exposes no Sol
// model at all, and remains ordered by capability rather than release number.
const CODEX_DEFAULT_FALLBACK_CHAIN = ['gpt-5.6-terra', 'openai.gpt-5.6-terra', 'gpt-5.5', 'openai.gpt-5.5', 'gpt-6-luna', 'openai.gpt-6-luna', 'gpt-5.4', 'openai.gpt-5.4', 'gpt-5.2', 'gpt-5.6-luna', 'openai.gpt-5.6-luna', 'gpt-5.5-mini', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2-codex', 'gpt-5.5-nano', 'gpt-5.4-nano'];

const CODEX_SOL_PATTERN = /^(?:(openai)[/.])?gpt-(\d+(?:\.\d+)*)-sol$/i;

const compareNumericVersions = (left, right) => {
  const leftParts = String(left).split('.').map(Number);
  const rightParts = String(right).split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/** The newest Sol ID advertised by a Codex catalogue, without a bundled allowlist. */
export const selectLatestCodexSolModel = (models = []) =>
  [...new Set(Array.isArray(models) ? models.filter(model => typeof model === 'string') : [])]
    .map(model => ({ model, match: model.match(CODEX_SOL_PATTERN) }))
    .filter(candidate => candidate.match)
    .sort((left, right) => compareNumericVersions(right.match[2], left.match[2]) || Number(Boolean(left.match[1])) - Number(Boolean(right.match[1])))[0]?.model ?? null;

/**
 * The installed Codex CLI's model catalogue (`codex debug models`) as
 * `[{ slug, visibility }]`, or null when the CLI is unavailable.
 */
export const getInstalledCodexModelCatalogue = async () => {
  if (!cachedInstalledCodexCatalogue || Date.now() - cachedInstalledCodexCatalogue.loadedAt > CODEX_MODELS_CACHE_TTL_MS) {
    cachedInstalledCodexCatalogue = {
      loadedAt: Date.now(),
      promise: (async () => {
        try {
          const { stdout } = await execFileAsync('codex', ['debug', 'models'], {
            encoding: 'utf8',
            maxBuffer: 10 * 1024 * 1024,
          });
          const parsed = JSON.parse(stdout);
          if (!Array.isArray(parsed?.models)) return null;
          const seen = new Set();
          return parsed.models.filter(model => model?.slug && !seen.has(model.slug) && seen.add(model.slug)).map(model => ({ slug: model.slug, visibility: model.visibility ?? 'list' }));
        } catch {
          return null;
        }
      })(),
    };
  }

  return cachedInstalledCodexCatalogue.promise;
};

export const getInstalledCodexModels = async () => {
  const catalogue = await getInstalledCodexModelCatalogue();
  return catalogue ? catalogue.map(model => model.slug) : null;
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

  const latestSol = selectLatestCodexSolModel(availableCodexModels);
  if (latestSol) return latestSol;

  return CODEX_DEFAULT_FALLBACK_CHAIN.find(model => availableCodexModels.includes(model)) || preferredDefault;
};

/**
 * Map model name to full model ID for a specific tool
 * @param {string} tool - The tool name (claude, agent, opencode, codex, qwen, gemini)
 * @param {string} model - The model name or alias
 * @returns {string} The full model ID
 */
export const mapModelForTool = (tool, model) => {
  // Aliases resolved against a live catalogue during validation (Issue #2591).
  const runtimeAlias = getRuntimeModelAlias(tool, model);
  if (runtimeAlias) return runtimeAlias;
  switch (tool) {
    case 'claude':
      return claudeModels[model] || model;
    case 'agent':
      return agentModels[model] || model;
    case 'opencode':
      return opencodeModels[model] || model;
    case 'codex':
      return CODEX_MODEL_VARIANTS[model] || model;
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
  if (isFormalAiModel(model)) {
    return ['claude', 'agent', 'opencode', 'codex', 'qwen', 'gemini'].includes(tool);
  }

  const mappedModel = mapModelForTool(tool, model);

  switch (tool) {
    case 'claude':
      return mappedModel.startsWith('claude-') || mappedModel === 'opusplan';
    case 'agent':
      return mappedModel.includes('/') || Object.keys(agentModels).includes(model);
    case 'opencode':
      return mappedModel.includes('/') || Object.keys(opencodeModels).includes(model);
    case 'codex':
      return Object.hasOwn(CODEX_MODEL_VARIANTS, model);
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
      return Object.keys(CODEX_MODEL_VARIANTS);
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
  claude: ['opus', 'sonnet', 'haiku', 'opusplan', 'fable', 'mythos', 'best', FORMAL_AI_MODEL_ALIAS],
  opencode: ['grok', 'gpt4o', FORMAL_AI_MODEL_ALIAS],
  // Issue #2591: the Codex CLI's current models plus the family aliases that always name the newest of each
  codex: ['sol', 'astra', 'luna', 'terra', 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', FORMAL_AI_MODEL_ALIAS],
  agent: ['nemotron-3-super-free', 'minimax-m2.5-free', 'big-pickle', 'gpt-5-nano', 'glm-5-free', 'deepseek-r1-free', FORMAL_AI_MODEL_ALIAS],
  qwen: ['qwen3-coder-plus', 'qwen3-coder', 'qwen3-coder-flash', FORMAL_AI_MODEL_ALIAS],
  gemini: ['flash', 'pro', 'flash-lite', 'auto', FORMAL_AI_MODEL_ALIAS],
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
// Accepted for compatibility but not advertised: models the vendor CLI no
// longer lists, provider-prefixed spellings, and dotted duplicates of pinned
// Claude versions (Issue #2591).
const CODEX_UNLISTED_MODEL_NAMES = new Set([...Object.keys(legacyCodexModels), ...HIDDEN_CODEX_MODEL_IDS]);
const isListedModelName = (tool, key, modelId) => {
  switch (tool) {
    case 'codex': {
      if (/^openai[/.]/.test(key)) return false;
      if (CODEX_UNLISTED_MODEL_NAMES.has(key)) return false;
      // An alias is only worth showing when its target is itself listed.
      return !CODEX_UNLISTED_MODEL_NAMES.has(modelId);
    }
    case 'claude':
      return !/\d\.\d/.test(key) && !LEGACY_CLAUDE_MODEL_ALIASES.includes(key);
    default:
      return true;
  }
};

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
    return isListedModelName(tool, key, modelMap[key]);
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
  return buildUnrecognizedModelResult(model, tool, getAvailableModelNames(tool));
};

const buildUnrecognizedModelResult = (model, tool, shortNames) => {
  const { baseModel } = parseModelWith1mSuffix(model);
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

const normalizeRuntimeModelIds = models => {
  if (!Array.isArray(models)) return [];
  return [...new Set(models.map(model => (typeof model === 'string' ? model : model?.id)).filter(model => typeof model === 'string' && model.length > 0))];
};

const listMergedLiveModelIds = merged => normalizeRuntimeModelIds([...(merged?.bundledAndLive ?? []), ...(merged?.liveOnly ?? [])]);

const looksLikeDirectProviderModelId = (model, tool) => {
  if (typeof model !== 'string' || model.length > 200 || !/^[a-z0-9][a-z0-9._:/-]*$/i.test(model)) return false;
  const normalized = model.toLowerCase();
  switch (tool) {
    // Claude Code explicitly passes `claude-*` names through to Anthropic (and
    // arbitrary gateway names through a custom base URL). Restricting this
    // fallback to provider-shaped IDs preserves useful typo checks for aliases.
    case 'claude':
      return normalized.startsWith('claude-') || normalized.startsWith('anthropic/') || normalized.startsWith('anthropic.');
    case 'agent':
    case 'opencode':
      return /^[a-z0-9._-]+\/[a-z0-9][a-z0-9._:-]*$/i.test(model);
    case 'gemini':
      return normalized.startsWith('gemini-');
    case 'qwen':
      return normalized.startsWith('qwen');
    default:
      // Codex has a local, authoritative catalogue. Do not turn every `gpt-*`
      // typo into a late provider failure when `codex debug models` can decide.
      return false;
  }
};

const OPENAI_MODEL_PREFIX_PATTERN = /^openai[/.]/i;
const CLAUDE_FAMILY_SHORTHAND_PATTERN = /^([a-z]+)-(\d+(?:[-.]\d+)?)$/;

/** Whether an input is a bare family alias whose target a live catalogue may move (Issue #2591). */
const isLiveFamilyAliasCandidate = (toolName, baseModel) => {
  const alias = String(baseModel).toLowerCase();
  if (toolName === 'codex') return Object.hasOwn(CODEX_FAMILY_ALIASES, alias.replace(OPENAI_MODEL_PREFIX_PATTERN, ''));
  if (toolName === 'claude') return listClaudeFamilies(Object.values(claudeModels)).includes(alias);
  return false;
};

/**
 * Resolve a family alias against a live catalogue: `nova` once the Codex CLI
 * lists `gpt-7-nova`, or `sol` → `gpt-6.2-sol` before this release knows it.
 * Codex's own catalogue is authoritative; for Claude the live IDs extend the
 * bundled ones, because the router catalogue is not exhaustive (Issue #2591).
 */
const resolveLiveFamilyAlias = (toolName, baseModel, liveModels) => {
  if (liveModels.length === 0) return null;
  if (toolName === 'codex') {
    const prefix = baseModel.match(OPENAI_MODEL_PREFIX_PATTERN)?.[0]?.toLowerCase() ?? '';
    const target = deriveCodexFamilyAliases(liveModels)[baseModel.slice(prefix.length).toLowerCase()];
    return target ? `${prefix}${target}` : null;
  }
  if (toolName === 'claude') return deriveClaudeFamilyAliases([...Object.values(claudeModels), ...liveModels])[baseModel.toLowerCase()] ?? null;
  return null;
};

/**
 * Claude Code accepts any `claude-<family>-<version>` ID, so the shorthand
 * `opus-6` / `sonnet-5.7` of a known family is expanded to that ID instead of
 * being rejected for not existing when this release was cut (Issue #2591).
 */
const expandClaudeFamilyShorthand = (baseModel, liveModels) => {
  const match = String(baseModel).toLowerCase().match(CLAUDE_FAMILY_SHORTHAND_PATTERN);
  if (!match || !listClaudeFamilies([...Object.values(claudeModels), ...liveModels]).includes(match[1])) return null;
  return `claude-${match[1]}-${match[2].replace(/\./g, '-')}`;
};

const loadRuntimeModels = async (toolName, options) => {
  if (options.availableModels !== undefined) return { models: normalizeRuntimeModelIds(options.availableModels), hidden: new Set() };
  const models = [];
  const hidden = new Set();
  if (toolName === 'codex') {
    for (const entry of (await getInstalledCodexModelCatalogue()) ?? []) {
      models.push(entry.slug);
      if (entry.visibility === 'hide') hidden.add(entry.slug);
    }
  }

  if (options.useRouter || options.loadCatalogue) {
    try {
      const getCatalogue = options.getCatalogue ?? (await import('../model-catalogue.lib.mjs')).getMergedModelCatalogue;
      const merged = await getCatalogue({ tool: toolName, ...(options.catalogueOptions ?? {}) });
      models.push(...listMergedLiveModelIds(merged));
    } catch {
      // Discovery is best-effort. The original validation error remains more
      // useful than a Docker/network error from an optional catalogue source.
    }
  }
  return { models: normalizeRuntimeModelIds(models), hidden };
};

// When the installed Codex CLI answers, the listing in an error is what that
// CLI offers right now — its visible models and their family aliases — rather
// than this release's snapshot (Issue #2591).
const listRuntimeModelNames = (toolName, models, hidden) => {
  if (toolName !== 'codex' || models.length === 0) return getAvailableModelNames(toolName);
  const visible = models.filter(model => !hidden.has(model));
  const aliases = Object.entries(deriveCodexFamilyAliases(visible))
    .filter(([alias]) => !visible.includes(alias))
    .map(([alias]) => alias);
  return [...new Set([...aliases, FORMAL_AI_MODEL_ALIAS, ...visible])];
};

const withInstalledCatalogueWarning = (result, toolName, model, models) => {
  if (!result.valid || toolName !== 'codex' || models.length === 0 || isFormalAiModel(model)) return result;
  const bareModel = String(result.mappedModel).replace(OPENAI_MODEL_PREFIX_PATTERN, '');
  if (models.includes(bareModel)) return result;
  return { ...result, warning: `Model "${model}" (${result.mappedModel}) is not in the installed Codex CLI's catalogue (codex debug models); the run may fail if the account cannot use it.` };
};

/**
 * Validate a model against the authoritative runtime catalogue.
 *
 * Static aliases and IDs are checked first. Family aliases (`sol`, `astra`,
 * `mythos`, or a family introduced after this release) are resolved against
 * the installed CLI's catalogue so they always name its newest member, and the
 * result is registered for the execution-time mapping (Issue #2591). A new
 * exact ID is accepted when the installed CLI/router reports it, even when
 * Hive Mind was released before that model existed.
 */
export const validateRuntimeModelName = async (model, tool = 'claude', options = {}) => {
  const staticValidation = validateModelName(model, tool);
  const toolName = String(tool || 'claude').toLowerCase();
  const { baseModel, has1mSuffix } = parseModelWith1mSuffix(model);
  if (staticValidation.valid && (has1mSuffix || !isLiveFamilyAliasCandidate(toolName, baseModel))) return { ...staticValidation, source: 'bundled' };

  const { models: availableModels, hidden } = await loadRuntimeModels(toolName, options);
  const finish = result => withInstalledCatalogueWarning(result, toolName, model, availableModels);

  if (!has1mSuffix) {
    const liveAlias = resolveLiveFamilyAlias(toolName, baseModel, availableModels);
    if (liveAlias) {
      registerRuntimeModelAlias(toolName, baseModel, liveAlias);
      return finish({ valid: true, mappedModel: liveAlias, has1mSuffix: false, source: 'live-alias' });
    }
  }
  if (staticValidation.valid) return finish({ ...staticValidation, source: 'bundled' });

  const exact = availableModels.find(candidate => candidate.toLowerCase() === String(baseModel).toLowerCase());
  if (exact && !has1mSuffix) {
    return finish({ valid: true, mappedModel: exact, has1mSuffix: false, source: 'live' });
  }

  if (!has1mSuffix && toolName === 'claude') {
    const expanded = expandClaudeFamilyShorthand(baseModel, availableModels);
    if (expanded) {
      registerRuntimeModelAlias(toolName, baseModel, expanded);
      return { valid: true, mappedModel: expanded, has1mSuffix: false, source: 'provider' };
    }
  }

  if (!has1mSuffix && looksLikeDirectProviderModelId(baseModel, toolName)) {
    return { valid: true, mappedModel: baseModel, has1mSuffix: false, source: 'provider' };
  }

  return toolName === 'codex' && availableModels.length > 0 ? buildUnrecognizedModelResult(model, toolName, listRuntimeModelNames(toolName, availableModels, hidden)) : staticValidation;
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
export const validateAndExitOnInvalidModel = async (model, tool = 'claude', exitFn = null, options = {}) => {
  const result = await validateRuntimeModelName(model, tool, options);
  // --verbose shows which catalogue resolved the model (Issue #2591).
  if (result.valid) await log(`   Model "${model}" → ${result.mappedModel} (source: ${result.source})`, { verbose: true });
  if (result.warning) await log(`⚠️  ${result.warning}`, { level: 'warning' });

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
/**
 * Compute the share (0-100) of total output tokens that a given model produced.
 * Used to report how much of the run actually ran on the fallback model, so the
 * PR/issue comment can manage expectations precisely (Issue #2037 review).
 * @param {Object|null} modelUsage - map of modelId -> { outputTokens } (or output_tokens)
 * @param {string} modelId - the model whose share to compute
 * @returns {number|null} integer percentage, or null when no output-token data
 */
const computeOutputTokenSharePercent = (modelUsage, modelId) => {
  if (!modelUsage || typeof modelUsage !== 'object' || !modelId) return null;
  const target = normalizeForComparison(modelId);
  let total = 0;
  let matched = 0;
  for (const [id, usage] of Object.entries(modelUsage)) {
    const out = Number(usage?.outputTokens ?? usage?.output_tokens ?? 0) || 0;
    if (out <= 0) continue;
    total += out;
    if (normalizeForComparison(id) === target) matched += out;
  }
  if (total <= 0) return null;
  return Math.round((matched / total) * 100);
};

export const buildModelInfoString = ({ requestedModel = null, tool = null, pricingInfo = null, modelInfo = null, modelsUsed = null, thinkingInfo = null, fallbackModel = null, modelUsage = null } = {}) => {
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
    // actually ran happens when the run was downgraded to the configured fallback
    // model (e.g. Codex reported the requested `gpt-5.6-sol` was "at capacity", so
    // the retry loop switched to `gpt-5.6-terra`). Even though the fallback did its
    // job, the user did *not* get the model they asked for in full detail, so this
    // is still surfaced as a \u26A0\uFE0F warning (Issue #2037 review) \u2014 but a
    // clearer one that explains it was an automatic capacity fallback rather than an
    // unexplained mismatch. When output-token data is available we also report the
    // share of output tokens produced by the fallback model, so expectations are set
    // precisely.
    const matchesFallback = hasRequested && !mainMatches && fallbackModel ? doesRequestedMatchActual(fallbackModel, mainModelId, tool) : false;

    if (mainMatches) {
      info += `\n- **${modelLabel}: ${mainModelName}** (\`${mainModelId}\`)`;
    } else {
      info += `\n- **${modelLabel}: ${mainModelName}** (\`${mainModelId}\`)`;
      if (hasRequested) {
        const sharePercent = computeOutputTokenSharePercent(modelUsage, mainModelId);
        const shareSuffix = sharePercent !== null ? ` (fallback model produced ${sharePercent}% of output tokens)` : '';
        if (matchesFallback) {
          info += `\n- \u26A0\uFE0F **Warning**: Requested model \`${requestedModel}\` was unavailable (at capacity); automatically fell back to \`${mainModelId}\`${shareSuffix}`;
        } else {
          info += `\n- \u26A0\uFE0F **Warning**: Main model \`${mainModelId}\` does not match requested model \`${requestedModel}\`${shareSuffix}`;
        }
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
    // off to Claude Opus; mirror that documented fallback here (Issue #1875).
    // See: https://platform.claude.com/docs/en/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5
    'claude-fable-5': 'opus',
    // Claude Fable 5.1 steps down to the previous Fable generation before leaving
    // the Mythos class entirely, so a capacity failure keeps the same model family
    // (Issue #2202).
    'claude-fable-5-1': 'fable-5',
    // Claude Mythos 5 (limited availability) falls back to the generally available
    // Mythos-class model, Claude Fable 5 (Issue #1875).
    'claude-mythos-5': 'fable',
    // Claude Mythos 5.1 (invite only) falls back to the generally available
    // Mythos-class model, which the `fable` alias now resolves to (Issue #2202).
    'claude-mythos-5-1': 'fable',
    // Opus 5.5 is the current pinned Opus ID. The bare `opus` default is kept
    // rolling for direct Claude Code runs (Issue #2290).
    'claude-opus-5-5': 'opus-5',
    // Claude Opus 5 falls back to the prior Opus generation (Issue #2096).
    'claude-opus-5': 'opus-4-8',
    'claude-opus-4-8': 'opus-4-7',
    'claude-opus-4-7': 'opus-4-6',
    // Claude Sonnet 5.5 falls back to Sonnet 5, Sonnet 5 to the prior Sonnet generation (Issue #2003, #2591).
    'claude-sonnet-5-5': 'sonnet-5',
    'claude-sonnet-5': 'sonnet-4-6',
  },
  codex: {
    // GPT-6.1 Sol steps down to the previous Sol generation (Issue #2591).
    'gpt-6.1-sol': 'gpt-6-sol',
    'openai.gpt-6.1-sol': 'openai.gpt-6-sol',
    'gpt-6-sol': 'gpt-5.6-sol',
    'openai.gpt-6-sol': 'openai.gpt-5.6-sol',
    'gpt-6-luna': 'gpt-5.6-sol',
    'openai.gpt-6-luna': 'openai.gpt-5.6-sol',
    'gpt-reserve': 'gpt-6-sol',
    // Issue #2037 (review): order fallbacks by *intelligence / size tier*, not by
    // generation. Within GPT-5.6, `sol` is the flagship and `terra` is the next tier
    // down; `luna` is a smaller/cheaper variant. When `gpt-5.6-sol` is at capacity the
    // closest replacement is `gpt-5.6-terra`, and the next-closest to `gpt-5.6-terra`
    // is the previous generation's flagship `gpt-5.5` (a larger, more capable model
    // than the smaller `gpt-5.6-luna`), then `gpt-5.5 -> gpt-5.4 -> gpt-5.2`, and so
    // on. So the flagship chain walks sol -> terra -> gpt-5.5 -> gpt-5.4 -> gpt-5.2
    // and never detours through the smaller `luna` tier. The smaller `luna` variant,
    // if requested directly, steps down to the previous full generation as well.
    // GPT-6 Astra is preview-gated, so a fallback is the difference between a
    // degraded run and a failed one; it steps down to the GPT-5.6 flagship
    // (Issue #2202).
    // Astra now steps down to the latest workhorse, GPT-6.1 Sol (Issue #2591).
    'gpt-6-astra': 'gpt-6.1-sol',
    'openai.gpt-6-astra': 'openai.gpt-6.1-sol',
    'gpt-5.6-sol': 'gpt-5.6-terra',
    'gpt-5.6-terra': 'gpt-5.5',
    'gpt-5.6-luna': 'gpt-5.5',
    // GPT-5.6 Cyber is gated on the Daybreak program (Issue #2202).
    'gpt-5.6-cyber': 'gpt-5.6-sol',
    'openai.gpt-5.6-cyber': 'openai.gpt-5.6-sol',
    'openai.gpt-5.6-sol': 'openai.gpt-5.6-terra',
    'openai.gpt-5.6-terra': 'openai.gpt-5.5',
    'openai.gpt-5.6-luna': 'openai.gpt-5.5',
    'openai.gpt-5.5': 'openai.gpt-5.4',
    'openai.gpt-5.4': 'openai.gpt-5.2',
    'gpt-5.5': 'gpt-5.4',
    'gpt-5.4': 'gpt-5.2',
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
export const getModelInfoForComment = async ({ requestedModel = null, tool = null, pricingInfo = null, actualModelIds = null, thinkingInfo = null, fallbackModel = null, modelUsage = null } = {}) => {
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
    modelUsage,
  });
};
