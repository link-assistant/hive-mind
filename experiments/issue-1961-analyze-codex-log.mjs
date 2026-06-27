#!/usr/bin/env node

import fs from 'node:fs';
import readline from 'node:readline';

const logPath = process.argv[2];

if (!logPath) {
  console.error('Usage: node experiments/issue-1961-analyze-codex-log.mjs <log-file>');
  process.exit(1);
}

const counts = {
  jsonEvents: {},
  compactRequests: 0,
  conversationStarts: 0,
  responseCompletedDiagnostics: 0,
  tokenCountPayloads: 0,
};

const turnCompleted = [];
const compactRequests = [];
const conversationStarts = [];
const responseCompletedDiagnostics = [];
const tokenCountPayloads = [];

const getDiagnosticValue = (line, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`${escaped}=(?:"([^"]*)"|([^\\s")]+))`));
  return match?.[1] ?? match?.[2] ?? null;
};

const getDiagnosticInteger = (line, key) => {
  const value = getDiagnosticValue(line, key);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const getTimestamp = line => getDiagnosticValue(line, 'event.timestamp') ?? line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+Z)\]/u)?.[1] ?? null;

const summarizeResponseDiagnostics = responses =>
  responses.reduce(
    (summary, response) => {
      summary.count += 1;
      summary.inputTokens += response.inputTokens || 0;
      summary.cacheReadTokens += response.cacheReadTokens || 0;
      summary.nonCachedInputTokens += Math.max(0, (response.inputTokens || 0) - (response.cacheReadTokens || 0));
      summary.outputTokens += response.outputTokens || 0;
      summary.reasoningTokens += response.reasoningTokens || 0;
      if (!summary.firstTimestamp) summary.firstTimestamp = response.timestamp;
      summary.lastTimestamp = response.timestamp;
      return summary;
    },
    {
      count: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      nonCachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      firstTimestamp: null,
      lastTimestamp: null,
    }
  );

const parseJsonPayload = line => {
  const marker = '] [INFO] ';
  const markerIndex = line.indexOf(marker);
  const payload = markerIndex >= 0 ? line.slice(markerIndex + marker.length).trim() : line.trim();
  if (!payload.startsWith('{')) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const parseEmbeddedTokenCountPayloads = line => {
  if (!line.includes('\\"type\\":\\"token_count\\"')) return [];
  const payloads = [];

  const failedLineMatch = line.match(/failed to parse line as JSON: "((?:\\.|[^"])*)", error:/);
  if (!failedLineMatch) return payloads;

  let embedded;
  try {
    embedded = JSON.parse(`"${failedLineMatch[1]}"`);
  } catch {
    return payloads;
  }

  const payloadStart = embedded.indexOf('{"timestamp"');
  if (payloadStart < 0) return payloads;

  try {
    const parsed = JSON.parse(embedded.slice(payloadStart));
    if (parsed?.type === 'event_msg' && parsed.payload?.type === 'token_count') {
      payloads.push({
        timestamp: parsed.timestamp,
        info: parsed.payload.info,
      });
    }
  } catch {
    // Leave unparsable payloads out of the machine summary.
  }

  return payloads;
};

const rl = readline.createInterface({
  input: fs.createReadStream(logPath, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

let lineNumber = 0;
for await (const line of rl) {
  lineNumber++;

  if (line.includes('codex_otel.log_only:') && line.includes('event.name="codex.conversation_starts"')) {
    counts.conversationStarts++;
    conversationStarts.push({
      lineNumber,
      timestamp: getTimestamp(line),
      conversationId: getDiagnosticValue(line, 'conversation.id'),
      contextWindow: getDiagnosticInteger(line, 'context_window'),
      autoCompactTokenLimit: getDiagnosticInteger(line, 'auto_compact_token_limit'),
      model: getDiagnosticValue(line, 'model'),
      originator: getDiagnosticValue(line, 'originator'),
    });
  }

  if (line.includes('codex_otel.log_only:') && line.includes('event.name="codex.api_request"') && line.includes('endpoint="/responses/compact"')) {
    const statusCode = getDiagnosticInteger(line, 'http.response.status_code');
    if (statusCode === null || (statusCode >= 200 && statusCode < 300)) {
      counts.compactRequests++;
      compactRequests.push({
        lineNumber,
        timestamp: getTimestamp(line),
        conversationId: getDiagnosticValue(line, 'conversation.id'),
        statusCode,
        durationMs: getDiagnosticInteger(line, 'duration_ms'),
        model: getDiagnosticValue(line, 'model'),
      });
    }
  }

  if (line.includes('codex_otel.log_only:') && line.includes('event.name="codex.sse_event"') && line.includes('event.kind=response.completed')) {
    counts.responseCompletedDiagnostics++;
    responseCompletedDiagnostics.push({
      lineNumber,
      timestamp: getTimestamp(line),
      conversationId: getDiagnosticValue(line, 'conversation.id'),
      inputTokens: getDiagnosticInteger(line, 'input_token_count') || 0,
      cacheReadTokens: getDiagnosticInteger(line, 'cached_token_count') || 0,
      outputTokens: getDiagnosticInteger(line, 'output_token_count') || 0,
      reasoningTokens: getDiagnosticInteger(line, 'reasoning_token_count') || 0,
    });
  }

  for (const payload of parseEmbeddedTokenCountPayloads(line)) {
    counts.tokenCountPayloads++;
    tokenCountPayloads.push({ lineNumber, ...payload });
  }

  const data = parseJsonPayload(line);
  if (!data) continue;

  const type = typeof data.type === 'string' ? data.type : 'unknown';
  counts.jsonEvents[type] = (counts.jsonEvents[type] || 0) + 1;

  if (type === 'turn.completed') {
    turnCompleted.push({
      lineNumber,
      usage: data.usage ?? null,
    });
  }
}

console.log(
  JSON.stringify(
    {
      logPath,
      counts,
      conversationStarts,
      compactRequests,
      responseCompletedDiagnosticSummary: summarizeResponseDiagnostics(responseCompletedDiagnostics),
      responseCompletedDiagnosticIntervals: compactRequests.length
        ? [
            {
              label: 'before_first_compact',
              ...summarizeResponseDiagnostics(responseCompletedDiagnostics.filter(response => response.timestamp && response.timestamp < compactRequests[0].timestamp)),
            },
            {
              label: 'after_first_compact',
              ...summarizeResponseDiagnostics(responseCompletedDiagnostics.filter(response => response.timestamp && response.timestamp >= compactRequests[0].timestamp)),
            },
          ]
        : [],
      turnCompleted,
      tokenCountPayloads,
    },
    null,
    2
  )
);
