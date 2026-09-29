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
 * Both incidents (links-notation#315 and browser-commander#106) were the same sweep: every stop
 * arrived after the last main-thread assistant event, some before and some after the final
 * `result`, and `killed.system` omitted the stopped local_bash tasks.
 */

export const CLAUDE_PRINT_BG_CEILING_PATTERN = /Background tasks still running after (\d+)s; terminating/;

export const INCOMPLETE_TURN_CONTINUATION_PROMPT = 'Continue the unfinished work. The previous print-mode turn ended while background tasks or subagents were still running, so Claude Code cancelled them. Re-run those tasks in the foreground, wait for their actual results in this turn, then finish all remaining issue and pull-request requirements. Do not end your turn merely to wait for background work.';

const isMainThread = data => !(typeof data?.parent_tool_use_id === 'string' && data.parent_tool_use_id.length > 0);

/**
 * @returns {{
 *   observeEvent: (data: object) => {afterResult: boolean},
 *   observeStderr: (text: string) => number|null,
 *   snapshot: () => {resultEvent: object|null, resultCount: number, stoppedTaskCount: number, stoppedTaskIds: string[], ceilingSeconds: number|null}
 * }}
 */
export const createClaudePrintTurnTracker = () => {
  let resultEvent = null;
  let resultCount = 0;
  let mainTurnOpen = true;
  let ceilingSeconds = null;
  // Tasks stopped while the main thread was idle. A stop the model requested itself (TaskStop)
  // is always followed by a main-thread assistant reply, which clears this set.
  let idleStoppedTaskIds = new Set();
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
        idleStoppedTaskIds = new Set();
      }
      const afterResult = resultCount > 0 && !mainTurnOpen;
      if (data.type === 'system' && data.subtype === 'task_notification' && data.status === 'stopped') {
        idleStoppedTaskIds.add(data.task_id || data.tool_use_id || `stopped-${idleStoppedTaskIds.size}`);
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
      return { resultEvent, resultCount, stoppedTaskCount: idleStoppedTaskIds.size, stoppedTaskIds: [...idleStoppedTaskIds], ceilingSeconds };
    },
  };
};

/** Decide whether print mode ended while background work was still pending. */
export const assessClaudeTurnCompletion = ({ resultEvent = null, stoppedTaskCount = 0, ceilingSeconds = null, recoveryAttempts = 0, maxRecoveryAttempts = 1, sessionId = null } = {}) => {
  const systemKilled = Number(resultEvent?.subagent_stats?.killed?.system) || 0;
  const ceilingHit = Number.isFinite(ceilingSeconds);
  const cancelledTasks = Math.max(systemKilled, stoppedTaskCount, ceilingHit ? 1 : 0);
  const incomplete = resultEvent?.subtype === 'success' && cancelledTasks > 0;
  const cause = ceilingHit ? `Claude Code stopped background tasks after its ${ceilingSeconds}s print-mode wait ceiling (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS)` : 'Claude Code stopped background tasks when print mode exited';
  return { incomplete, cancelledTasks, ceilingHit, cause, shouldResume: incomplete && recoveryAttempts < maxRecoveryAttempts && Boolean(sessionId), sessionId };
};
