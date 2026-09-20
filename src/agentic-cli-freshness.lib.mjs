/**
 * Pre-flight CLI freshness check (issue #2202, R6).
 *
 * R6: "/models and each /solve and other commands that relevant for
 * claude/codex tools should check if new version available, and before
 * starting task execution or before providing new models list - we should
 * update them."
 *
 * `updateAgenticClisWhenIdle` already knows how to do the refresh safely — it
 * throttles registry reads, takes a state lock, and refuses to swap a binary
 * out from under a running task. What it lacked was a caller other than the
 * Telegram maintenance tick, and two things a command entry point needs:
 *
 *  1. **Narrowing.** `hive-models --tool codex` should not reinstall Gemini.
 *  2. **Not counting itself as busy.** The idle gate scans `/proc` for running
 *     solve/task processes by issue reference. A solve run that checks for
 *     updates after it has started would find *itself* and defer forever, so
 *     the caller passes its own task reference to be ignored.
 *
 * Everything here is best-effort: a refresh failure must never stop the command
 * the operator actually asked for.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2202
 */

import { AGENTIC_CLI_TARGETS, isAgenticCliAutoUpdateEnabled, updateAgenticClisWhenIdle } from './agentic-cli-updater.lib.mjs';

const KNOWN_TOOL_IDS = new Set(AGENTIC_CLI_TARGETS.map(target => target.id));

/** Tool aliases Hive Mind commands use that are not the updater's target id. */
export const FRESHNESS_TOOL_ALIASES = Object.freeze({
  'claude-code': 'claude',
  'gemini-cli': 'gemini',
  'qwen-code': 'qwen',
  'github-copilot': 'copilot',
  'opencode-ai': 'opencode',
});

/** Normalize whatever a command calls its tool into updater target ids. */
export const resolveFreshnessTools = tools => {
  const requested = (Array.isArray(tools) ? tools : [tools])
    .flatMap(entry =>
      String(entry ?? '')
        .split(',')
        .map(part => part.trim().toLowerCase())
    )
    .filter(Boolean);
  const resolved = [];
  for (const entry of requested) {
    const id = FRESHNESS_TOOL_ALIASES[entry] ?? entry;
    if (KNOWN_TOOL_IDS.has(id) && !resolved.includes(id)) resolved.push(id);
  }
  return resolved;
};

/** `https://github.com/o/r/issues/7` → `{owner:'o', repo:'r', number:7}`. */
export const parseTaskRef = value => {
  if (!value) return null;
  if (typeof value === 'object') {
    const number = Number(value.number);
    if (!value.owner || !value.repo || !Number.isFinite(number)) return null;
    return { owner: String(value.owner), repo: String(value.repo), number };
  }
  const match = String(value).match(/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/i);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
};

const sameRef = (a, b) => a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase() && a.number === b.number;

/**
 * Refresh the agentic CLIs a command is about to drive.
 *
 * Never throws: every failure path returns a status the caller can log and
 * ignore. Statuses come from `updateAgenticClisWhenIdle`
 * (`checked`/`throttled`/`busy`/`disabled`) plus `skipped` for a caller opt-out
 * and `error` when the refresh itself blew up.
 *
 * @param {object} options
 * @param {string|string[]} options.tools tool ids/aliases the command needs
 * @param {boolean} options.enabled false for `--no-update`
 * @param {Array} options.ignoreTasks task refs or GitHub URLs that are *this* run
 */
export const ensureAgenticCliFreshness = async ({ tools = [], env = process.env, log = null, verbose = false, force = false, enabled = true, ignoreTasks = [], getActiveTasksImpl = null, updateImpl = updateAgenticClisWhenIdle, minIntervalMs = undefined } = {}) => {
  const only = resolveFreshnessTools(tools);
  if (!enabled) return { status: 'skipped', reason: 'the caller disabled the update check (--no-update)', tools: only, updated: [], upToDate: [], failed: [] };
  if (!isAgenticCliAutoUpdateEnabled(env)) return { status: 'disabled', reason: 'HIVE_MIND_AGENTIC_CLI_AUTO_UPDATE is off', tools: only, updated: [], upToDate: [], failed: [] };

  const ignored = ignoreTasks.map(parseTaskRef).filter(Boolean);
  let activeTasks = getActiveTasksImpl;
  if (ignored.length > 0) {
    const inner = getActiveTasksImpl ?? (await import('./cleanup.os.lib.mjs')).getActiveTasks;
    activeTasks = async options => {
      const tasks = await inner(options);
      return tasks.filter(task => !ignored.some(ref => sameRef(ref, { owner: task.owner, repo: task.repo, number: Number(task.number) })));
    };
  }

  try {
    const result = await updateImpl({ env, log, verbose, force, only, ...(activeTasks ? { getActiveTasksImpl: activeTasks } : {}), ...(minIntervalMs === undefined ? {} : { minIntervalMs }) });
    return { tools: only, updated: [], upToDate: [], failed: [], ...result };
  } catch (error) {
    const message = String(error?.message ?? error);
    if (verbose && log) await log(`[VERBOSE] agentic-cli-freshness: refresh failed — ${message}`);
    return { status: 'error', reason: message, tools: only, updated: [], upToDate: [], failed: [] };
  }
};

/** One human-readable line summarising a freshness result, or null when there is nothing to say. */
export const describeFreshnessResult = result => {
  if (!result) return null;
  if (result.updated?.length > 0) return `⬆️ Updated ${result.updated.map(entry => `${entry.id} ${entry.from} → ${entry.to}`).join(', ')}`;
  if (result.failed?.length > 0) return `⚠️ Could not update ${result.failed.map(entry => entry.id).join(', ')}`;
  if (result.status === 'busy') return 'Skipped the CLI update check: other tasks are running.';
  return null;
};

export default { FRESHNESS_TOOL_ALIASES, describeFreshnessResult, ensureAgenticCliFreshness, parseTaskRef, resolveFreshnessTools };
