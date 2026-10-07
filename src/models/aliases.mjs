#!/usr/bin/env node

/**
 * "Latest version" aliases derived from model IDs (issue #2591).
 *
 * Vendors name models after a family and a version: `gpt-6-astra`,
 * `gpt-6.1-sol`, `claude-mythos-5-1`. The obvious alias for each family —
 * `astra`, `sol`, `mythos` — means "the newest member of that family", so it is
 * computed from whatever model IDs are known instead of being listed by hand.
 * The same functions run over the bundled catalogue (./catalog.mjs) and over the
 * live catalogue reported by an installed CLI (`codex debug models`), so a family
 * introduced after this release gets its alias without a code change.
 *
 * This is a leaf module with no imports so ./catalog.mjs and
 * ../codex.options.lib.mjs can use it without the `use-m` bootstrap.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2591
 */

// gpt-<generation>-<family>: gpt-6-astra, gpt-6.1-sol, gpt-5.6-terra
const CODEX_FAMILY_MODEL_PATTERN = /^gpt-(\d+(?:\.\d+)*)-([a-z]+)$/;
// gpt-<name>-latest: gpt-daybreak-blue-latest → daybreak-blue
const CODEX_LATEST_MODEL_PATTERN = /^gpt-([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*)-latest$/;
// claude-<family>-<major>[-<minor>] without a date suffix: claude-mythos-5-1
const CLAUDE_FAMILY_MODEL_PATTERN = /^claude-([a-z]+)-(\d+(?:-\d+)?)$/;
const OPENAI_MODEL_PREFIX_PATTERN = /^openai[/.]/;

export const compareNumericVersions = (left, right) => {
  const leftParts = String(left).split(/[.-]/).map(Number);
  const rightParts = String(right).split(/[.-]/).map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

const toModelIdList = models => {
  const values = Array.isArray(models) ? models : Object.values(models ?? {});
  return [...new Set(values.map(model => (typeof model === 'string' ? model : (model?.id ?? model?.slug))).filter(model => typeof model === 'string' && model.length > 0))];
};

/**
 * Codex family aliases: every `gpt-<version>-<family>` model makes `<family>`
 * resolve to the newest version of that family, and `gpt-<name>-latest` makes
 * `<name>` an alias for it.
 *
 * Each family advances on its own. Issue #2043 advanced sol/terra/luna only as
 * a complete trio, which kept `sol` on GPT-5.6 once GPT-6 shipped Sol and Luna
 * without a Terra, and gave the new Astra family no alias at all (issue #2591).
 *
 * @param {string[]|Object} models - Model IDs, or a map whose values are model IDs
 * @returns {Object<string, string>} alias → newest model ID
 */
export const deriveCodexFamilyAliases = models => {
  const newest = new Map();
  const aliases = {};

  for (const modelId of toModelIdList(models)) {
    const bareModelId = modelId.replace(OPENAI_MODEL_PREFIX_PATTERN, '');
    const familyMatch = bareModelId.match(CODEX_FAMILY_MODEL_PATTERN);
    if (familyMatch) {
      const [, version, family] = familyMatch;
      const current = newest.get(family);
      if (!current || compareNumericVersions(version, current.version) > 0) newest.set(family, { version, modelId: bareModelId });
      continue;
    }
    const latestMatch = bareModelId.match(CODEX_LATEST_MODEL_PATTERN);
    if (latestMatch) aliases[latestMatch[1]] = bareModelId;
  }

  for (const [family, { modelId }] of newest) aliases[family] = modelId;
  return aliases;
};

/**
 * Claude family aliases: every undated `claude-<family>-<version>` ID gives
 * `<family>-<version>` (and the dotted `<family>-5.5` / `claude-<family>-5.5`
 * spellings), and `<family>` resolves to the newest version of that family.
 *
 * @param {string[]|Object} models - Model IDs, or a map whose values are model IDs
 * @returns {Object<string, string>} alias → model ID
 */
export const deriveClaudeFamilyAliases = models => {
  const newest = new Map();
  const aliases = {};

  for (const modelId of toModelIdList(models)) {
    const match = modelId.match(CLAUDE_FAMILY_MODEL_PATTERN);
    if (!match) continue;
    const [, family, version] = match;
    const dottedVersion = version.replace(/-/g, '.');
    aliases[`${family}-${version}`] = modelId;
    aliases[`${family}-${dottedVersion}`] = modelId;
    aliases[`claude-${family}-${dottedVersion}`] = modelId;
    const current = newest.get(family);
    if (!current || compareNumericVersions(version, current.version) > 0) newest.set(family, { version, modelId });
  }

  for (const [family, { modelId }] of newest) aliases[family] = modelId;
  return aliases;
};

/** The Claude families named by a set of model IDs (opus, sonnet, haiku, fable, mythos, ...). */
export const listClaudeFamilies = models => [
  ...new Set(
    toModelIdList(models)
      .map(modelId => modelId.match(CLAUDE_FAMILY_MODEL_PATTERN)?.[1])
      .filter(Boolean)
  ),
];

export const deriveFamilyAliasesForTool = (tool, models) => {
  switch (String(tool || '').toLowerCase()) {
    case 'codex':
      return deriveCodexFamilyAliases(models);
    case 'claude':
      return deriveClaudeFamilyAliases(models);
    default:
      return {};
  }
};

// ─── RUNTIME ALIASES ─────────────────────────────────────────────────────────
// Validation can resolve an alias against a live catalogue (an alias for a
// family released after this build, or a newer member of a known family). The
// result is recorded here so every later synchronous mapping in the same process
// — the CLI argument, PR comments, fallback selection — agrees with validation.

const runtimeModelAliases = new Map();

export const registerRuntimeModelAlias = (tool, alias, modelId) => {
  if (!tool || typeof alias !== 'string' || typeof modelId !== 'string') return;
  const toolName = String(tool).toLowerCase();
  if (!runtimeModelAliases.has(toolName)) runtimeModelAliases.set(toolName, new Map());
  runtimeModelAliases.get(toolName).set(alias.toLowerCase(), modelId);
};

export const getRuntimeModelAlias = (tool, alias) => {
  if (!tool || typeof alias !== 'string') return undefined;
  return runtimeModelAliases.get(String(tool).toLowerCase())?.get(alias.toLowerCase());
};

export const clearRuntimeModelAliases = () => runtimeModelAliases.clear();
