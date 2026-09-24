import { CLAUDE_MODELS as availableModels } from './models/index.mjs';
import { fetchModelInfo } from './model-info.lib.mjs';

export const formatNumber = num => {
  if (num === null || num === undefined) return 'N/A';
  const parts = num.toString().split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decimalPart !== undefined ? `${formattedInteger}.${decimalPart}` : formattedInteger;
};

const ROLLING_CLAUDE_ALIASES = new Set(['opus', 'sonnet', 'haiku']);

export const mapModelToId = (model, { preserveRollingAlias = false } = {}) => {
  if (!model || typeof model !== 'string') return model;
  const match = model.match(/^(.+?)\[1m\]$/i);
  if (match) {
    const baseModel = match[1];
    if (preserveRollingAlias && ROLLING_CLAUDE_ALIASES.has(baseModel.toLowerCase())) return `${baseModel.toLowerCase()}[1m]`;
    const mappedBase = availableModels[baseModel] || baseModel;
    return `${mappedBase}[1m]`;
  }
  if (preserveRollingAlias && ROLLING_CLAUDE_ALIASES.has(model.toLowerCase())) return model.toLowerCase();
  return availableModels[model] || model;
};

const compareClaudeVersionParts = (left, right) => {
  const leftParts = left.map(Number);
  const rightParts = right.map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

export const selectLatestClaudeFamilyModel = (family, models = []) => {
  const pattern = new RegExp(`^claude-${family}-(\\d+(?:-\\d+)*)$`, 'i');
  return (
    [...new Set(Array.isArray(models) ? models.map(model => (typeof model === 'string' ? model : model?.id)).filter(Boolean) : [])]
      .map(model => ({ model, match: model.match(pattern) }))
      .filter(candidate => candidate.match)
      .sort((left, right) => compareClaudeVersionParts(right.match[1].split('-'), left.match[1].split('-')))[0]?.model ?? null
  );
};

/**
 * Resolve Claude's rolling aliases at the last responsible moment.
 *
 * Direct Claude Code runs keep the alias so the vendor advances it. Routers
 * intentionally deal in concrete IDs, so routed runs resolve the newest family
 * member from the live catalogue and fall back to the bundled pin only when no
 * live source answers.
 */
export const resolveClaudeModelForExecution = async (model, { useRouter = false, availableModels = undefined, getCatalogue = null, catalogueOptions = {} } = {}) => {
  if (!model || typeof model !== 'string') return model;
  const suffixMatch = model.match(/^(.+?)(\[1m\])$/i);
  const baseModel = suffixMatch?.[1] ?? model;
  const suffix = suffixMatch?.[2] ?? '';
  const family = baseModel.toLowerCase();
  if (!ROLLING_CLAUDE_ALIASES.has(family)) return mapModelToId(model);
  if (!useRouter) return `${family}${suffix}`;

  let liveModels = availableModels;
  if (liveModels === undefined) {
    try {
      const loader = getCatalogue ?? (await import('./model-catalogue.lib.mjs')).getMergedModelCatalogue;
      const merged = await loader({ tool: 'claude', ...catalogueOptions });
      liveModels = [...(merged?.bundledAndLive ?? []), ...(merged?.liveOnly ?? [])];
    } catch {
      liveModels = [];
    }
  }

  const latest = selectLatestClaudeFamilyModel(family, liveModels);
  return latest ? `${latest}${suffix}` : mapModelToId(model);
};

export const checkModelVisionCapability = async modelId => {
  try {
    const modelInfo = await fetchModelInfo(modelId);
    const inputModalities = modelInfo?.modalities?.input || [];
    return inputModalities.includes('image');
  } catch {
    return false;
  }
};
