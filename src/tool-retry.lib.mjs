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

  // Issue #1881: Transient socket / network disconnects from the SDK's underlying fetch.
  // When the HTTP(S)/streaming socket drops mid-request, the Claude/Codex CLI surfaces a
  // synthetic assistant message such as:
  //   "API Error: The socket connection was closed unexpectedly. For more information,
  //    pass `verbose: true` in the second argument to fetch()"
  // These are network-level failures (QUIC/TCP resets, idle-socket teardown, proxy/VPN
  // interruptions, undici socket hang-ups), not request-content errors, so they are safe
  // to retry with the session preserved (--resume). Without this branch the whole solve
  // session aborts on a single dropped socket.
  // Upstream: anthropics/claude-code#48837, #51107, #54287, #60133.
  if (lower.includes('socket connection was closed unexpectedly') || lower.includes('socket hang up') || lower.includes('econnreset') || lower.includes('connection reset') || lower.includes('network connection lost') || lower.includes('connection error') || lower.includes('fetch failed')) {
    return { message, isRetryable: true, isCapacity: false, label: 'Socket/connection closed unexpectedly' };
  }

  // Issue #1834: Corrupted extended-thinking blocks. When extended thinking is combined with tool
  // use, Claude Code can persist a thinking block to the session transcript with the `thinking`
  // text emptied to "" while retaining the original `signature`. On resume/continue the block is
  // replayed as `{ type: 'thinking', thinking: '', signature: <original> }`; the API validates the
  // signature against the (now empty) text and rejects every subsequent turn with:
  //   400 ... `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be
  //   modified. These blocks must remain as they were in the original response.
  // The session is therefore permanently un-resumable — retrying with --resume always fails. The
  // only recovery is to discard the session and start fresh (equivalent to `/clear`), so this is
  // flagged with `requiresFreshSession` rather than the plain `isRetryable` retry-with-resume path.
  // Upstream: https://github.com/anthropics/claude-code/issues/63147
  if ((lower.includes('thinking') || lower.includes('redacted_thinking')) && lower.includes('cannot be modified')) {
    return { message, isRetryable: false, isCapacity: false, requiresFreshSession: true, label: 'Corrupted thinking blocks (un-resumable session)' };
  }

  // Issue #1924: Server-side temporary rate limiting (HTTP 429), distinct from an
  // account usage/quota limit. The Claude CLI surfaces this as a synthetic
  // assistant/result message and an api_error_status of 429:
  //   "API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited"
  // The response carries `x-should-retry: true` and the stream emits a
  // `rate_limit_event` with `status: "rejected"`. Because the message explicitly
  // says "not your usage limit", it is NOT a usage-limit reset-time situation and
  // must NOT be routed through detectUsageLimit() (there is no reset time to wait
  // for). It is a transient throttle that clears on its own, so it is safe to
  // retry with the session preserved (--resume) after a backoff. Switching models
  // does not help (the throttle is request-rate, not model capacity), so
  // isCapacity is false.
  if (lower.includes('temporarily limiting requests') || (lower.includes('rate limited') && lower.includes('not your usage limit')) || (lower.includes('rate_limit') && lower.includes('429'))) {
    return { message, isRetryable: true, isCapacity: false, label: 'Server rate limited (429)' };
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
