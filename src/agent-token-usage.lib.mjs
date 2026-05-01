#!/usr/bin/env node

import Decimal from 'decimal.js-light';
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';

export const createTokenFieldAvailability = () => ({
  inputTokens: false,
  outputTokens: false,
  reasoningTokens: false,
  cacheReadTokens: false,
  cacheWriteTokens: false,
});

export const createAgentTokenUsage = () => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  stepCount: 0,
  requestedModelId: null,
  respondedModelId: null,
  contextLimit: null,
  outputLimit: null,
  peakContextUsage: 0,
  tokenFieldAvailability: createTokenFieldAvailability(),
});

const addObservedTokenValue = (usage, source, sourceFieldName, targetFieldName) => {
  if (!source || !Object.hasOwn(source, sourceFieldName)) return;
  usage.tokenFieldAvailability ||= createTokenFieldAvailability();
  usage.tokenFieldAvailability[targetFieldName] = true;
  const value = source[sourceFieldName];
  if (Number.isFinite(value)) usage[targetFieldName] = (usage[targetFieldName] || 0) + value;
};

const getTokenCount = value => (Number.isFinite(value) ? value : 0);

export const accumulateAgentStepFinishUsage = (usage, data) => {
  if (!usage || data?.type !== 'step_finish' || !data.part?.tokens) return false;

  const tokens = data.part.tokens;
  usage.stepCount = (usage.stepCount || 0) + 1;
  usage.tokenFieldAvailability ||= createTokenFieldAvailability();

  addObservedTokenValue(usage, tokens, 'input', 'inputTokens');
  addObservedTokenValue(usage, tokens, 'output', 'outputTokens');
  addObservedTokenValue(usage, tokens, 'reasoning', 'reasoningTokens');
  if (tokens.cache) {
    addObservedTokenValue(usage, tokens.cache, 'read', 'cacheReadTokens');
    addObservedTokenValue(usage, tokens.cache, 'write', 'cacheWriteTokens');
  }

  if (Number.isFinite(data.part.cost)) {
    usage.totalCost = new Decimal(usage.totalCost || 0).plus(data.part.cost).toNumber();
  }

  if (data.part.model) {
    if (data.part.model.requestedModelID) usage.requestedModelId = data.part.model.requestedModelID;
    if (data.part.model.respondedModelID) usage.respondedModelId = data.part.model.respondedModelID;
  }

  if (data.part.context) {
    if (data.part.context.contextLimit) usage.contextLimit = data.part.context.contextLimit;
    if (data.part.context.outputLimit) usage.outputLimit = data.part.context.outputLimit;
    const stepContextUsage = getTokenCount(tokens.input) + getTokenCount(tokens.cache?.read);
    if (stepContextUsage > (usage.peakContextUsage || 0)) {
      usage.peakContextUsage = stepContextUsage;
    }
  }

  return true;
};

/**
 * Parse Agent/OpenCode NDJSON output to extract token usage from step_finish events.
 * @param {string} output - Raw JSONL output from the command
 * @returns {Object} Aggregated token usage and cost data
 */
export const parseAgentTokenUsage = output => {
  const usage = createAgentTokenUsage();

  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line || !line.startsWith('{')) continue;

    try {
      accumulateAgentStepFinishUsage(usage, sanitizeObjectStrings(JSON.parse(line)));
    } catch {
      continue;
    }
  }

  return usage;
};
