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
 * carries on. Run 4c1dedd8 logged 23 "⚠️ Tool result error detected" lines, all of them of this
 * kind (harness-blocked `sleep`, Bash timeouts, non-zero exits), and each one also overwrote the
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
    if (item.type === 'tool_result' && item.is_error === true) facts.toolResultError = normalizeToolResultError(item.content);
  }

  if (!facts.toolResultError && typeof data.tool_use_result === 'string' && data.tool_use_result.trim().startsWith('Error:')) {
    facts.toolResultError = data.tool_use_result.trim();
  }

  if (facts.toolResultError) {
    const classification = classifyToolResultError(facts.toolResultError);
    facts.toolResultErrorIsBenign = classification.benign;
    facts.toolResultErrorCategory = classification.category;
  }

  return facts;
};

export const shouldFailClaudeStreamWithoutResult = ({ commandFailed, streamingInput, resultEventReceived }) => {
  return !commandFailed && !streamingInput && !resultEventReceived;
};

export const buildMissingClaudeResultMessage = ({ lastToolResultError, lastMessage }) => {
  const detail = lastToolResultError || lastMessage;
  if (!detail) return 'Claude stream ended without a terminal result event';
  return `Claude stream ended without a terminal result event after: ${String(detail).slice(0, 500)}`;
};
