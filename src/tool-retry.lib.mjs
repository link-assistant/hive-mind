#!/usr/bin/env node

import { retryLimits } from './config.lib.mjs';
import { resolveDefaultFallbackModel, resolveModelId } from './models/index.mjs';

const normalizeMessage = value => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value?.error?.message === 'string') return value.error.message;
  if (typeof value?.message === 'string') return value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeModelKey = value => {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/\[1m\]$/i, '')
    .trim();
};

export const classifyRetryableError = value => {
  const message = normalizeMessage(value);
  const lower = message.toLowerCase();

  if (lower.includes('selected model is at capacity') || (lower.includes('at capacity') && lower.includes('try a different model'))) {
    return { message, isRetryable: true, isCapacity: true, label: 'Model capacity error' };
  }

  if (lower.includes('overloaded') || lower.includes('overloaded_error')) {
    return { message, isRetryable: true, isCapacity: true, label: 'API overload' };
  }

  if (lower.includes('request timed out')) {
    return { message, isRetryable: true, isCapacity: false, label: 'Request timeout' };
  }

  if (lower.includes('stream disconnected before completion')) {
    return { message, isRetryable: true, isCapacity: false, label: 'Stream disconnected before completion' };
  }

  if (lower.includes('api error: 503') || (lower.includes('503') && (lower.includes('upstream connect error') || lower.includes('remote connection failure')))) {
    return { message, isRetryable: true, isCapacity: false, label: '503 network error' };
  }

  if (lower.includes('internal server error') || lower.includes('api error: 500')) {
    return { message, isRetryable: true, isCapacity: false, label: 'Internal server error (500)' };
  }

  return { message, isRetryable: false, isCapacity: false, label: null };
};

export const getRetryDelayMs = ({ retryCount, initialDelayMs = retryLimits.initialTransientErrorDelayMs, maxDelayMs = retryLimits.maxTransientErrorDelayMs } = {}) => {
  return Math.min(initialDelayMs * Math.pow(retryLimits.retryBackoffMultiplier, retryCount), maxDelayMs);
};

export const waitWithCountdown = async (delayMs, log) => {
  if (delayMs <= 60000) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return;
  }

  let remaining = delayMs;
  const timer = setInterval(async () => {
    remaining -= 60000;
    if (remaining > 0) await log(`⏳ ${Math.round(remaining / 60000)} min remaining...`);
  }, 60000);

  await new Promise(resolve => setTimeout(resolve, delayMs));
  clearInterval(timer);
};

export const resolveConfiguredFallbackModel = ({ tool, currentModel, configuredFallbackModel = undefined } = {}) => {
  if (configuredFallbackModel) return configuredFallbackModel;
  return resolveDefaultFallbackModel(tool, currentModel);
};

export const maybeSwitchToFallbackModel = async ({ tool, argv, log, errorMessage } = {}) => {
  const fallbackModel = resolveConfiguredFallbackModel({
    tool,
    currentModel: argv?.model,
    configuredFallbackModel: argv?.fallbackModel,
  });

  const classification = classifyRetryableError(errorMessage);
  if (!fallbackModel || !classification.isCapacity || !argv?.model) {
    return { switched: false, fallbackModel, reason: classification.label };
  }

  const currentResolvedModel = normalizeModelKey(resolveModelId(argv.model, tool));
  const fallbackResolvedModel = normalizeModelKey(resolveModelId(fallbackModel, tool));
  if (!fallbackResolvedModel || currentResolvedModel === fallbackResolvedModel) {
    return { switched: false, fallbackModel, reason: classification.label };
  }

  const previousModel = argv.model;
  argv.model = fallbackModel;
  if (!argv.fallbackModel) argv.fallbackModel = fallbackModel;

  if (typeof log === 'function') {
    await log(`🔀 Switching to fallback model: ${previousModel} -> ${fallbackModel}`, { level: 'warning' });
  }

  return {
    switched: true,
    fallbackModel,
    previousModel,
    reason: classification.label,
  };
};

export default {
  classifyRetryableError,
  getRetryDelayMs,
  waitWithCountdown,
  resolveConfiguredFallbackModel,
  maybeSwitchToFallbackModel,
};
