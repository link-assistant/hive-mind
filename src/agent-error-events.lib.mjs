#!/usr/bin/env node

/**
 * Classification of the error records in an `@link-assistant/agent` stream.
 *
 * Pure helpers: no use-m and no process, so tests can feed them recorded streams.
 */

import { firstErrorText, stringifyErrorValue } from './error-text.lib.mjs';
import { parseJsonRecords } from './json-stream.lib.mjs';
import { sanitizeObjectStrings } from './unicode-sanitization.lib.mjs';

/**
 * Render one streamed agent error record as human-readable text (issue #2141).
 *
 * `@link-assistant/agent` 0.25.x publishes `NamedError.toObject()` under the
 * `error` key: `{"type":"error","error":{"name":"RetryTimeoutExceededError",
 * "data":{"message":"…"}}}`. The previous chain `data.message || data.error ||
 * raw.substring(0, 100)` returned that *object*, and interpolating it into
 * `Agent reported error: ${…}` produced the reason published to GitHub in issue
 * #2141: "AGENT execution failed with Agent reported error: [object Object]".
 *
 * @param {object} record - a sanitized JSON record from the agent stream.
 * @param {string} [raw] - the raw record text, used as a last resort.
 * @returns {string} readable error text, never `[object Object]`.
 */
export const extractAgentErrorText = (record, raw = '') => {
  const fallback = String(raw || '').substring(0, 200) || 'Agent emitted an error event without any details';
  return firstErrorText([record?.message, record?.error, record?.data, record], { fallback });
};

/**
 * Model/provider initialization failures that leave the session unable to do any
 * work at all (issue #2141).
 */
const FATAL_AGENT_LOG_PATTERNS = [/ProviderModelNotFoundError/i, /ProviderInitError/i, /NoSuchModelError/i, /ModelNotFoundError/i, /failed to initialize .*model/i];

/**
 * Detect an agent `log` record that reports a fatal startup failure (issue #2141).
 *
 * Reproduced locally with agent CLI 0.25.5: `agent --model nonexistent/model`
 * prints
 *
 *   {"type":"log","level":"error","service":"session.prompt",
 *    "error":"ProviderModelNotFoundError",
 *    "hint":"Check that the model exists in the provider",
 *    "message":"Failed to initialize specified model - NOT falling back to default"}
 *
 * then `session.idle` and exits **0** without ever emitting `{"type":"error"}`.
 * Hive Mind therefore reported the run as a success with no result summary, which
 * is the same class of undiagnosable outcome as issue #2141's `[object Object]`:
 * the run failed, but nothing said so.
 *
 * @param {object} record - a sanitized JSON record from the agent stream.
 * @returns {string|null} readable failure text, or null when the record is not fatal.
 */
export const detectFatalAgentLogRecord = record => {
  if (!record || typeof record !== 'object') return null;
  if (record.type !== 'log' || record.level !== 'error') return null;

  const text = firstErrorText([record.error, record.message], { fallback: '' });
  if (!text) return null;
  const haystack = `${stringifyErrorValue(record.error)} ${stringifyErrorValue(record.message)}`;
  if (!FATAL_AGENT_LOG_PATTERNS.some(pattern => pattern.test(haystack))) return null;

  const parts = [stringifyErrorValue(record.error), stringifyErrorValue(record.message), record.hint ? `hint: ${stringifyErrorValue(record.hint)}` : ''];
  return parts.filter(Boolean).join(' — ');
};

/** `error` and `step_error` records are the agent's explicit error reports. */
export const isAgentErrorRecord = record => record?.type === 'error' || record?.type === 'step_error';

/**
 * Whether an error record reports a failed tool call rather than a failed session.
 *
 * A failed tool call (a missing file, a bad edit anchor, a non-zero `bash` exit)
 * reaches the model as an ordinary tool result, and the model usually carries
 * on. Agent 0.26.13 and earlier also repeated each one as a top-level error
 * record carrying the tool part (link-assistant/agent#332):
 *
 *   {"type":"error","part":{"type":"tool","tool":"read",
 *    "state":{"status":"error","error":"Error: File not found: …/e.g"}},
 *    "message":"Error: File not found: …/e.g"}
 *
 * Later versions report the failure only on the `tool_use` event. An error
 * record that carries a failed tool part, or that is explicitly marked
 * `recoverable`, does not decide the run: the exit code and the session's own
 * records do. Every other error record (provider, retry timeout, session) stays
 * fatal. The error text alone is never used to guess.
 *
 * @param {object} record - a sanitized JSON record from the agent stream.
 * @returns {boolean}
 */
export const isRecoverableAgentToolError = record => {
  if (!isAgentErrorRecord(record)) return false;
  if (record.recoverable === true) return true;
  return record.part?.type === 'tool' && record.part.state?.status === 'error';
};

/** One log line for a failed tool call, naming the tool and its error. */
export const describeAgentToolError = (record, raw = '') => {
  const tool = record?.part?.tool ? `${record.part.tool}: ` : '';
  const text = firstErrorText([record?.part?.state?.error, record?.message, record?.error], { fallback: extractAgentErrorText(record, raw) });
  return `Tool call failed (returned to the model as the tool result): ${tool}${text}`;
};

/**
 * Remove raw records from captured output, so the raw-text fallback scan does
 * not count records that were already parsed and classified.
 */
export const omitRawRecords = (output, rawRecords) => rawRecords.reduce((remaining, raw) => remaining.replace(raw, ''), String(output || ''));

/**
 * Scan agent output for fatal JSON error records (issues #1201, #2119, #2141).
 *
 * Failed tool calls are skipped (see isRecoverableAgentToolError). When several
 * fatal records are present, the last one is reported: it is the error the
 * session ended on.
 *
 * Exported so the detection precedence can be tested directly instead of being
 * re-implemented in tests (the old duplicate in tests/test-agent-error-detection.mjs
 * kept the `[object Object]` bug invisible).
 *
 * @param {string} output - captured agent output.
 * @returns {{detected: boolean, type?: string, match?: string, record?: object}}
 */
export const detectAgentErrorsInOutput = output => {
  let detection = { detected: false };
  // Issue #2119: frame records by balanced JSON, not by newlines, so
  // pretty-printed and concatenated records are still inspected.
  for (const record of parseJsonRecords(output)) {
    const msg = sanitizeObjectStrings(record);
    // Issue #1968: ignore bare `null`/primitive records (msg.type would throw on null).
    if (msg === null || typeof msg !== 'object') continue;
    if (isAgentErrorRecord(msg) && !isRecoverableAgentToolError(msg)) {
      detection = { detected: true, type: 'AgentError', match: extractAgentErrorText(msg, JSON.stringify(msg)), record: msg };
    }
  }
  return detection;
};
