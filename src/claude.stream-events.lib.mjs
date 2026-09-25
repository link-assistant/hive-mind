const asArray = value => (Array.isArray(value) ? value : value ? [value] : []);

export const getClaudeMessageContent = data => {
  if (!data || typeof data !== 'object') return [];
  return asArray(data.message?.content).filter(item => item && typeof item === 'object');
};

const normalizeToolResultError = value => {
  if (typeof value === 'string')
    return value
      .replace(/^<tool_use_error>/, '')
      .replace(/<\/tool_use_error>$/, '')
      .trim();
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Issue #2160: not every `tool_result` marked `is_error` says something about the session.
 * Most of them are the AI's own command failing inside the session — the AI sees the result and
 * carries on. Run 4c1dedd8 logged 26 "⚠️ Tool result error detected" lines, all of them of this
 * kind (11 harness-blocked `sleep`s, 9 × `Exit code 143` Bash timeouts, 4 × `Exit code 1`,
 * 2 × `Exit code 127`), and each one also overwrote the
 * last assistant message, so a truncated stream could be reported as having failed "after:
 * Blocked: sleep 240 …" instead of after what the AI actually said.
 *
 * Categories:
 *   - `harness_blocked`     the AI tool's own harness refused the command (e.g. foreground sleep)
 *   - `command_timeout`     the AI's command hit its Bash timeout (SIGTERM ⇒ exit code 143)
 *   - `command_exit_code`   a bare non-zero exit status with no further detail
 * Anything else is left unclassified and keeps being treated as a real error signal.
 *
 * @param {string|null} toolResultError - normalized tool_result error text
 * @returns {{benign: boolean, category: string|null}}
 */
export const classifyToolResultError = toolResultError => {
  if (typeof toolResultError !== 'string' || !toolResultError.trim()) return { benign: false, category: null };
  const text = toolResultError.trim();

  if (/^Blocked:/i.test(text)) return { benign: true, category: 'harness_blocked' };
  if (/Command timed out after/i.test(text)) return { benign: true, category: 'command_timeout' };
  // A bare "Exit code 143" is the SIGTERM the AI tool sends when its own Bash timeout fires.
  if (/^Exit code 143\.?$/i.test(text)) return { benign: true, category: 'command_timeout' };
  if (/^Exit code \d+\.?$/i.test(text)) return { benign: true, category: 'command_exit_code' };

  return { benign: false, category: null };
};

export const collectClaudeStreamEventFacts = data => {
  const facts = {
    messageCountDelta: 0,
    toolUseCountDelta: 0,
    lastText: null,
    // Issue #2263: whether this event carries a tool result, and whether the
    // final result in the event failed. Unlike toolResultError, this also
    // represents successful results so a later success can clear an earlier
    // exploratory failure.
    toolResultObserved: false,
    toolResultFailed: false,
    toolResultError: null,
    // Issue #2160: set when toolResultError is an in-session, self-handled tool failure.
    toolResultErrorIsBenign: false,
    toolResultErrorCategory: null,
    compactionSummary: null,
  };
  if (!data || typeof data !== 'object') return facts;

  if (data.type === 'message' || data.type === 'assistant' || data.type === 'user') facts.messageCountDelta = 1;
  if (data.type === 'tool_use') facts.toolUseCountDelta = 1;

  for (const item of getClaudeMessageContent(data)) {
    if (item.type === 'tool_use') facts.toolUseCountDelta++;
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      facts.lastText = item.text;
      if (data.type === 'user' && data.isSynthetic === true && item.text.includes('This session is being continued from a previous conversation') && item.text.includes('Summary:')) {
        facts.compactionSummary = item.text;
      }
    }
    if (item.type === 'tool_result') {
      facts.toolResultObserved = true;
      facts.toolResultFailed = item.is_error === true;
      facts.toolResultError = facts.toolResultFailed ? normalizeToolResultError(item.content) : null;
    }
  }

  if (!facts.toolResultObserved && typeof data.tool_use_result === 'string' && data.tool_use_result.trim().startsWith('Error:')) {
    facts.toolResultObserved = true;
    facts.toolResultFailed = true;
    facts.toolResultError = data.tool_use_result.trim();
  }

  if (facts.toolResultError) {
    const classification = classifyToolResultError(facts.toolResultError);
    facts.toolResultErrorIsBenign = classification.benign;
    facts.toolResultErrorCategory = classification.category;
  }

  return facts;
};

/**
 * Fold stream facts into the last observed tool result.
 *
 * A failed command followed by a successful edit/test is normal agent work;
 * the later result clears it. A diagnostic-rich failure immediately followed
 * only by the provider's top-level `subtype: success` is not verified success
 * (#2263); bare exit-status probes retain issue #2160's benign classification.
 */
export const updateTerminalToolResult = (previous, facts) => {
  if (!facts?.toolResultObserved) return previous || { observed: false, failed: false, benign: false, error: null };
  return {
    observed: true,
    failed: facts.toolResultFailed === true,
    benign: facts.toolResultFailed === true && facts.toolResultErrorIsBenign === true,
    error: facts.toolResultFailed === true ? facts.toolResultError || 'Tool result failed without diagnostics' : null,
  };
};

export const shouldFailClaudeStreamWithoutResult = ({ commandFailed, streamingInput, resultEventReceived }) => {
  return !commandFailed && !streamingInput && !resultEventReceived;
};

/**
 * Describe a stream that ended without a terminal result event (issue #2023).
 *
 * Detail preference, in order (issue #2160): a real tool error explains the truncation best; the
 * last thing the AI said is next; a benign in-session tool result (a blocked command, a Bash
 * timeout) is only used when there is nothing else, so it stays out of the message whenever the
 * assistant actually said something.
 *
 * @param {Object} params
 * @param {string|null} [params.lastToolResultError] - last non-benign tool_result error
 * @param {string|null} [params.lastMessage] - last assistant text
 * @param {string|null} [params.lastBenignToolResultError] - last self-handled tool_result error
 * @returns {string}
 */
export const buildMissingClaudeResultMessage = ({ lastToolResultError, lastMessage, lastBenignToolResultError = null }) => {
  const detail = lastToolResultError || lastMessage || lastBenignToolResultError;
  if (!detail) return 'Claude stream ended without a terminal result event';
  return `Claude stream ended without a terminal result event after: ${String(detail).slice(0, 500)}`;
};

/**
 * Issue #2296: Claude Code reports some API failures (401 "OAuth session
 * expired and could not be refreshed") as `{"subtype":"success","is_error":true}`.
 * Only a result that is not flagged `is_error` counts as a successful run: its
 * text is the solution summary and its cost is the authoritative total.
 */
export const isSuccessfulClaudeResult = data => data?.type === 'result' && data.subtype === 'success' && data.is_error !== true;

/**
 * Label for a result event in logs, e.g. "subtype: error_max_turns" or, for an
 * error reported with subtype "success", "error result, is_error: true,
 * subtype: success, error: authentication_failed".
 */
export const describeClaudeResultKind = data => {
  const subtype = data?.subtype || 'unknown';
  if (data?.is_error !== true || subtype !== 'success') return `subtype: ${subtype}`;
  return ['error result', 'is_error: true', `subtype: ${subtype}`, data.error ? `error: ${data.error}` : null, data.api_error_status ? `status: ${data.api_error_status}` : null].filter(Boolean).join(', ');
};
