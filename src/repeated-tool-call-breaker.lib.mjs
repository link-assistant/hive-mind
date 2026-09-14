/**
 * Circuit breaker for an agentic session that repeats one failing tool call.
 *
 * Issue #2247 (H4). The 2026-09-13 Kotlin `solve --model formal-ai --tool
 * claude` run made 547 `mcp__playwright__browser_click` calls with the same
 * input, `{"target": ""}`, and every one of them came back
 * `Unexpected token "" while parsing css selector ""`. The session only ended
 * when Anthropic answered `Prompt is too long` (Kotlin log line 106044), by
 * which point the whole context budget was spent and nothing had been written
 * to the repository. Neither the runner nor the watch loop noticed: a failing
 * tool call is ordinary, and nothing counted how many times the *same* one had
 * already failed.
 *
 * The breaker counts `(tool, input, is_error=true)` triples. `tool_use` and its
 * `tool_result` arrive in two different stream events - the result carries only
 * `tool_use_id` - so the call has to be remembered until its result shows up.
 *
 * Counting is cumulative per signature, not per consecutive run: a model that
 * alternates between two equally hopeless calls is in the same loop as one that
 * repeats a single call, and neither is making progress.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 */

/** The issue prescribes breaking after 3 identical failing calls. */
export const REPEATED_TOOL_CALL_LIMIT_DEFAULT = 3;

/**
 * A pending `tool_use` is only interesting until its result arrives. Claude can
 * emit several calls per turn, so the map is bounded rather than one-entry.
 */
const PENDING_TOOL_USE_LIMIT = 256;

/** Keep the reason line readable in a GitHub comment. */
const INPUT_PREVIEW_LENGTH = 200;

/**
 * Issue #2247 (H10): how often one failing call must recur before it is worth
 * naming in the failure report. Two is already a pattern the reader needs; the
 * breaker's own limit (3) is about stopping, this one is about explaining.
 */
export const DOMINANT_FAILURE_MIN_COUNT = 2;

/** Separator that cannot occur in a tool name or in JSON output. */
const SIGNATURE_SEPARATOR = '\u0000';

export const getRepeatedToolCallLimit = (env = process.env) => {
  const raw = env?.HIVE_MIND_REPEATED_TOOL_CALL_LIMIT;
  if (raw === undefined || raw === null || String(raw).trim() === '') return REPEATED_TOOL_CALL_LIMIT_DEFAULT;
  const parsed = Number.parseInt(String(raw), 10);
  // 0 or a negative value switches the breaker off; anything unparseable keeps the default.
  if (!Number.isFinite(parsed)) return REPEATED_TOOL_CALL_LIMIT_DEFAULT;
  return parsed;
};

/** Stable stringification so `{a:1,b:2}` and `{b:2,a:1}` are the same call. */
const stableStringify = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
};

export const buildToolCallSignature = ({ name, input } = {}) => `${name || 'unknown'}${SIGNATURE_SEPARATOR}${stableStringify(input === undefined ? null : input)}`;

export const describeRepeatedToolCall = ({ tool, input, count, error = null }) => {
  const inputText = stableStringify(input === undefined ? null : input);
  const inputPreview = inputText.length > INPUT_PREVIEW_LENGTH ? `${inputText.slice(0, INPUT_PREVIEW_LENGTH)}...` : inputText;
  const errorPreview = typeof error === 'string' && error.trim() ? ` Last error: ${error.trim().slice(0, INPUT_PREVIEW_LENGTH)}` : '';
  return `Identical tool call repeated ${count} times, failing every time: ${tool}(${inputPreview}).${errorPreview}`;
};

/**
 * Issue #2247 (H10): put the cause in front of the consequence.
 *
 * The Kotlin run's *Solution Draft Failed* comment said `Prompt is too long`,
 * which is what the provider replied after 547 identical failing clicks had
 * filled the context. The provider's error is true and useless; the repeated
 * call is what the reader has to fix.
 *
 * @param {Object} params
 * @param {string} params.message - the provider's error message
 * @param {Object|null} [params.dominant] - from `dominantFailure()`
 * @returns {string}
 */
export const explainFailureWithToolHistory = ({ message, dominant = null }) => {
  if (!dominant) return message;
  const cause = describeRepeatedToolCall(dominant);
  return message ? `${cause} The session then ended with: ${message}` : cause;
};

const asArray = value => (Array.isArray(value) ? value : value ? [value] : []);

const normalizeToolResultError = content => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content.find(item => item && typeof item === 'object' && typeof item.text === 'string');
    if (text) return text.text;
  }
  if (content === null || content === undefined) return null;
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
};

/**
 * @param {Object} [params]
 * @param {number} [params.limit] - break after this many identical failing calls
 * @returns {{observe: (event: any) => (null|Object), tripped: boolean, verdict: Object|null, counts: () => Map<string, number>}}
 */
export const createRepeatedToolCallBreaker = ({ limit = getRepeatedToolCallLimit() } = {}) => {
  const pending = new Map();
  const failures = new Map();
  // Issue #2247 (H10): the call behind each signature, so a failure report can
  // name it even when the count stayed below the breaker's limit.
  const details = new Map();
  let verdict = null;

  const rememberToolUse = item => {
    if (!item || typeof item !== 'object' || item.type !== 'tool_use' || !item.id) return;
    if (pending.size >= PENDING_TOOL_USE_LIMIT) pending.delete(pending.keys().next().value);
    pending.set(item.id, { name: item.name || 'unknown', input: item.input });
  };

  const recordFailure = item => {
    if (!item || typeof item !== 'object' || item.type !== 'tool_result' || item.is_error !== true) return null;
    const call = item.tool_use_id ? pending.get(item.tool_use_id) : null;
    // A result whose call was never seen (a resumed session replaying history,
    // a truncated stream) cannot be attributed, so it is not counted.
    if (!call) return null;
    pending.delete(item.tool_use_id);
    const signature = buildToolCallSignature(call);
    const count = (failures.get(signature) || 0) + 1;
    failures.set(signature, count);
    const error = normalizeToolResultError(item.content);
    details.set(signature, { tool: call.name, input: call.input, error });
    if (!(limit > 0) || count < limit) return null;
    verdict = { tool: call.name, input: call.input, count, limit, error, reason: describeRepeatedToolCall({ tool: call.name, input: call.input, count, error }) };
    return verdict;
  };

  return {
    get tripped() {
      return verdict !== null;
    },
    get verdict() {
      return verdict;
    },
    counts: () => new Map(failures),
    /**
     * The failing call this session made most often, when it recurred enough to
     * be worth reporting.
     *
     * @param {Object} [options]
     * @param {number} [options.minimum]
     * @returns {{tool: string, input: any, error: string|null, count: number}|null}
     */
    dominantFailure({ minimum = DOMINANT_FAILURE_MIN_COUNT } = {}) {
      let best = null;
      for (const [signature, count] of failures) {
        if (best && count <= best.count) continue;
        best = { ...(details.get(signature) || { tool: 'unknown', input: null, error: null }), count };
      }
      return best && best.count >= minimum ? best : null;
    },
    observe(event) {
      if (verdict) return verdict;
      if (!event || typeof event !== 'object') return null;
      for (const item of asArray(event.message?.content)) {
        rememberToolUse(item);
        const tripped = recordFailure(item);
        if (tripped) return tripped;
      }
      return null;
    },
  };
};

export default { createRepeatedToolCallBreaker, buildToolCallSignature, describeRepeatedToolCall, explainFailureWithToolHistory, getRepeatedToolCallLimit, DOMINANT_FAILURE_MIN_COUNT, REPEATED_TOOL_CALL_LIMIT_DEFAULT };
