/**
 * Issue #3570: cross-check every source Claude Code leaves behind before a
 * failed run is reported as a bare "Claude command failed with exit code 1".
 *
 * In the reported run the weekly usage limit ("You've hit your weekly limit ·
 * resets 11am (UTC)") reached only the session transcript JSONL
 * (`isApiErrorMessage: true`). stdout had no `result` event and no synthetic
 * assistant error message, so `lastMessage` was a base64 debug line and the run
 * got neither a reset time nor auto-resume. Five independent sources carry the
 * same fact; each one is checked on failure:
 *
 *   1. `lastMessage` / the `result` event (the only source used before);
 *   2. the synthetic assistant message in stream-json (`is_api_error_message`);
 *   3. the session transcript `~/.claude/projects/<cwd slug>/<sessionId>.jsonl`;
 *   4. the last `rate_limit_event` (`status: "rejected"` + `resetsAt`);
 *   5. the `ANTHROPIC_LOG=debug` 429 block (`anthropic-ratelimit-unified-*`
 *      headers), printed on stdout when `--verbose` is on.
 *
 * A bare `{status: "rejected"}` without `resetsAt` is NOT a usage limit: that
 * is the server-side throttle of issue #1924 and must stay a retryable error.
 */

import os from 'os';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { detectUsageLimit } from './usage-limit.lib.mjs';
import { resolveSessionTranscriptPath } from './claude.session-transcript-repair.lib.mjs';
import { readLogTailText } from './log-bounded-read.lib.mjs';
import { isOpaqueErrorText } from './error-text.lib.mjs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
const RATE_LIMIT_WINDOW_LABELS = { five_hour: 'session (5-hour)', seven_day: 'weekly', seven_day_opus: 'weekly Opus', seven_day_sonnet: 'weekly Sonnet' };
// `[log_be123b] response error (error; no more retries left) {` — the SDK debug logger.
const DEBUG_BLOCK_START = /^\[log_[0-9a-f]+\]\s/i;
const DEBUG_RESPONSE_ERROR = /^\[log_[0-9a-f]+\]\s+response error\b/i;
// Long runs of base64 alphabet only: the debug logger's compressed body dumps.
const BASE64_DUMP_LINE = /^[A-Za-z0-9+/=]{120,}$/;
const HEADER_LINE = /^\s*"?([a-z0-9-]+)"?\s*:\s*"?([^",]*)"?,?\s*$/i;

/**
 * Format an epoch (seconds) as `MMM D, YYYY, h:mm A` in UTC, the most precise
 * shape `parseResetTime` understands. A weekly reset days away keeps its date.
 */
export const formatEpochResetTimeUtc = epochSeconds => {
  const seconds = Number(epochSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  const hours = date.getUTCHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hour12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
};

const describeWindow = type => RATE_LIMIT_WINDOW_LABELS[type] || type || 'usage';

/**
 * Classify a stream-json `rate_limit_event.rate_limit_info`.
 *
 * Usage limit: `status: "rejected"` with `resetsAt`, or utilization of the
 * reported window at 100% with overage not in use. Throttle (issue #1924):
 * `status: "rejected"` without `resetsAt` — not a usage limit.
 */
export const classifyClaudeRateLimitEvent = info => {
  if (!info || typeof info !== 'object') return { isUsageLimit: false, reason: 'no rate_limit_event' };
  const resetsAt = Number(info.resetsAt);
  const hasReset = Number.isFinite(resetsAt) && resetsAt > 0;
  const utilization = Number(info.utilization);
  const overageUnavailable = info.isUsingOverage !== true && (info.overageStatus === undefined || info.overageStatus === 'rejected' || info.overageEnabled === false);
  const exhausted = Number.isFinite(utilization) && utilization >= 1 && overageUnavailable;
  const base = { status: info.status ?? null, rateLimitType: info.rateLimitType ?? null, utilization: Number.isFinite(utilization) ? utilization : null, resetsAt: hasReset ? resetsAt : null };
  if (!hasReset) return { ...base, isUsageLimit: false, reason: info.status === 'rejected' ? 'rejected without resetsAt (server throttle, issue #1924)' : `status ${info.status ?? 'unknown'}` };
  if (info.status === 'rejected' || exhausted) {
    return { ...base, isUsageLimit: true, reason: info.status === 'rejected' ? 'status rejected with resetsAt' : 'window utilization at 100% without overage', resetTime: formatEpochResetTimeUtc(resetsAt), timezone: 'UTC', windowLabel: describeWindow(info.rateLimitType) };
  }
  return { ...base, isUsageLimit: false, reason: `status ${info.status ?? 'unknown'}${base.utilization !== null ? ` at ${Math.round(base.utilization * 100)}%` : ''}` };
};

/** Classify the headers of an `ANTHROPIC_LOG=debug` 429 response block. */
export const classifyAnthropicDebugRateLimit = block => {
  if (!block || typeof block !== 'object') return { isUsageLimit: false, reason: 'no debug 429 block' };
  const headers = block.headers || {};
  const status = headers['anthropic-ratelimit-unified-status'] || null;
  const claim = headers['anthropic-ratelimit-unified-representative-claim'] || null;
  const resetsAt = Number(headers['anthropic-ratelimit-unified-reset']);
  const hasReset = Number.isFinite(resetsAt) && resetsAt > 0;
  const base = { httpStatus: block.status ?? null, status, rateLimitType: claim, resetsAt: hasReset ? resetsAt : null, retryAfterSeconds: Number(headers['retry-after']) || null };
  if (block.status === 429 && status === 'rejected' && hasReset) {
    return { ...base, isUsageLimit: true, reason: '429 with anthropic-ratelimit-unified-status rejected', resetTime: formatEpochResetTimeUtc(resetsAt), timezone: 'UTC', windowLabel: describeWindow(claim) };
  }
  return { ...base, isUsageLimit: false, reason: `HTTP ${block.status ?? '?'} unified-status ${status ?? 'absent'}` };
};

/**
 * Per-attempt collector fed from the stream loop. It never changes control
 * flow by itself; the failure branch asks it for a verdict.
 */
export const createClaudeUsageLimitEvidence = () => {
  const state = { apiErrorText: null, apiErrorCode: null, rateLimitInfo: null, rateLimitEventCount: 0, debugBlocks: 0, debugRateLimit: null, debugApiError: null };
  const openBlocks = new Map(); // stream -> the response error being parsed, or { skip: true } for other blocks

  const observeEvent = data => {
    if (!data || typeof data !== 'object') return;
    // A later assistant turn supersedes an earlier refusal that the CLI recovered.
    if ((data.type === 'assistant' && !data.is_api_error_message) || (data.type === 'result' && data.subtype === 'success' && !data.is_error)) state.debugApiError = null;
    if (data.type === 'rate_limit_event' && data.rate_limit_info) {
      state.rateLimitInfo = data.rate_limit_info;
      state.rateLimitEventCount++;
      return;
    }
    if (data.type === 'assistant' && data.is_api_error_message === true) {
      const content = Array.isArray(data.message?.content) ? data.message.content : [];
      const text = content
        .filter(item => item?.type === 'text' && item.text)
        .map(item => item.text)
        .join('\n');
      if (text) state.apiErrorText = text;
      if (typeof data.error === 'string') state.apiErrorCode = data.error;
    }
  };

  /**
   * Feed one non-JSON output line. Returns `{ isDebugOutput }` so the caller
   * can keep debug dumps out of `lastMessage` (issue #3570: a base64 body dump
   * became the reported failure reason).
   */
  const observeRawLine = (rawLine, stream = 'stdout') => {
    let line = String(rawLine ?? '').replace(/\r$/, '');
    // SDK logging does not always put a newline between a dump and its summary.
    if (isOpaqueErrorText(line)) {
      const markerAt = line.indexOf('[log_');
      if (markerAt < 0) return { isDebugOutput: true };
      line = line.slice(markerAt);
    }
    const summary = line.match(/^\[log_[0-9a-f]+(?:,[^\]]*)?\]\s+\w+\s+https:\/\/api\.anthropic\.com\/v1\/messages(?:\?[^\s]*)?\s+failed with status (\d{3})\b/i);
    if (summary) {
      state.debugApiError = { status: Number(summary[1]), requestId: line.match(/request-id:\s*"?(req_[A-Za-z0-9_-]+)/)?.[1] || null };
      return { isDebugOutput: true };
    }
    const debugBlock = openBlocks.get(stream);
    if (debugBlock) {
      if (/^}\s*$/.test(line)) {
        if (!debugBlock.skip && debugBlock.status === 429) state.debugRateLimit = { status: debugBlock.status, headers: debugBlock.headers, retriesExhausted: debugBlock.retriesExhausted };
        if (!debugBlock.skip && debugBlock.status >= 400 && debugBlock.isMessagesApi) state.debugApiError = { status: debugBlock.status, requestId: debugBlock.requestId || null };
        openBlocks.delete(stream);
        return { isDebugOutput: true };
      }
      if (!debugBlock.skip) {
        const statusMatch = line.match(/^\s*status:\s*(\d{3}),?\s*$/);
        if (statusMatch) debugBlock.status = Number(statusMatch[1]);
        if (/^\s*url:\s*"https:\/\/api\.anthropic\.com\/v1\/messages(?:\?[^"\s]*)?",?\s*$/.test(line)) debugBlock.isMessagesApi = true;
        const requestId = line.match(/^\s*"request-id":\s*"(req_[A-Za-z0-9_-]+)",?\s*$/);
        if (requestId) debugBlock.requestId = requestId[1];
        const header = line.match(HEADER_LINE);
        if (header && /^(anthropic-ratelimit-|retry-after$)/i.test(header[1])) debugBlock.headers[header[1].toLowerCase()] = header[2].trim();
      }
      return { isDebugOutput: true };
    }
    if (DEBUG_BLOCK_START.test(line)) {
      state.debugBlocks++;
      if (/\{\s*$/.test(line)) openBlocks.set(stream, DEBUG_RESPONSE_ERROR.test(line) ? { status: null, headers: {}, retriesExhausted: /no more retries left/i.test(line) } : { skip: true });
      return { isDebugOutput: true };
    }
    return { isDebugOutput: BASE64_DUMP_LINE.test(line.trim()) };
  };

  return { observeEvent, observeRawLine, snapshot: () => ({ ...state }) };
};

const transcriptCandidates = ({ tempDir, sessionId, homeDir, env }) => {
  const roots = [];
  if (env?.CLAUDE_CONFIG_DIR) roots.push(path.join(env.CLAUDE_CONFIG_DIR, 'projects'));
  roots.push(path.join(homeDir, '.claude', 'projects'));
  const slugs = [String(tempDir).replace(/\//g, '-'), String(tempDir).replace(/[^a-zA-Z0-9]/g, '-')];
  const files = [resolveSessionTranscriptPath(tempDir, sessionId, homeDir)];
  for (const root of roots) for (const slug of slugs) files.push(path.join(root, slug, `${sessionId}.jsonl`));
  return [...new Set(files)];
};

/**
 * Read the tail of a Claude session transcript and return the last
 * conversation entry when it is a synthetic API error message.
 */
export const readClaudeTranscriptApiError = async ({ tempDir, sessionId, homeDir = os.homedir(), env = process.env, fsImpl = fsPromises, maxBytes = TRANSCRIPT_TAIL_BYTES } = {}) => {
  if (!tempDir || !sessionId) return { found: false, reason: 'no session id' };
  for (const transcriptPath of transcriptCandidates({ tempDir, sessionId, homeDir, env })) {
    const exists = await fsImpl.stat(transcriptPath).then(
      () => true,
      () => false
    );
    if (!exists) continue;
    const lines = (await readLogTailText(transcriptPath, { fsImpl, maxBytes })).split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].trim()) continue;
      let entry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (entry?.type !== 'assistant' && entry?.type !== 'user') continue; // summaries, queue ops, system notes
      if (entry.type !== 'assistant' || entry.isApiErrorMessage !== true) return { found: false, transcriptPath, reason: `last entry is a ${entry.type} message, not an API error` };
      const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
      const text = content
        .filter(item => item?.type === 'text' && item.text)
        .map(item => item.text)
        .join('\n');
      return { found: true, transcriptPath, text, error: entry.error ?? null, timestamp: entry.timestamp ?? null };
    }
    return { found: false, transcriptPath, reason: 'no conversation entry in transcript tail' };
  }
  return { found: false, reason: 'transcript not found' };
};

export const usageLimitTextVerdict = (source, text) => {
  if (!text) return { source, isUsageLimit: false, reason: 'no text' };
  const info = detectUsageLimit(text);
  return { source, isUsageLimit: info.isUsageLimit, resetTime: info.resetTime, timezone: info.timezone, message: text, reason: info.isUsageLimit ? 'usage-limit text' : 'not a usage-limit text' };
};

/**
 * Combine every source into one verdict. A text source supplies the message
 * the user sees; a structured source (epoch `resetsAt`) supplies the exact
 * reset date, which a text like "resets 11am" lacks for a weekly window.
 *
 * @returns {{isUsageLimit: boolean, resetTime: string|null, timezone: string|null, message: string|null, sources: string[], verdicts: object[]}}
 */
export const combineClaudeUsageLimitVerdicts = (verdicts, toolLabel = 'Claude') => {
  const positive = verdicts.filter(v => v.isUsageLimit);
  if (positive.length === 0) return { isUsageLimit: false, resetTime: null, timezone: null, message: null, sources: [], verdicts };
  const textual = positive.find(v => v.message);
  const structured = positive.find(v => v.resetsAt);
  const timed = structured || positive.find(v => v.resetTime);
  const message = textual?.message || `${toolLabel} ${structured?.windowLabel || 'usage'} limit reached${structured?.resetTime ? ` · resets ${structured.resetTime} (UTC)` : ''}`;
  return { isUsageLimit: true, resetTime: timed?.resetTime ?? null, timezone: timed?.timezone ?? null, message, sources: positive.map(v => v.source), verdicts };
};

/**
 * Failure-path entry point: cross-check all sources and log each verdict in
 * verbose mode, so the next mismatch between sources is visible in the log.
 */
export const resolveClaudeUsageLimit = async ({ lastMessage, evidence, tempDir, sessionId, homeDir, env, fsImpl, log = async () => {} } = {}) => {
  const facts = evidence?.snapshot ? evidence.snapshot() : evidence || {};
  const transcript = await readClaudeTranscriptApiError({ tempDir, sessionId, homeDir, env, fsImpl }).catch(error => ({ found: false, reason: error.message }));
  const verdicts = [usageLimitTextVerdict('last message', lastMessage), usageLimitTextVerdict('stream API error message', facts.apiErrorText), transcript.found ? usageLimitTextVerdict('session transcript', transcript.text) : { source: 'session transcript', isUsageLimit: false, reason: transcript.reason }, { source: 'rate_limit_event', ...classifyClaudeRateLimitEvent(facts.rateLimitInfo) }, { source: 'debug 429 headers', ...classifyAnthropicDebugRateLimit(facts.debugRateLimit) }];
  const combined = combineClaudeUsageLimitVerdicts(verdicts);
  await log('🔍 Usage-limit cross-check (issue #3570):', { verbose: true });
  for (const v of verdicts) {
    const reset = v.resetTime ? `, reset ${v.resetTime}${v.timezone ? ` (${v.timezone})` : ''}` : '';
    await log(`   ${v.isUsageLimit ? '✔' : '·'} ${v.source}: ${v.reason}${reset}`, { verbose: true });
  }
  if (transcript.transcriptPath) await log(`   transcript: ${transcript.transcriptPath}`, { verbose: true });
  if (combined.isUsageLimit && !verdicts[0].isUsageLimit) await log(`⚠️ Usage limit found only in: ${combined.sources.join(', ')} — Claude Code did not report it on stdout (issue #3570)`, { level: 'warning' });
  return { ...combined, transcript };
};

export default { classifyAnthropicDebugRateLimit, classifyClaudeRateLimitEvent, combineClaudeUsageLimitVerdicts, createClaudeUsageLimitEvidence, formatEpochResetTimeUtc, readClaudeTranscriptApiError, resolveClaudeUsageLimit, usageLimitTextVerdict };
