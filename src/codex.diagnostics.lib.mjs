/**
 * Codex diagnostic-line parsing and sub-session reconstruction.
 *
 * Extracted from src/codex.lib.mjs (issue #2175) so that file stays under the
 * 1350-line early-warning threshold that protects concurrent merges (#1593).
 * Behaviour is unchanged.
 *
 * Codex emits its context window, auto-compact limit and successful
 * `/responses/compact` calls only as `codex_otel.log_only:` diagnostic lines on
 * stderr (with RUST_LOG=debug). Those lines are the only evidence that a
 * compactification happened, which is what lets the token usage of a single
 * Codex run be split back into the sub-sessions the user actually experienced.
 */

import { getCumulativeContextInputTokens } from './context-fill.lib.mjs';

const CODEX_COMPACT_API_ENDPOINT = '/responses/compact';
const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getCodexDiagnosticValue = (line, key) => {
  const match = line.match(new RegExp(`${escapeRegExp(key)}=(?:"([^"]*)"|([^\\s")]+))`));
  return match?.[1] ?? match?.[2] ?? null;
};
const getCodexDiagnosticInteger = (line, key) => {
  const value = getCodexDiagnosticValue(line, key);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};
const getCodexDiagnosticTimestamp = line => {
  const eventTimestamp = getCodexDiagnosticValue(line, 'event.timestamp');
  if (eventTimestamp) return eventTimestamp;
  const logPrefixMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+Z)\]/u);
  return logPrefixMatch?.[1] ?? null;
};
const isSuccessfulCodexCompactRequestLine = line => {
  if (!line.includes('codex_otel.log_only:')) return false;
  if (!line.includes('event.name="codex.api_request"')) return false;
  if (!line.includes(`endpoint="${CODEX_COMPACT_API_ENDPOINT}"`)) return false;
  const statusCode = getCodexDiagnosticInteger(line, 'http.response.status_code');
  return statusCode === null || (statusCode >= 200 && statusCode < 300);
};

const splitTokenCountEvenly = (total, partCount) => {
  const safeTotal = Math.max(0, Math.round(total || 0));
  const safePartCount = Math.max(1, Math.round(partCount || 1));
  const base = Math.floor(safeTotal / safePartCount);
  let remainder = safeTotal % safePartCount;
  return Array.from({ length: safePartCount }, () => {
    const value = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;
    return value;
  });
};
const splitCodexSubSessionInputTokens = (total, partCount, autoCompactTokenLimit = null) => {
  const safeTotal = Math.max(0, Math.round(total || 0));
  const safePartCount = Math.max(1, Math.round(partCount || 1));
  const safeLimit = Number.isFinite(autoCompactTokenLimit) && autoCompactTokenLimit > 0 ? Math.round(autoCompactTokenLimit) : null;
  if (safePartCount <= 1) return [safeTotal];
  if (safeLimit && safeTotal > safeLimit * (safePartCount - 1)) {
    const chunks = [];
    let remaining = safeTotal;
    for (let i = 0; i < safePartCount - 1; i++) {
      const chunk = Math.min(safeLimit, remaining);
      chunks.push(chunk);
      remaining -= chunk;
    }
    chunks.push(Math.max(0, remaining));
    return chunks;
  }
  return splitTokenCountEvenly(safeTotal, safePartCount);
};
const splitTokenCountByWeights = (total, weights) => {
  const safeTotal = Math.max(0, Math.round(total || 0));
  const safeWeights = Array.isArray(weights) && weights.length > 0 ? weights.map(weight => Math.max(0, weight || 0)) : [1];
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) return splitTokenCountEvenly(safeTotal, safeWeights.length);
  let allocated = 0;
  return safeWeights.map((weight, index) => {
    if (index === safeWeights.length - 1) return Math.max(0, safeTotal - allocated);
    const value = Math.floor((safeTotal * weight) / weightTotal);
    allocated += value;
    return value;
  });
};
export const rebuildCodexSubSessionsFromCompactifications = tokenUsage => {
  const compactifications = Array.isArray(tokenUsage.compactifications) ? tokenUsage.compactifications : [];
  if (compactifications.length === 0 || (tokenUsage.stepCount || 0) === 0) {
    tokenUsage.subSessions = Array.isArray(tokenUsage.subSessions) ? tokenUsage.subSessions : [];
    return;
  }

  const subSessionCount = compactifications.length + 1;
  const inputChunks = splitCodexSubSessionInputTokens(tokenUsage.inputTokens || 0, subSessionCount, tokenUsage.autoCompactTokenLimit);
  const cacheWriteChunks = splitTokenCountByWeights(tokenUsage.cacheWriteTokens || 0, inputChunks);
  const cacheReadChunks = splitTokenCountByWeights(tokenUsage.cacheReadTokens || 0, inputChunks);
  const outputChunks = splitTokenCountByWeights(tokenUsage.outputTokens || 0, inputChunks);
  tokenUsage.subSessions = inputChunks.map((inputTokens, index) => {
    const cacheCreationTokens = cacheWriteChunks[index] || 0;
    const outputTokens = outputChunks[index] || 0;
    return {
      inputTokens,
      cacheCreationTokens,
      cacheReadTokens: cacheReadChunks[index] || 0,
      outputTokens,
      messageCount: null,
      peakContextUsage: getCumulativeContextInputTokens({ inputTokens, cacheCreationTokens }),
      peakOutputUsage: outputTokens,
      estimated: true,
      source: 'codex.compact-diagnostics',
      compactBoundaryBefore: index === 0 ? null : compactifications[index - 1] || null,
    };
  });
};
const recordCodexCompactification = (line, tokenUsage) => {
  if (!isSuccessfulCodexCompactRequestLine(line)) return;
  const timestamp = getCodexDiagnosticTimestamp(line);
  const conversationId = getCodexDiagnosticValue(line, 'conversation.id');
  const existing = tokenUsage.compactifications.find(compact => compact.timestamp === timestamp && compact.conversationId === conversationId);
  if (existing) return;
  tokenUsage.compactifications.push({
    timestamp,
    preTokens: null,
    trigger: 'auto',
    source: 'codex.responses.compact',
    conversationId: conversationId || null,
  });
};
// Issue #2842: `codex exec` runs one turn that contains many model requests, so
// `turn.completed.usage.input_tokens` is the *sum* of every request's prompt.
// OpenAI's long-context surcharge is decided per request, so the peak prompt
// must come from the per-request `response.completed` SSE diagnostics:
//   codex_otel.log_only: event.name="codex.sse_event" event.kind=response.completed input_token_count=149702 ...
// `input_token_count` already includes cached tokens (it is the full prompt).
const recordCodexRequestInputTokens = (line, tokenUsage) => {
  if (!line.includes('codex_otel.') || !line.includes('event.name="codex.sse_event"')) return;
  if (getCodexDiagnosticValue(line, 'event.kind') !== 'response.completed') return;
  const inputTokenCount = getCodexDiagnosticInteger(line, 'input_token_count');
  if (inputTokenCount === null || inputTokenCount < 0) return;
  if (inputTokenCount > (tokenUsage.peakRequestInputTokens || 0)) tokenUsage.peakRequestInputTokens = inputTokenCount;
};
const toPositiveTokenCount = value => (Number.isFinite(value) && value > 0 ? value : null);
/**
 * Issue #2842: the largest single-request prompt of a Codex run.
 *
 * Prefers the per-request peak from the SSE diagnostics. Without it, the
 * whole-turn total is only an upper bound, so it is capped at the context
 * window (no single request can be larger than the window it was sent with).
 *
 * @param {Object} tokenUsage - Codex token usage (see createCodexTokenUsage).
 * @param {Object} [options]
 * @param {number|null} [options.contextWindow] - Fallback window when tokenUsage.contextLimit is unknown.
 * @returns {number} Peak prompt tokens for a single request.
 */
export const resolveCodexPeakContextUsage = (tokenUsage, { contextWindow = null } = {}) => {
  if (!tokenUsage) return 0;
  const requestPeak = toPositiveTokenCount(tokenUsage.peakRequestInputTokens);
  if (requestPeak) return requestPeak;
  const turnPeak = toPositiveTokenCount(tokenUsage.turnPeakContextUsage ?? tokenUsage.peakContextUsage) || 0;
  const window = toPositiveTokenCount(tokenUsage.contextLimit) ?? toPositiveTokenCount(contextWindow);
  return window ? Math.min(turnPeak, window) : turnPeak;
};
export const parseCodexDiagnosticLine = (line, tokenUsage) => {
  const contextLimit = getCodexDiagnosticInteger(line, 'context_window') ?? getCodexDiagnosticInteger(line, 'model_context_window');
  if (contextLimit !== null) tokenUsage.contextLimit = contextLimit;

  const autoCompactTokenLimit = getCodexDiagnosticInteger(line, 'auto_compact_token_limit') ?? getCodexDiagnosticInteger(line, 'model_auto_compact_token_limit');
  if (autoCompactTokenLimit !== null) tokenUsage.autoCompactTokenLimit = autoCompactTokenLimit;
  recordCodexCompactification(line, tokenUsage);
  recordCodexRequestInputTokens(line, tokenUsage);
};
