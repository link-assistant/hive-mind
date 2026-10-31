const asArray = value => (Array.isArray(value) ? value : value ? [value] : []);

// What a tool call ran, in one line: the Bash command, otherwise the most telling input field.
const describeToolUseInput = input => {
  if (!input || typeof input !== 'object') return null;
  const value = ['command', 'file_path', 'path', 'pattern', 'url', 'query'].map(key => input[key]).find(candidate => typeof candidate === 'string' && candidate.trim());
  return value ? value.trim() : null;
};

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

const lastNonEmptyLine = text =>
  String(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .pop() || '';

// `gh pr checks` error text, see cli/cli pkg/cmd/pr/checks/checks.go: fmt.Errorf("no checks reported on the '%s' branch").
const GH_NO_CHECKS_REPORTED = /^no checks reported on the '[^'\n]*' branch$/i;
// `gh pr checks` non-TTY rows: "<name>\t<state>\t<elapsed>\t<url>\t<description>".
const GH_PENDING_CHECK_ROW = /^[^\t\n]+\tpending\t/im;

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
 *   - `nothing_to_commit`   `git commit` found nothing to commit (issue #2313): it exits 1, but
 *                           it says nothing about whether the solution works - the pull request
 *                           diff and CI decide that, not the last command's exit status
 *   - `no_checks_reported`  `gh pr checks` on a pull request without any CI checks (issue #3922):
 *                           gh deliberately exits 1 with "no checks reported on the '<branch>'
 *                           branch" (cli/cli#9390, cli/cli#9682). It is a status answer, not a
 *                           failed verification; hive-mind checks CI itself after the session
 *   - `checks_pending`      `gh pr checks` exits 8 while checks are still running (documented in
 *                           `gh pr checks --help`); the CI wait loop owns that outcome
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
  if (/^(Error: )?Exit code 1\b/i.test(text) && /^(nothing to commit|nothing added to commit|no changes added to commit)\b/im.test(text)) return { benign: true, category: 'nothing_to_commit' };
  // Issue #3922: only the LAST output line decides, because in a compound command
  // (`a; b; gh pr checks N`) the reported exit code is the one of the last command.
  const lastLine = lastNonEmptyLine(text);
  if (/^(Error: )?Exit code 1\b/i.test(text) && GH_NO_CHECKS_REPORTED.test(lastLine)) return { benign: true, category: 'no_checks_reported' };
  if (/^(Error: )?Exit code 8\b/i.test(text) && GH_PENDING_CHECK_ROW.test(text)) return { benign: true, category: 'checks_pending' };

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
    // Issue #2301: subagent events carry `parent_tool_use_id`. Their tool errors, text and
    // compaction summaries belong to the subagent, which handles them itself; they must not
    // become the main session's final tool result, last message, or summary fallback.
    fromSubagent: false,
    subagentToolResultError: null,
    // Issue #3922: main-thread tool calls ({id, name, command}) and the id a tool_result answers,
    // so a failed final tool result can name the command that failed instead of only its output.
    toolUses: [],
    toolResultToolUseId: null,
  };
  if (!data || typeof data !== 'object') return facts;
  facts.fromSubagent = typeof data.parent_tool_use_id === 'string' && data.parent_tool_use_id.length > 0;

  if (data.type === 'message' || data.type === 'assistant' || data.type === 'user') facts.messageCountDelta = 1;
  if (data.type === 'tool_use') facts.toolUseCountDelta = 1;

  for (const item of getClaudeMessageContent(data)) {
    if (item.type === 'tool_use') {
      facts.toolUseCountDelta++;
      if (typeof item.id === 'string' && item.id) facts.toolUses.push({ id: item.id, name: typeof item.name === 'string' ? item.name : null, command: describeToolUseInput(item.input) });
    }
    if (item.type === 'text' && typeof item.text === 'string' && item.text.trim()) {
      facts.lastText = item.text;
      if (data.type === 'user' && data.isSynthetic === true && item.text.includes('This session is being continued from a previous conversation') && item.text.includes('Summary:')) {
        facts.compactionSummary = item.text;
      }
    }
    if (item.type === 'tool_result') {
      facts.toolResultObserved = true;
      facts.toolResultFailed = item.is_error === true;
      facts.toolResultToolUseId = typeof item.tool_use_id === 'string' ? item.tool_use_id : null;
      facts.toolResultError = facts.toolResultFailed ? normalizeToolResultError(item.content) : null;
    }
  }

  if (!facts.toolResultObserved && typeof data.tool_use_result === 'string' && data.tool_use_result.trim().startsWith('Error:')) {
    facts.toolResultObserved = true;
    facts.toolResultFailed = true;
    facts.toolResultError = data.tool_use_result.trim();
  }

  if (facts.fromSubagent) {
    facts.subagentToolResultError = facts.toolResultError;
    Object.assign(facts, { lastText: null, compactionSummary: null, toolResultObserved: false, toolResultFailed: false, toolResultError: null, toolUses: [], toolResultToolUseId: null });
    return facts;
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
const MAX_TRACKED_TOOL_USES = 64;
const emptyTerminalToolResult = () => ({ observed: false, failed: false, benign: false, category: null, error: null, toolUseId: null, toolName: null, command: null, toolUses: new Map() });

export const updateTerminalToolResult = (previous, facts, { afterResult = false } = {}) => {
  const base = previous || emptyTerminalToolResult();
  // Issue #2301: between a `result` and the next main-thread turn, print mode only emits
  // shutdown noise (task stop notifications, synthetic cancellation results). They describe
  // cancelled background work, not a user decision or the result of the completed turn.
  if (afterResult) return base;
  // Issue #3922: remember which command each tool_use id ran (bounded; results follow their call).
  let toolUses = base.toolUses instanceof Map ? base.toolUses : new Map();
  if (facts?.toolUses?.length) {
    toolUses = new Map(toolUses);
    for (const toolUse of facts.toolUses) toolUses.set(toolUse.id, toolUse);
    while (toolUses.size > MAX_TRACKED_TOOL_USES) toolUses.delete(toolUses.keys().next().value);
  }
  if (!facts?.toolResultObserved) return toolUses === base.toolUses ? base : { ...base, toolUses };
  const failed = facts.toolResultFailed === true;
  const toolUse = facts.toolResultToolUseId ? toolUses.get(facts.toolResultToolUseId) : null;
  return {
    observed: true,
    failed,
    benign: failed && facts.toolResultErrorIsBenign === true,
    category: failed ? facts.toolResultErrorCategory || null : null,
    error: failed ? facts.toolResultError || 'Tool result failed without diagnostics' : null,
    toolUseId: facts.toolResultToolUseId || null,
    toolName: toolUse?.name || null,
    command: toolUse?.command || null,
    toolUses,
  };
};

const clip = (value, max) => {
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

const COUNT_SUMMARY_LINE = /^\d+ (errors?|warnings?|failed|failures?)(,? (and )?\d+ (errors?|warnings?))?\.?$/i;
const ERROR_LINE = /\b(error|fail(ed|ure)?|fatal|exception|denied|not found|cannot|can't|unable|no such|invalid|refused|timed out)\b/i;

/**
 * Issue #3922: the user-facing reason for a session whose result said success while its last tool
 * call failed. The old text was "Final tool result failed: " + the whole tool output flattened to
 * one line, so a compound command published unrelated PR comments as "the error" and never said
 * which command failed. This names the command, the exit code and the one output line that
 * explains the failure (the last error-looking line, else the last line).
 *
 * @param {{error: string|null, command?: string|null, toolName?: string|null}} terminal
 * @returns {string}
 */
export const describeFinalToolResultFailure = ({ error, command = null, toolName = null } = {}) => {
  const text = typeof error === 'string' ? error.trim() : '';
  const exitMatch = text.match(/^(?:Error: )?Exit code (\d+)\b/i);
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (exitMatch) lines[0] = lines[0].slice(exitMatch[0].length).replace(/^[\s.:]+/, '');
  const outputLines = lines.filter(Boolean);
  // Count summaries ("1 error", "2 errors and 1 warning") name no cause; the diagnostic above them does.
  const reasonLine = [...outputLines].reverse().find(line => ERROR_LINE.test(line) && !COUNT_SUMMARY_LINE.test(line)) || outputLines[outputLines.length - 1] || null;
  const what = command ? `its last command \`${clip(command, 160)}\`` : toolName ? `its last ${toolName} tool call` : 'its last tool call';
  const how = exitMatch ? `exited with code ${exitMatch[1]}` : 'failed';
  const detail = reasonLine ? `: ${clip(reasonLine, 240)}` : ' without any output';
  return `Claude reported success, but ${what} ${how}${detail}`;
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
