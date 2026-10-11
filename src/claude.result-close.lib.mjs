/**
 * Post-result stream close timing (Issue #3015, building on #1280 and #2301).
 *
 * After a `result` event the solver waits `HIVE_MIND_RESULT_STREAM_CLOSE_MS` (30 s) for the
 * Claude CLI to exit and then stops it (Issue #1280). That guard is meant for a CLI that hangs
 * after it is done. It is wrong when print mode is still waiting for background tasks: Claude
 * Code keeps the process alive until every background task finishes, or until its own
 * `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS` ceiling passes (raised to 40 min by Issue #2301). A
 * finished task re-wakes the model, which may start another turn and emit another `result`.
 *
 * In Issue #3015 a foreground `gh run watch` was auto-backgrounded after 10 minutes, the model
 * posted its success result, and 30 s later the solver sent SIGTERM while print mode was still
 * waiting for that task. The task was reported `stopped`, the exit code 143 was taken as a
 * failure, and the PR got "Solution Draft Failed" with the success summary as the error.
 *
 * This module keeps the set of running background tasks (from Claude Code's own stream events)
 * and computes how long the solver should wait for the CLI to exit:
 * - no background task running: `resultStreamCloseMs`, as before;
 * - background tasks running: until Claude Code's own wait ceiling, measured from when the main
 *   thread went idle, plus `resultStreamCloseMs` of grace. With the ceiling disabled (0), the
 *   stream activity timeout (or 1 h) bounds the wait instead.
 */

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled', 'error']);
const MAX_DESCRIPTION_LENGTH = 80;
const MAX_LISTED_TASKS = 5;
// Bound for the wait when both the print-mode ceiling and the activity timeout are disabled.
const DEFAULT_FALLBACK_WAIT_MS = 3600000;

/** True for an assistant message of the main thread (not a subagent). */
export const isMainThreadAssistantEvent = data => data?.type === 'assistant' && !(typeof data.parent_tool_use_id === 'string' && data.parent_tool_use_id.length > 0);

/**
 * Track Claude Code background tasks from its stream-json events.
 *
 * `background_tasks_changed` carries the authoritative list; `task_started`, `task_updated` and
 * `task_notification` keep the set right for CLI versions that do not send it.
 *
 * @returns {{ observeEvent: (data: object) => boolean, running: () => {id: string, type: string|null, description: string|null}[] }}
 *   `observeEvent` returns true when the set of running background tasks changed.
 */
export const createClaudeBackgroundTaskTracker = () => {
  let tasks = new Map();
  const descriptions = new Map();
  const signature = () => [...tasks.keys()].sort().join(',');
  const add = (id, type, description) => {
    if (!id) return;
    tasks.set(id, { id, type: type || tasks.get(id)?.type || null, description: description || tasks.get(id)?.description || descriptions.get(id) || null });
  };
  return {
    observeEvent(data) {
      if (data?.type !== 'system') return false;
      const before = signature();
      const id = data.task_id;
      if (data.subtype === 'task_started' && id) {
        if (data.description) descriptions.set(id, data.description);
        if (data.is_backgrounded === true) add(id, data.task_type, data.description);
      } else if (data.subtype === 'background_tasks_changed' && Array.isArray(data.tasks)) {
        const next = new Map();
        for (const task of data.tasks) {
          if (!task?.task_id) continue;
          next.set(task.task_id, { id: task.task_id, type: task.task_type || null, description: task.description || descriptions.get(task.task_id) || null });
        }
        tasks = next;
      } else if (data.subtype === 'task_updated' && id) {
        const patch = data.patch || {};
        if (TERMINAL_TASK_STATUSES.has(patch.status)) tasks.delete(id);
        else if (patch.is_backgrounded === true) add(id, null, null);
      } else if (data.subtype === 'task_notification' && id) {
        tasks.delete(id);
      }
      return signature() !== before;
    },
    running() {
      return [...tasks.values()];
    },
  };
};

const truncate = text => (text.length > MAX_DESCRIPTION_LENGTH ? `${text.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…` : text);

/** "bzyssdyux (Wait for CI runs on latest commit), …" */
export const describeBackgroundTasks = tasks => {
  const listed = tasks.slice(0, MAX_LISTED_TASKS).map(task => (task.description ? `${task.id} (${truncate(task.description)})` : task.id));
  if (tasks.length > listed.length) listed.push(`…and ${tasks.length - listed.length} more`);
  return listed.join(', ');
};

const formatSeconds = ms => `${Math.round(ms / 1000)}s`;

/**
 * Plan the post-result close timeout.
 *
 * @param {Object} options
 * @param {{id: string, description?: string|null}[]} options.runningTasks - background tasks still running
 * @param {number} options.awaitingExitSince - ms timestamp when the main thread went idle (last result)
 * @param {number} options.now - current ms timestamp
 * @param {number} options.streamCloseMs - `timeouts.resultStreamCloseMs`
 * @param {number} options.printBgWaitCeilingMs - `claudeCode.printBgWaitCeilingMs` (0 = Claude waits indefinitely)
 * @param {number} options.fallbackWaitMs - bound used when the ceiling is disabled (stream activity timeout; 1 h when 0)
 * @returns {{ delayMs: number, waitingForTasks: boolean, message: string }}
 */
export const planResultCloseTimeout = ({ runningTasks = [], awaitingExitSince, now, streamCloseMs, printBgWaitCeilingMs = 0, fallbackWaitMs = 0 }) => {
  if (!runningTasks.length) {
    return { delayMs: streamCloseMs, waitingForTasks: false, message: `starting ${formatSeconds(streamCloseMs)} stream close timeout (Issue #1280)` };
  }
  const fallbackMs = fallbackWaitMs > 0 ? fallbackWaitMs : DEFAULT_FALLBACK_WAIT_MS;
  const waitMs = printBgWaitCeilingMs > 0 ? printBgWaitCeilingMs : fallbackMs;
  const deadline = (Number.isFinite(awaitingExitSince) ? awaitingExitSince : now) + waitMs + streamCloseMs;
  const delayMs = Math.max(streamCloseMs, deadline - now);
  const bound = printBgWaitCeilingMs > 0 ? `Claude Code's ${formatSeconds(printBgWaitCeilingMs)} background wait ceiling` : `a ${formatSeconds(fallbackMs)} fallback (the background wait ceiling is disabled)`;
  return { delayMs, waitingForTasks: true, message: `Claude Code is waiting for ${runningTasks.length} background task(s): ${describeBackgroundTasks(runningTasks)}. Waiting up to ${formatSeconds(delayMs)} for the CLI to exit, bounded by ${bound} (Issues #3015, #2301)` };
};

/**
 * Own the post-result close timer for one Claude CLI run.
 *
 * - `onResult()` arms the timer when the main thread goes idle (first result of a turn).
 * - `observeEvent(data)` follows background tasks and re-plans the timer when they change. A
 *   main-thread assistant event means a finished task re-woke the model: the turn is open again,
 *   so the timer is paused until the next result.
 * - When the timer fires, `onTimeout()` stops the CLI; the still-running tasks are logged.
 *
 * @param {Object} options
 * @param {number} options.streamCloseMs
 * @param {number} options.printBgWaitCeilingMs
 * @param {number} options.fallbackWaitMs
 * @param {Function} options.log - async (message, options) logger
 * @param {() => boolean} options.isForceExitTriggered - true once the solver already stops the CLI
 * @param {() => Promise<void>|void} options.onTimeout - stop the CLI
 * @param {() => void} [options.onTurnReopened] - e.g. re-arm the stream activity timeout
 * @param {() => number} [options.now=Date.now]
 */
export const createClaudeResultCloseController = ({ streamCloseMs, printBgWaitCeilingMs, fallbackWaitMs, log, isForceExitTriggered, onTimeout, onTurnReopened = () => {}, now = Date.now }) => {
  const tasks = createClaudeBackgroundTaskTracker();
  let awaitingExitSince = null;
  let timer = null;
  let timeoutFired = false;
  let stoppedWithBackgroundTasks = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const schedule = async reason => {
    clear();
    const plan = planResultCloseTimeout({ runningTasks: tasks.running(), awaitingExitSince, now: now(), streamCloseMs, printBgWaitCeilingMs, fallbackWaitMs });
    await log(`📌 ${reason}, ${plan.message}`, { verbose: !plan.waitingForTasks });
    timer = setTimeout(async () => {
      timer = null;
      if (isForceExitTriggered()) return;
      timeoutFired = true;
      const stillRunning = tasks.running();
      stoppedWithBackgroundTasks = stillRunning.length > 0;
      const waited = formatSeconds(now() - awaitingExitSince);
      await log(`⚠️ Claude CLI did not exit ${waited} after its result${stoppedWithBackgroundTasks ? ` while background task(s) were still running: ${describeBackgroundTasks(stillRunning)}` : ''}; stopping it (Issues #1280, #3015)`, stoppedWithBackgroundTasks ? { level: 'warning' } : { verbose: true });
      await onTimeout();
    }, plan.delayMs);
  };
  return {
    /** True between a result and the next main-thread turn (or the end of the stream). */
    isAwaitingExit: () => awaitingExitSince !== null,
    async onResult() {
      if (awaitingExitSince !== null) return;
      awaitingExitSince = now();
      await schedule('Result event received');
    },
    async observeEvent(data) {
      const tasksChanged = tasks.observeEvent(data);
      if (awaitingExitSince === null || isForceExitTriggered()) return;
      if (isMainThreadAssistantEvent(data)) {
        clear();
        awaitingExitSince = null;
        onTurnReopened();
        await log('📌 Claude started another turn after its result; stream close timeout paused (Issue #3015)', { verbose: true });
      } else if (tasksChanged) {
        await schedule('Background tasks changed');
      }
    },
    stop: clear,
    runningTasks: () => tasks.running(),
    /** `timeoutFired`: the close timer stopped the CLI; `stoppedWithBackgroundTasks`: tasks were still running then. */
    state: () => ({ timeoutFired, stoppedWithBackgroundTasks }),
  };
};
