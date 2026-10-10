/**
 * Issue #2301: track whether a Claude Code print-mode (`-p`) turn really finished.
 *
 * Root cause (Claude Code 2.1.284): after the main thread goes idle, print mode waits for
 * background tasks (Agent/Bash with `run_in_background`, which is the default for Agent) only up
 * to `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` (600 s by default). When the ceiling passes it writes
 *   "Background tasks still running after 600s; terminating. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely."
 * to stderr, stops every task (`task_notification status=stopped`, `subagent_stats.killed.system`),
 * and each killed subagent receives synthetic "[Request interrupted by user]" / "The user doesn't
 * want to proceed with this tool use" results. No user or permission classifier is involved.
 *
 * All three incidents (links-notation#315 and two browser-commander#106 runs) were the same sweep:
 * every stop arrived after the last main-thread assistant event, some before and some after the
 * final `result`, and `killed.system` omitted the stopped local_bash tasks. In the third run the
 * subagents were still starting commands 2 s before the sweep: the ceiling counts from the main
 * thread's last message, not from the tasks' last progress.
 *
 * hive-mind keeps background work enabled, raises the ceiling (config.lib.mjs) and, when a sweep
 * still happens, resumes the same session with a prompt that tells the model what was cancelled.
 */

export const CLAUDE_PRINT_BG_CEILING_PATTERN = /Background tasks still running after (\d+)s; terminating/;

const MAX_LISTED_TASKS = 20;

/**
 * Prompt for the same-session continuation. The model learns that the wait ceiling (not a user)
 * cancelled its tasks, which tasks those were, and where their partial output is.
 */
export const buildIncompleteTurnContinuationPrompt = ({ cause, ceilingSeconds = null, stoppedTasks = [] } = {}) => {
  const listed = stoppedTasks.slice(0, MAX_LISTED_TASKS).map(task => `- ${task.summary || task.id}${task.outputFile ? ` (partial output: ${task.outputFile})` : ''}`);
  if (stoppedTasks.length > listed.length) listed.push(`- …and ${stoppedTasks.length - listed.length} more`);
  const reason = Number.isFinite(ceilingSeconds) ? `Claude Code cancelled them after its ${ceilingSeconds}s print-mode wait ceiling (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS)` : cause;
  return [`Continue the unfinished work. The previous turn ended while background tasks were still running, and ${reason}. This was an automatic timeout, not a user decision. Any "[Request interrupted by user]" or "The user doesn't want to proceed with this tool use" messages from those tasks came from the timeout.`, listed.length ? `Cancelled tasks:\n${listed.join('\n')}` : null, 'Check what they already changed (git status, git log, their partial output), then redo only what is missing and finish every remaining issue and pull-request requirement. Background tools and agents are still allowed and wake you with their results, but only within the wait ceiling after your turn ends. Run work that may take longer than that in the foreground (run_in_background: false).'].filter(Boolean).join('\n\n');
};

const isMainThread = data => !(typeof data?.parent_tool_use_id === 'string' && data.parent_tool_use_id.length > 0);

/**
 * @returns {{
 *   observeEvent: (data: object) => {afterResult: boolean},
 *   observeStderr: (text: string) => number|null,
 *   snapshot: () => {resultEvent: object|null, resultCount: number, stoppedTaskCount: number, stoppedTaskIds: string[], stoppedTasks: {id: string, summary: string|null, outputFile: string|null}[], ceilingSeconds: number|null}
 * }}
 */
export const createClaudePrintTurnTracker = () => {
  let resultEvent = null;
  let resultCount = 0;
  let mainTurnOpen = true;
  let ceilingSeconds = null;
  // Tasks stopped while the main thread was idle. A stop the model requested itself (TaskStop)
  // is always followed by a main-thread assistant reply, which clears this set.
  let idleStoppedTasks = new Map();
  return {
    /**
     * `afterResult` is true for events that arrive after a `result` and before the main thread
     * starts another turn. Print mode can emit several results (a task notification re-invokes the
     * model), so later main-thread turns are real work, not shutdown noise.
     */
    observeEvent(data) {
      if (!data || typeof data !== 'object') return { afterResult: false };
      if (data.type === 'assistant' && isMainThread(data)) {
        mainTurnOpen = true;
        idleStoppedTasks = new Map();
      }
      const afterResult = resultCount > 0 && !mainTurnOpen;
      if (data.type === 'system' && data.subtype === 'task_notification' && data.status === 'stopped') {
        const id = data.task_id || data.tool_use_id || `stopped-${idleStoppedTasks.size}`;
        idleStoppedTasks.set(id, { id, summary: data.summary || null, outputFile: data.output_file || null });
      }
      if (data.type === 'result') {
        resultEvent = data;
        resultCount++;
        mainTurnOpen = false;
      }
      return { afterResult };
    },
    /** Returns the ceiling in seconds when this stderr text announces the background-task sweep. */
    observeStderr(text) {
      const match = typeof text === 'string' ? CLAUDE_PRINT_BG_CEILING_PATTERN.exec(text) : null;
      if (!match) return null;
      ceilingSeconds = Number(match[1]);
      return ceilingSeconds;
    },
    snapshot() {
      const stoppedTasks = [...idleStoppedTasks.values()];
      return { resultEvent, resultCount, stoppedTaskCount: stoppedTasks.length, stoppedTaskIds: stoppedTasks.map(task => task.id), stoppedTasks, ceilingSeconds };
    },
  };
};

/** Decide whether print mode ended while background work was still pending. */
export const assessClaudeTurnCompletion = ({ resultEvent = null, stoppedTaskCount = 0, ceilingSeconds = null, recoveryAttempts = 0, maxRecoveryAttempts = 5, sessionId = null } = {}) => {
  const systemKilled = Number(resultEvent?.subagent_stats?.killed?.system) || 0;
  const ceilingHit = Number.isFinite(ceilingSeconds);
  const cancelledTasks = Math.max(systemKilled, stoppedTaskCount, ceilingHit ? 1 : 0);
  const incomplete = resultEvent?.subtype === 'success' && resultEvent.is_error !== true && cancelledTasks > 0;
  const cause = ceilingHit ? `Claude Code stopped background tasks after its ${ceilingSeconds}s print-mode wait ceiling (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS)` : 'Claude Code stopped background tasks when print mode exited';
  return { incomplete, cancelledTasks, ceilingHit, cause, shouldResume: incomplete && recoveryAttempts < maxRecoveryAttempts && Boolean(sessionId), sessionId };
};
