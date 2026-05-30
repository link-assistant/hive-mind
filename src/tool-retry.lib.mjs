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

  // Issue #1841: "Autocompact is thrashing" / rapid-refill breaker. A second context-exhaustion
  // failure mode in Claude Code: when a large file read or tool output keeps refilling the context to
  // the limit within a few turns of each auto-compaction, Claude Code trips its "rapid refill breaker"
  // and emits a synthetic assistant message ("Autocompact is thrashing: the context refilled to the
  // limit within 3 turns of the previous compact, 3 times in a row. … Try reading in smaller chunks,
  // or use /clear to start fresh.") with `error: "invalid_request"` and result `terminal_reason:
  // "rapid_refill_breaker"`. Verified against the installed Claude Code binary (v2.1.158): the breaker
  // fires after `t08 = 3` consecutive rapid refills, each detected within `nc6 = 3` turns of the prior
  // compact (the thresholds are hard-coded — there is no env var to tune them). Just like "Prompt is
  // too long", resuming the same headless transcript replays the same over-large context, so the only
  // recovery the message itself recommends is `/clear` (a fresh session). We route it through the same
  // context-limit recovery (`requiresFreshSession` + `isContextLimit`).
  if (lower.includes('autocompact is thrashing') || lower.includes('rapid_refill_breaker') || lower.includes('rapid refill breaker')) {
    return { message, isRetryable: false, isCapacity: false, requiresFreshSession: true, isContextLimit: true, label: 'Autocompact is thrashing (context refilled to limit repeatedly, rapid-refill breaker tripped)' };
  }

  // Issue #1841: "Prompt is too long" — the conversation plus attached files exceeds the model's
  // context window (Claude Code error reference: https://code.claude.com/docs/en/errors). Claude
  // Code's auto-compaction (on by default) normally prevents this, but when compaction itself fails
  // (observed: status `compact_result: failed` with `compact_error: too_few_groups`, and a result
  // with `terminal_reason: blocking_limit`) the prompt cannot be reduced and the run aborts. In
  // headless/`-p` mode the transcript only ever grows, so resuming the SAME session just replays the
  // oversized prompt and fails again — the only recovery is to discard the session and start fresh
  // (equivalent to `/clear`). This is an upstream Claude Code limitation, tracked at
  // anthropics/claude-code#46348 (and #23751, #26317, #25620, #24976). We flag it with
  // `requiresFreshSession` (NOT a transient retry) and `isContextLimit` so the caller routes it to
  // context-limit recovery instead of thinking-block recovery.
  if (lower.includes('prompt is too long') || lower.includes('prompt too long') || lower.includes('input is too long') || (lower.includes('context') && lower.includes('too long') && lower.includes('compact'))) {
    return { message, isRetryable: false, isCapacity: false, requiresFreshSession: true, isContextLimit: true, label: 'Prompt is too long (context window exhausted, compaction failed)' };
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
