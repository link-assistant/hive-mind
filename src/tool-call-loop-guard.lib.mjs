/**
 * Issue #2316: one repeated-tool-call breaker for every adapter.
 *
 * The #2247 breaker lived in `src/claude.lib.mjs` only. The Rust `--tool codex`
 * run then issued the identical `gh issue view ...` command 78 times in a row
 * (6.2M input tokens) and nothing stopped it: codex, agent, opencode, gemini
 * and qwen never fed the breaker.
 *
 * Every adapter now hands its raw stdout to `createToolCallLoopGuard()`, which
 * normalizes the tool's stream format into `(tool, input, output, isError)`
 * calls and feeds `createRepeatedToolCallBreaker().recordCall()`. When the
 * breaker trips the guard stops the session, and the verdict is published so
 * the session-result layer can end the session with the `repeated_tool_call`
 * reason and the restart loop can hand the next session the reason as feedback.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2316
 */

import { createJsonStreamScanner } from './json-stream.lib.mjs';
import { createRepeatedToolCallBreaker, publishRepeatedToolCallVerdict } from './repeated-tool-call-breaker.lib.mjs';

export { publishRepeatedToolCallVerdict, resetRepeatedToolCallState, takeRepeatedToolCallFeedback, takeRepeatedToolCallVerdict } from './repeated-tool-call-breaker.lib.mjs';

export const REPEATED_TOOL_CALL_REASON = 'repeated_tool_call';

// ---------------------------------------------------------------------------
// Stream-format normalizers: one JSON record -> finished calls
// ---------------------------------------------------------------------------

/**
 * Codex `exec --json`: `item.completed` with a `command_execution` or
 * `mcp_tool_call` item.
 */
const codexCalls = record => {
  const item = record.type === 'item.completed' ? record.item : null;
  if (!item || typeof item !== 'object') return [];
  if (item.type === 'command_execution') {
    const isError = item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0);
    return [{ tool: 'shell', input: { command: item.command }, output: item.aggregated_output ?? null, isError }];
  }
  if (item.type === 'mcp_tool_call') {
    const isError = item.status === 'failed' || !!item.error;
    return [{ tool: `${item.server || 'mcp'}.${item.tool || 'unknown'}`, input: item.arguments ?? null, output: isError ? (item.error?.message ?? item.error) : (item.result ?? null), isError }];
  }
  return [];
};

/** Agent / OpenCode: a `tool` part whose state reached `completed` or `error`. */
const partCalls = (record, seen) => {
  const part = record.part;
  if (!part || typeof part !== 'object' || part.type !== 'tool') return [];
  const status = part.state?.status;
  if (status !== 'completed' && status !== 'error') return [];
  // The same part is re-emitted on every update; count each call once.
  const key = part.callID || part.id;
  if (key) {
    if (seen.has(key)) return [];
    seen.add(key);
  }
  const isError = status === 'error';
  return [{ tool: part.tool || 'unknown', input: part.state.input ?? null, output: isError ? (part.state.error ?? null) : (part.state.output ?? part.state.metadata?.output ?? null), isError }];
};

/** Gemini CLI stream-json: `tool_use` then `tool_result`, joined by `tool_id`. */
const geminiCalls = (record, pending) => {
  if (record.type === 'tool_use' && record.tool_id && record.tool_name) {
    pending.set(record.tool_id, { tool: record.tool_name, input: record.parameters ?? null });
    return [];
  }
  if (record.type !== 'tool_result' || !record.tool_id || !pending.has(record.tool_id)) return [];
  const call = pending.get(record.tool_id);
  pending.delete(record.tool_id);
  const isError = record.status === 'error';
  return [{ ...call, output: isError ? (record.error?.message ?? record.error ?? null) : (record.output ?? null), isError }];
};

// ---------------------------------------------------------------------------
// The guard
// ---------------------------------------------------------------------------

/**
 * @param {Object} params
 * @param {Function} [params.log] - async logger
 * @param {Function} [params.stopSession] - ends the running tool process
 * @param {number} [params.limit] - breaker limit (default: HIVE_MIND_REPEATED_TOOL_CALL_LIMIT or 3)
 * @param {Object} [params.breaker] - an existing breaker to feed (claude keeps its own for failure reports)
 */
export const createToolCallLoopGuard = ({ log = async () => {}, stopSession = async () => false, limit, breaker = createRepeatedToolCallBreaker(limit === undefined ? {} : { limit }) } = {}) => {
  const scanners = new Map();
  const seenParts = new Set();
  const pendingGeminiCalls = new Map();
  let stopped = false;

  const trip = async verdict => {
    if (stopped) return verdict;
    stopped = true;
    publishRepeatedToolCallVerdict(verdict);
    await log(`\n🛑 Repeated-tool-call breaker (${REPEATED_TOOL_CALL_REASON}): ${verdict.reason} Ending the session.`, { level: 'warning' });
    try {
      await stopSession(verdict);
    } catch (error) {
      await log(`⚠️ Could not stop the session after the breaker tripped: ${error.message}`, { level: 'warning' });
    }
    return verdict;
  };

  /** Feed one parsed stream record; returns the verdict once the breaker trips. */
  const observeEvent = async record => {
    if (stopped) return breaker.verdict;
    if (!record || typeof record !== 'object') return null;
    // Claude / Qwen stream-json (`message.content` tool_use + tool_result).
    const claudeVerdict = breaker.observe(record);
    if (claudeVerdict) return trip(claudeVerdict);
    for (const call of [...codexCalls(record), ...partCalls(record, seenParts), ...geminiCalls(record, pendingGeminiCalls)]) {
      const verdict = breaker.recordCall(call);
      if (verdict) return trip(verdict);
    }
    return null;
  };

  /** Feed a raw output chunk (NDJSON or pretty-printed JSON, any adapter). */
  const observeOutput = async (chunk, source = 'stdout') => {
    if (stopped) return breaker.verdict;
    if (!scanners.has(source)) scanners.set(source, createJsonStreamScanner());
    for (const event of scanners.get(source).write(chunk)) {
      if (event.type !== 'json') continue;
      const verdict = await observeEvent(event.value);
      if (verdict) return verdict;
    }
    return null;
  };

  return {
    observeOutput,
    observeEvent,
    get tripped() {
      return stopped;
    },
    get verdict() {
      return breaker.verdict;
    },
  };
};

export default { createToolCallLoopGuard, REPEATED_TOOL_CALL_REASON };
