#!/usr/bin/env node

/**
 * Post-run diagnostics for a `codex exec --json` stream (issue #2130).
 *
 * Split out of codex.lib.mjs to keep that file under the max-lines budget, and
 * kept pure so the "is this line a real warning?" decisions are unit-testable.
 *
 * The motivating defect: when a run already failed (`turn.failed`, non-zero
 * exit), Codex never writes the `--output-last-message` file and never emits a
 * `turn.completed` usage block. Hive Mind reported both of those *expected*
 * consequences as WARNINGs, so the log for a single upstream failure carried two
 * extra warnings that pointed at nothing actionable:
 *
 *   [WARNING] ⚠️ Could not read Codex final message file: ENOENT: no such file …
 *   [WARNING] 📈 No Codex usage found in turn.completed events
 *
 * See docs/case-studies/issue-2130 (data/tool-logs/codex-02-rv2k7W.log.gz:752).
 */

/**
 * Did this Codex run already report a failure of its own?
 *
 * @param {object} params
 * @param {object} [params.state] - accumulated parseCodexExecJsonOutput state.
 * @param {number|null} [params.exitCode] - the CLI exit code, if known.
 * @returns {boolean}
 */
export const codexRunAlreadyFailed = ({ state = {}, exitCode = null } = {}) => {
  if (typeof exitCode === 'number' && exitCode !== 0) return true;
  if (state.authError) return true;
  return !!(state.turnFailures?.length || state.itemErrors?.length || state.streamErrors?.length);
};

const isMissingFileError = error => error?.code === 'ENOENT' || /ENOENT/.test(error?.message || '');

/**
 * Describe the `--output-last-message` file outcome.
 *
 * @param {object} params
 * @param {string} params.lastMessageFile - the path Codex was asked to write.
 * @param {string|null} [params.lastMessage] - trimmed contents, when readable.
 * @param {Error|null} [params.readError] - the read failure, when unreadable.
 * @param {boolean} [params.runFailed] - result of codexRunAlreadyFailed.
 * @returns {{message: string, options: object}} a single log line.
 */
export const describeCodexLastMessageOutcome = ({ lastMessageFile, lastMessage = null, readError = null, runFailed = false }) => {
  if (readError) {
    // A failed run never gets far enough to write the file; saying so at
    // warning level invents a second problem on top of the reported one.
    if (isMissingFileError(readError) && runFailed) {
      return { message: '📝 Codex wrote no final message file (the run ended with an error)', options: { verbose: true } };
    }
    return { message: `⚠️ Could not read Codex final message file: ${readError.message}`, options: { level: 'warning', verbose: true } };
  }

  if (lastMessage) {
    return { message: `📝 Final Codex message captured in ${lastMessageFile}`, options: { verbose: true } };
  }

  if (runFailed) {
    return { message: '📝 Codex left the final message file empty (the run ended with an error)', options: { verbose: true } };
  }
  return { message: `⚠️ Final Codex message file was empty: ${lastMessageFile}`, options: { level: 'warning', verbose: true } };
};

/**
 * Build every verbose diagnostic line for a finished Codex run.
 *
 * @param {object} params
 * @param {object} params.state - accumulated parseCodexExecJsonOutput state.
 * @param {number|null} [params.exitCode] - the CLI exit code, if known.
 * @param {string} params.mappedModel - the model id used for reporting.
 * @returns {Array<{message: string, options: object}>} lines in log order.
 */
export const buildCodexRunDiagnostics = ({ state = {}, exitCode = null, mappedModel = null } = {}) => {
  const runFailed = codexRunAlreadyFailed({ state, exitCode });
  const lines = [];
  const push = (message, options = { verbose: true }) => lines.push({ message, options });

  const counts = pairs =>
    Object.entries(pairs || {})
      .map(([key, count]) => `${key}=${count}`)
      .join(', ');

  if (Object.keys(state.eventCounts || {}).length > 0) push(`📊 Codex JSON events: ${counts(state.eventCounts)}`);
  if (Object.keys(state.itemTypeCounts || {}).length > 0) push(`📦 Codex item types: ${counts(state.itemTypeCounts)}`);

  // Issue #2136: protocol-shaped JSON that arrived on codex's stderr (OTEL
  // `codex.tool_result` records replay the raw stdout of every command codex
  // runs, so a task driving another agent CLI replays that agent's NDJSON). These
  // lines are deliberately NOT counted as codex events; surfacing them keeps the
  // discrepancy between "events codex emitted" and "protocol lines seen in the
  // log" explainable when a run is investigated after the fact.
  if (Object.keys(state.telemetryEventCounts || {}).length > 0) {
    push(`🪞 Echoed protocol-shaped lines on codex stderr (ignored, not codex events): ${counts(state.telemetryEventCounts)}`);
  }
  if (state.turnLifecycle?.length > 0) push(`🔁 Codex turn lifecycle: ${state.turnLifecycle.join(' → ')}`);

  // Issue #2140: codex starts exactly one thread per `codex exec`, so any other
  // thread id on the protocol stream is echoed output that leaked past the
  // stream separation above. Always worth saying out loud.
  if (state.foreignThreadIds?.length > 0) {
    push(`🧬 Foreign thread IDs seen on the codex protocol stream (echoed, not codex sessions): ${state.foreignThreadIds.join(', ')}`, { level: 'warning', verbose: true });
  }

  const usage = state.tokenUsage || {};
  if (usage.stepCount > 0) {
    push(`📈 Codex usage from turn.completed: ${usage.inputTokens.toLocaleString()} input, ${usage.cacheReadTokens.toLocaleString()} cache read, ${usage.outputTokens.toLocaleString()} output across ${usage.stepCount} turn(s)`);
  } else if (runFailed) {
    // No `turn.completed` is the definition of a failed turn, not a second fault.
    push('📈 Codex reported no usage (the turn never completed)');
  } else {
    push('📈 No Codex usage found in turn.completed events', { level: 'warning', verbose: true });
  }

  if (state.subAgentCalls?.length > 0) push(`🤝 Codex collab/sub-agent calls observed: ${state.subAgentCalls.length}`);
  if (state.reasoningSummaries?.length > 0) push(`🧠 Codex reasoning summaries observed: ${state.reasoningSummaries.length}`);
  if (state.commandExecutions?.length > 0) push(`💻 Codex command executions observed: ${state.commandExecutions.length}`);
  if (state.fileChanges?.length > 0) push(`📝 Codex file change items observed: ${state.fileChanges.length}`);
  if (state.mcpToolCalls?.length > 0) push(`🔌 Codex MCP tool calls observed: ${state.mcpToolCalls.length}`);
  if (state.webSearches?.length > 0) push(`🌐 Codex web searches observed: ${state.webSearches.length}`);
  if (state.todoLists?.length > 0) push(`📋 Codex todo list updates observed: ${state.todoLists.length} (latest: ${state.todoLists.at(-1)?.items?.length || 0} items)`);
  if (state.itemErrors?.length || state.turnFailures?.length || state.streamErrors?.length) {
    push(`⚠️ Codex error events observed: item=${state.itemErrors?.length || 0}, turn=${state.turnFailures?.length || 0}, stream=${state.streamErrors?.length || 0}`);
  }
  if (state.observedUsageFieldSets?.length > 0) push(`📐 Codex usage fields observed: ${state.observedUsageFieldSets.at(-1).join(', ')}`);
  if (state.observedModelDiagnosticPaths?.length > 0) {
    push(`🔎 Undocumented model-related JSON fields observed but ignored for accounting: ${state.observedModelDiagnosticPaths.join(', ')}`);
  } else {
    push(`🤖 Codex exec JSON did not expose model IDs; using requested model for reporting: ${mappedModel}`);
  }

  return lines;
};
