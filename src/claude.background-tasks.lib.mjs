// Issue #1739: Track Claude Code's `run_in_background: true` Bash tasks
// across a session so the harness can detect orphaned watchers when the
// `result` event arrives.
//
// Background:
//   When the model emits a Bash `tool_use` with `run_in_background: true`,
//   the Claude Code runtime emits two related events on the JSONL stream:
//
//     {"type":"system","subtype":"task_started","task_id":"abcd1234",
//      "tool_use_id":"toolu_…","description":"…","task_type":"local_bash"}
//
//     // … later, when the OS process exits …
//
//     {"type":"system","subtype":"task_completed","task_id":"abcd1234",…}
//
//   In the issue-1739 stuck-watch case the second event never arrived: the
//   model launched an unbounded `until [ ... ]; do sleep 20; done` poller
//   and ended its turn before the loop completed. The `task_completed`
//   event would never be emitted because the OS process never finished.
//
//   `BackgroundTaskTracker` lets the harness:
//     1. enumerate live background tasks at any point
//     2. log them when the `result` event arrives, making issue-1739-style
//        stuck sessions trivially diagnosable from a tail of the log
//     3. classify a session as "stuck-watch" if a passive `end_turn` arrived
//        with surviving background tasks (see `solve.stuck-watch-detection`)
//
// This library is intentionally small and pure: no logging side effects, no
// timers, no shared globals. The caller is responsible for wiring it into
// the JSONL parser and for emitting log lines.

/**
 * @typedef {Object} BackgroundTaskInfo
 * @property {string} taskId            The task_id assigned by Claude Code.
 * @property {string|null} toolUseId    The originating tool_use id, if known.
 * @property {string} description       Human-readable description from the tool_use.
 * @property {string} taskType          "local_bash" in practice.
 * @property {number} startedAt         Date.now() when task_started was observed.
 * @property {string|null} command      The Bash command, when available from the matching tool_use.
 */

export class BackgroundTaskTracker {
  constructor() {
    /** @type {Map<string, BackgroundTaskInfo>} */
    this.alive = new Map();
    /** @type {number} Counter that includes tasks already reaped. */
    this.totalStarted = 0;
    /** @type {Map<string, string>} Map tool_use_id -> command text, populated when we see the Bash tool_use ahead of the task_started event. */
    this.commandByToolUseId = new Map();
  }

  /**
   * Feed one parsed JSONL event from the Claude Code stream.
   * Returns the task object that was mutated, or null if the event is
   * unrelated to background tasks.
   *
   * @param {object} event
   * @returns {BackgroundTaskInfo|null}
   */
  observe(event) {
    if (!event || typeof event !== 'object') return null;

    // Cache Bash tool_use commands so we can attach them to the task_started
    // event that follows. Claude Code emits the assistant tool_use first,
    // then the system task_started.
    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block?.type !== 'tool_use') continue;
        if (block.name !== 'Bash') continue;
        if (block.input?.run_in_background !== true) continue;
        const toolUseId = block.id;
        const cmd = typeof block.input.command === 'string' ? block.input.command : '';
        if (toolUseId) this.commandByToolUseId.set(toolUseId, cmd);
      }
      return null;
    }

    if (event.type !== 'system') return null;
    if (event.subtype === 'task_started') {
      const taskId = event.task_id;
      if (!taskId) return null;
      const toolUseId = event.tool_use_id ?? null;
      const info = {
        taskId,
        toolUseId,
        description: typeof event.description === 'string' ? event.description : '',
        taskType: typeof event.task_type === 'string' ? event.task_type : 'unknown',
        startedAt: Date.now(),
        command: toolUseId ? (this.commandByToolUseId.get(toolUseId) ?? null) : null,
      };
      this.alive.set(taskId, info);
      this.totalStarted += 1;
      return info;
    }
    if (event.subtype === 'task_completed' || event.subtype === 'task_cancelled') {
      const taskId = event.task_id;
      if (!taskId) return null;
      const info = this.alive.get(taskId) ?? null;
      this.alive.delete(taskId);
      return info;
    }
    return null;
  }

  /**
   * Snapshot of currently-alive tasks, oldest first.
   * @returns {BackgroundTaskInfo[]}
   */
  liveTasks() {
    return Array.from(this.alive.values()).sort((a, b) => a.startedAt - b.startedAt);
  }

  /** Number of currently-alive tasks. */
  liveCount() {
    return this.alive.size;
  }

  /**
   * Format the live task list for human-readable logging.
   * Returns an array of lines (no trailing newlines), suitable for `log()`.
   *
   * @param {{ now?: number }} [options]
   * @returns {string[]}
   */
  formatForLog(options = {}) {
    const now = options.now ?? Date.now();
    const live = this.liveTasks();
    if (live.length === 0) {
      return ['🔎 Background tasks: clean (0 alive at result event)'];
    }
    const lines = [`🔎 Background tasks still alive at result event: ${live.length} (Issue #1739)`];
    for (const t of live) {
      const ageSeconds = Math.max(0, Math.round((now - t.startedAt) / 1000));
      const desc = t.description ? `desc=${JSON.stringify(t.description)}` : 'desc=<none>';
      const cmdPreview = t.command ? ` cmd=${JSON.stringify(t.command.length > 120 ? `${t.command.slice(0, 117)}…` : t.command)}` : '';
      lines.push(`   ├─ ${t.taskId}  age=${ageSeconds}s  ${desc}${cmdPreview}`);
    }
    return lines;
  }
}

/**
 * Heuristics for classifying a final assistant text block as "passive
 * waiting for a background task" rather than substantive work output.
 *
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function looksLikePassiveWaitText(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  // Long substantive summaries are NOT passive — even if they contain
  // "wait" they probably are also describing the work just done.
  if (trimmed.length > 240) return false;
  // Very short text is suspicious by itself.
  const passive = /(wait\s+for\b|i'?ll\s+wait|i\s+will\s+wait|i'?ll\s+be\s+notified|i\s+will\s+be\s+notified|once\s+(it|the).*(complete|finish)|when\s+(it|the).*(complete|finish)|background\s+(bash|task|command).*(complete|finish))/i;
  return passive.test(trimmed);
}

/**
 * Combine the tracker state and the final assistant text into a single
 * boolean: should the harness treat this `result.success` as a
 * stuck-watch session rather than a clean end-of-work?
 *
 * The harness can choose what to do with this — by default it logs and
 * still allows the existing flow to run, so this is purely diagnostic
 * unless `--abort-on-stuck-watch` is set.
 *
 * @param {{ tracker: BackgroundTaskTracker, finalText: string|null|undefined }} input
 * @returns {{ stuck: boolean, reason: string|null }}
 */
export function classifyStuckWatch({ tracker, finalText }) {
  if (!tracker || tracker.liveCount() === 0) {
    return { stuck: false, reason: null };
  }
  if (!looksLikePassiveWaitText(finalText)) {
    return { stuck: false, reason: null };
  }
  return {
    stuck: true,
    reason: `Result event arrived with ${tracker.liveCount()} live background task(s) and a passive final message; likely stuck on an unbounded watcher (Issue #1739)`,
  };
}

/**
 * Mutable state held by the harness for one Claude session. Wrap construction
 * in `createStuckWatchSessionState()` so call sites stay tiny.
 *
 * @typedef {Object} StuckWatchSessionState
 * @property {BackgroundTaskTracker} tracker
 * @property {string} lastAssistantText
 */

/** @returns {StuckWatchSessionState} */
export function createStuckWatchSessionState() {
  return { tracker: new BackgroundTaskTracker(), lastAssistantText: '' };
}

/**
 * Feed every parsed JSONL event into the session state — updates the tracker
 * and, for assistant events, snapshots the latest text block.
 *
 * @param {StuckWatchSessionState} state
 * @param {object} event
 */
export function observeSessionEvent(state, event) {
  if (!state) return;
  state.tracker.observe(event);
  if (event?.type === 'assistant' && event.message?.content) {
    for (const block of event.message.content) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        state.lastAssistantText = block.text;
      }
    }
  }
}

/**
 * Emit diagnostic log lines at result-event time. Always logs the live-task
 * snapshot; additionally logs a `🛑 STUCK-WATCH DETECTED` line if the session
 * matches the issue-1739 pattern.
 *
 * @param {StuckWatchSessionState} state
 * @param {(line: string, opts?: { verbose?: boolean }) => Promise<void> | void} log
 */
export async function reportStuckWatchAtResult(state, log) {
  if (!state) return;
  for (const line of state.tracker.formatForLog()) await log(line, { verbose: true });
  const stuckClass = classifyStuckWatch({ tracker: state.tracker, finalText: state.lastAssistantText });
  if (stuckClass.stuck) {
    await log(`🛑 STUCK-WATCH DETECTED: ${stuckClass.reason}`);
    await log(`   Final assistant text: ${JSON.stringify(state.lastAssistantText.slice(0, 200))}`);
  }
}

export default {
  BackgroundTaskTracker,
  looksLikePassiveWaitText,
  classifyStuckWatch,
  createStuckWatchSessionState,
  observeSessionEvent,
  reportStuckWatchAtResult,
};
