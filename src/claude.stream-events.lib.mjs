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

export const collectClaudeStreamEventFacts = data => {
  const facts = {
    messageCountDelta: 0,
    toolUseCountDelta: 0,
    lastText: null,
    toolResultError: null,
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
