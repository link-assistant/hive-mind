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

  // Genuine model-specific capacity: the API explicitly tells us this *particular*
  // model is full and recommends trying a *different* model (e.g. Codex's
  // "Selected model is at capacity. Please try a different model."). Here a model
  // switch is the correct, API-recommended recovery, so isCapacity stays true.
  if (lower.includes('selected model is at capacity') || (lower.includes('at capacity') && lower.includes('try a different model'))) {
    return { message, isRetryable: true, isCapacity: true, label: 'Model capacity error' };
  }

  // Issue #1949: Transient server-wide overload (HTTP 529 / "overloaded_error"). The
  // Claude API surfaces this as a synthetic result message:
  //   "API Error: 529 Overloaded. This is a server-side issue, usually temporary —
  //    try again in a moment. If it persists, check https://status.claude.com."
  // This is NOT a model-specific capacity problem — Anthropic's own guidance is to
  // retry the *same* request after a short backoff (the message literally says "try
  // again in a moment"). Switching the requested `--model` to a fallback (e.g.
  // opus -> opus-4-7) is wrong here: it silently downgrades the user's chosen model
  // for a purely transient blip, and the fallback model lives behind the same
  // overloaded API anyway. Claude Code already exposes its own per-request fallback
  // via `--fallback-model` (wired in claude.lib.mjs), so we keep `--model` stable and
  // simply retry. Therefore isCapacity is false → retry with the same model.
  if (lower.includes('overloaded') || lower.includes('overloaded_error')) {
    return { message, isRetryable: true, isCapacity: false, label: 'API overload' };
  }

  if (lower.includes('request timed out')) {
    return { message, isRetryable: true, isCapacity: false, label: 'Request timeout' };
  }

  if (lower.includes('stream disconnected before completion')) {
    return { message, isRetryable: true, isCapacity: false, label: 'Stream disconnected before completion' };
  }

  // Issue #1937: Stream idle timeout. When the Anthropic streaming response stalls
  // (no bytes for the SDK's idle window) after the model has already emitted part of
  // its answer, the Claude CLI aborts the turn and surfaces a synthetic assistant /
  // result message:
  //   "API Error: Stream idle timeout - partial response received"
  // This is a transient network/streaming stall (a slow or stuck server-sent-events
  // socket), not a request-content error, so the session is still valid and safe to
  // resume. Before this branch classifyRetryableError() did not recognise it, so
  // isRetryable was false and the whole solve session aborted with exit code 1 even
  // though `--resume <sessionId>` could continue with the same context. Switching
  // models does not help (the stall is in the response stream, not model capacity),
  // so isCapacity is false → retry with the session preserved after a backoff.
  if (lower.includes('stream idle timeout') || (lower.includes('idle timeout') && lower.includes('partial response'))) {
    return { message, isRetryable: true, isCapacity: false, label: 'Stream idle timeout (partial response)' };
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

  // Issue #1955: Transient DNS resolution failures. When the local resolver, the
  // upstream DNS, or the network briefly drops, Node's undici/fetch (and the Codex
  // CLI's reqwest stack) surface the failure with one of these signatures:
  //   getaddrinfo ENOTFOUND api.openai.com / getaddrinfo EAI_AGAIN api.github.com /
  //   "Temporary failure in name resolution" / "dns error" / "failed to lookup
  //   address information". These are 100% temporary — the host is not gone, name
  //   resolution simply failed for a moment — so the same request is safe to retry
  //   after a backoff. Switching models does not help (it is a network-layer fault),
  //   so isCapacity is false.
  // NOTE: deliberately scoped to real resolver error tokens so it never matches
  // unrelated text that merely contains the word "lookup" (e.g. the echoed fixture
  // line "Network lookup skipped in fixture" from issue #1955, which is not an error
  // at all).
  if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('temporary failure in name resolution') || lower.includes('getaddrinfo') || lower.includes('dns error') || lower.includes('failed to lookup address information') || lower.includes('name or service not known')) {
    return { message, isRetryable: true, isCapacity: false, label: 'DNS resolution failure' };
  }

  // Issue #1955: Transient connection-level network failures from the OS/socket
  // layer — the peer is unreachable or refused the connection for a moment, or a
  // connect/read timed out. These are temporary (load balancer rotating, a node
  // briefly down, a VPN/proxy hiccup, a flaky link) and the identical request
  // typically succeeds on retry. Covers Node libuv error codes and their textual
  // equivalents. ETIMEDOUT/"timed out" here is the connection/socket timeout
  // (distinct from the API-level "request timed out" handled above).
  if (lower.includes('etimedout') || lower.includes('connection timed out') || lower.includes('econnrefused') || lower.includes('connection refused') || lower.includes('ehostunreach') || lower.includes('no route to host') || lower.includes('enetunreach') || lower.includes('network is unreachable') || lower.includes('epipe') || lower.includes('eai_fail')) {
    return { message, isRetryable: true, isCapacity: false, label: 'Transient network connection failure' };
  }

  // Issue #1955: Transient HTTP gateway / proxy errors (502 Bad Gateway, 504 Gateway
  // Timeout) and Cloudflare's edge family (520 Unknown Error, 521 Web Server Is Down,
  // 522 Connection Timed Out, 523 Origin Is Unreachable, 524 A Timeout Occurred).
  // These come from an intermediary (CDN/proxy/load balancer), not from a request the
  // client got wrong, and clear on their own — OpenAI/Anthropic/GitHub all front their
  // APIs with such proxies. Safe to retry the same request after a backoff.
  if (lower.includes('502 bad gateway') || lower.includes('bad gateway') || lower.includes('504 gateway timeout') || lower.includes('gateway time-out') || lower.includes('gateway timeout') || lower.includes('api error: 502') || lower.includes('api error: 504') || /\b52[0-4]\b/.test(lower)) {
    return { message, isRetryable: true, isCapacity: false, label: 'Gateway error (502/504/52x)' };
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

  // Issue #1955: broadened to also catch the bare "503 Service Unavailable" that
  // GitHub/OpenAI/Anthropic return when a backend is briefly saturated — a
  // transient, self-clearing condition, safe to retry with the same request.
  if (lower.includes('api error: 503') || lower.includes('503 service unavailable') || lower.includes('service unavailable') || (lower.includes('503') && (lower.includes('upstream connect error') || lower.includes('remote connection failure')))) {
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

// Issue #1949: Render a model alias together with the full ID it resolves to, e.g.
// "opus (claude-opus-4-8)". Earlier the warning printed only the bare alias, so a
// message like "Switching to fallback model: opus -> opus-4-7" was ambiguous (what
// does "opus" actually map to?). Showing both removes that ambiguity. When the alias
// already equals its resolved ID (or cannot be resolved) we just print the alias.
export const formatModelWithResolvedId = (model, tool) => {
  if (!model) return String(model);
  const resolved = resolveModelId(model, tool);
  if (!resolved || normalizeModelKey(resolved) === normalizeModelKey(model)) return String(model);
  return `${model} (${resolved})`;
};

// Issue #1949: Shared verbose "execution context" logger. Extracted from
// claude.lib.mjs so the per-tool retry loops can emit a consistent pre-run summary
// (resolved model, working dir, branch, prompt sizes, feedback) without each file
// duplicating the block. The model line uses formatModelWithResolvedId so the alias
// and its full ID are always shown together (e.g. "opus (claude-opus-4-8)").
export const logExecutionContext = async ({ log, model, tool, tempDir, branchName, promptLength, systemPromptLength, feedbackLines } = {}) => {
  if (typeof log !== 'function') return;
  await log(`   Model: ${formatModelWithResolvedId(model, tool)}`, { verbose: true });
  await log(`   Working directory: ${tempDir}`, { verbose: true });
  await log(`   Branch: ${branchName}`, { verbose: true });
  await log(`   Prompt length: ${promptLength} chars`, { verbose: true });
  await log(`   System prompt length: ${systemPromptLength} chars`, { verbose: true });
  const feedbackCount = feedbackLines && feedbackLines.length > 0 ? feedbackLines.length : 0;
  await log(feedbackCount > 0 ? `   Feedback info included: Yes (${feedbackCount} lines)` : '   Feedback info included: No', { verbose: true });
};

export const maybeSwitchToFallbackModel = async ({ tool, argv, log, errorMessage } = {}) => {
  const fallbackModel = resolveConfiguredFallbackModel({
    tool,
    currentModel: argv?.model,
    configuredFallbackModel: argv?.fallbackModel,
  });

  const classification = classifyRetryableError(errorMessage);

  // Issue #1949: Only switch the requested `--model` for genuine model-specific
  // capacity errors where the API itself recommends a different model. Transient,
  // retryable conditions (overload/529, timeouts, rate limits, socket drops, …) are
  // classified with isCapacity=false and must retry the *same* model — Claude Code's
  // own `--fallback-model` handles per-request fallback for those without us mutating
  // the user's chosen model.
  if (!fallbackModel || !classification.isCapacity || !argv?.model) {
    if (typeof log === 'function' && classification.isRetryable && !classification.isCapacity) {
      await log(`   Keeping requested model ${formatModelWithResolvedId(argv?.model, tool)} (transient ${classification.label || 'error'} — no fallback switch, Issue #1949)`, { verbose: true });
    }
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
    // Issue #1949: show the resolved full model IDs so the switch is unambiguous,
    // e.g. "opus (claude-opus-4-8) -> opus-4-7 (claude-opus-4-7)".
    await log(`🔀 Switching to fallback model: ${formatModelWithResolvedId(previousModel, tool)} -> ${formatModelWithResolvedId(fallbackModel, tool)}`, { level: 'warning' });
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
  formatModelWithResolvedId,
  logExecutionContext,
};
