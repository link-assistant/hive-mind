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

export const mapModelToId = model => {
  if (!model || typeof model !== 'string') return model;
  const match = model.match(/^(.+?)\[1m\]$/i);
  if (match) {
    const baseModel = match[1];
    const mappedBase = availableModels[baseModel] || baseModel;
    return `${mappedBase}[1m]`;
  }
  return availableModels[model] || model;
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
