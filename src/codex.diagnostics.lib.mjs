// Codex debug-telemetry (codex_otel.log_only) parsing helpers.
//
// When Codex runs with RUST_LOG=debug it emits structured `codex_otel.log_only`
// lines describing each API request: conversation start, successful
// `/responses/compact` calls, and a `response.completed` SSE event per request
// carrying that request's token counts. These helpers turn those lines into the
// machine-readable telemetry the budget display relies on, including the precise
// sub-session reconstruction for Issue #1961.

const CODEX_COMPACT_API_ENDPOINT = '/responses/compact';
const CODEX_SSE_EVENT_NAME = 'codex.sse_event';
const CODEX_SSE_RESPONSE_COMPLETED_KIND = 'response.completed';

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

const isCodexResponseCompletedDiagnosticLine = line => {
  if (!line.includes('codex_otel.log_only:')) return false;
  if (!line.includes(`event.name="${CODEX_SSE_EVENT_NAME}"`)) return false;
  return line.includes(`event.kind=${CODEX_SSE_RESPONSE_COMPLETED_KIND}`) || line.includes(`event.kind="${CODEX_SSE_RESPONSE_COMPLETED_KIND}"`);
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

export const summarizeCodexDiagnosticResponses = diagnosticResponses => {
  const responses = Array.isArray(diagnosticResponses) ? diagnosticResponses : [];
  return responses.reduce(
    (summary, response) => {
      summary.count += 1;
      summary.inputTokens += response.inputTokens || 0;
      summary.cacheReadTokens += response.cacheReadTokens || 0;
      summary.nonCachedInputTokens += Math.max(0, (response.inputTokens || 0) - (response.cacheReadTokens || 0));
      summary.outputTokens += response.outputTokens || 0;
      summary.reasoningTokens += response.reasoningTokens || 0;
      return summary;
    },
    {
      count: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      nonCachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    }
  );
};

const recordCodexResponseCompletedDiagnostic = (line, tokenUsage) => {
  if (!isCodexResponseCompletedDiagnosticLine(line)) return;
  const timestamp = getCodexDiagnosticTimestamp(line);
  const conversationId = getCodexDiagnosticValue(line, 'conversation.id');
  const inputTokens = getCodexDiagnosticInteger(line, 'input_token_count') || 0;
  const cacheReadTokens = getCodexDiagnosticInteger(line, 'cached_token_count') || 0;
  const outputTokens = getCodexDiagnosticInteger(line, 'output_token_count') || 0;
  const reasoningTokens = getCodexDiagnosticInteger(line, 'reasoning_token_count') || 0;
  const existing = tokenUsage.diagnosticResponses.find(response => response.timestamp === timestamp && response.conversationId === conversationId && response.inputTokens === inputTokens && response.cacheReadTokens === cacheReadTokens && response.outputTokens === outputTokens && response.reasoningTokens === reasoningTokens);
  if (existing) return;

  tokenUsage.diagnosticResponses.push({
    timestamp,
    conversationId: conversationId || null,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    reasoningTokens,
    source: 'codex.sse_event.response.completed',
  });
  tokenUsage.diagnosticResponseTotals = summarizeCodexDiagnosticResponses(tokenUsage.diagnosticResponses);
};

/**
 * Issue #1961: Reconstruct real Codex sub-sessions from per-response telemetry.
 *
 * Codex `turn.completed` usage is cumulative for the whole run, so it cannot be
 * split into compact-bounded sub-sessions on its own. Earlier code faked the
 * split by dividing the cumulative total evenly (which produced the suspicious
 * "exactly 150K" first row reported in the issue).
 *
 * When Codex runs with debug telemetry it emits a
 * `codex.sse_event response.completed` line per API request whose
 * `input_token_count` is the full restored context for that single request. By
 * bucketing those per-request snapshots between successful `/responses/compact`
 * boundaries we recover the genuine context fullness reached inside each
 * sub-session (the peak `input_token_count` right before a compaction), plus the
 * output actually generated in that window. These are measured values, not
 * estimates, so `estimated` is false.
 *
 * If the run has no per-response telemetry (debug logging was off) there is
 * nothing precise to bucket, so we leave `subSessions` empty and let the caller
 * fall back to the "compaction observed, no split" notice.
 */
export const buildCodexSubSessionsFromDiagnostics = tokenUsage => {
  const responses = Array.isArray(tokenUsage.diagnosticResponses) ? tokenUsage.diagnosticResponses : [];
  const compactifications = Array.isArray(tokenUsage.compactifications) ? tokenUsage.compactifications : [];
  const existingSubSessions = Array.isArray(tokenUsage.subSessions) ? tokenUsage.subSessions : [];

  // Only the JSON path that observes compaction reconstructs sub-sessions.
  // Without compact boundaries or per-response telemetry there is no precise
  // split to render, so preserve whatever was already there (usually empty).
  if (responses.length === 0 || compactifications.length === 0) {
    tokenUsage.subSessions = existingSubSessions;
    return;
  }

  const boundaries = compactifications
    .map(compact => compact.timestamp)
    .filter(Boolean)
    .slice()
    .sort();
  if (boundaries.length === 0) {
    tokenUsage.subSessions = existingSubSessions;
    return;
  }

  // Bucket each per-request snapshot into the window between compactions.
  // A snapshot whose timestamp is at/after boundary N belongs to window N+1,
  // matching how a compaction resets the live context before the next request.
  const buckets = Array.from({ length: boundaries.length + 1 }, () => []);
  for (const response of responses) {
    if (!response.timestamp) continue;
    let index = 0;
    while (index < boundaries.length && response.timestamp >= boundaries[index]) index++;
    buckets[index].push(response);
  }

  const subSessions = [];
  for (let index = 0; index < buckets.length; index++) {
    const bucket = buckets[index];
    if (bucket.length === 0) continue;

    let peakContextUsage = 0;
    let peakCacheReadTokens = 0;
    let peakOutputUsage = 0;
    let outputTokens = 0;
    let reasoningTokens = 0;
    for (const response of bucket) {
      const contextInput = response.inputTokens || 0;
      if (contextInput > peakContextUsage) {
        peakContextUsage = contextInput;
        peakCacheReadTokens = response.cacheReadTokens || 0;
      }
      const responseOutput = response.outputTokens || 0;
      if (responseOutput > peakOutputUsage) peakOutputUsage = responseOutput;
      outputTokens += responseOutput;
      reasoningTokens += response.reasoningTokens || 0;
    }

    subSessions.push({
      inputTokens: peakContextUsage,
      cacheCreationTokens: 0,
      cacheReadTokens: peakCacheReadTokens,
      outputTokens,
      reasoningTokens,
      messageCount: bucket.length,
      peakContextUsage,
      peakOutputUsage,
      estimated: false,
      source: 'codex.response-completed-diagnostics',
      compactBoundaryBefore: index === 0 ? null : boundaries[index - 1] || null,
    });
  }

  tokenUsage.subSessions = subSessions;
};

export const parseCodexDiagnosticLine = (line, tokenUsage) => {
  const contextLimit = getCodexDiagnosticInteger(line, 'context_window') ?? getCodexDiagnosticInteger(line, 'model_context_window');
  if (contextLimit !== null) tokenUsage.contextLimit = contextLimit;

  const autoCompactTokenLimit = getCodexDiagnosticInteger(line, 'auto_compact_token_limit') ?? getCodexDiagnosticInteger(line, 'model_auto_compact_token_limit');
  if (autoCompactTokenLimit !== null) tokenUsage.autoCompactTokenLimit = autoCompactTokenLimit;

  recordCodexCompactification(line, tokenUsage);
  recordCodexResponseCompletedDiagnostic(line, tokenUsage);
};
