/**
 * `/after` and `/enqueue`: start one solve task after another task (issue #4069).
 *
 * The task to wait for is found the way `/stop`, `/log` and `/watch` find a
 * task: a session UUID or an issue/pull request link, in the command or in the
 * replied message. The task to start is the one GitHub link the command lists,
 * or the awaited task's link again when the command lists none. Everything
 * else in the command is passed to solve as for `/solve`.
 *
 *   /after <task-link> [options]                 (reply to the awaited task's message)
 *   /after <uuid|awaited-link> <task-link> [options]
 *   /after [options]                             (reply: run the same link again afterwards)
 *
 * `/after` starts the task only when the awaited task succeeds; when it fails,
 * the waiting task fails too. `/enqueue` starts it when the awaited task
 * finishes, whatever the outcome.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4069
 */

import { extractSessionIdFromText } from './telegram-log-command.lib.mjs';
import { extractGitHubTargetLinks, getReplyLinkText, splitCommandTargetLinks } from './telegram-solve-batch.lib.mjs';
import { DEPENDENCY_COMMAND_MODES, DEPENDENCY_MODE } from './telegram-solve-dependencies.lib.mjs';

/** Commands that queue one task after another; each maps to its dependency mode. */
export const AFTER_COMMAND_NAMES = Object.freeze(Object.keys(DEPENDENCY_COMMAND_MODES));

const UUID_ONLY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The dependency mode of a command name (`after`, `enqueue`), or null for other commands. */
export function getDependencyCommandMode(commandName) {
  const name = String(commandName || '')
    .replace(/^\//, '')
    .split('@')[0]
    .toLowerCase();
  return DEPENDENCY_COMMAND_MODES[name] || null;
}

/**
 * Work out what an `/after` or `/enqueue` command waits for and what it starts.
 *
 * @param {object} params
 * @param {string[]} params.userArgs - Parsed command arguments
 * @param {object|null} params.replyMessage - The replied message, if any
 * @param {object} params.deps - { parseGitHubUrl, cleanNonPrintableChars, mentionsGitHubHost }
 * @returns {{ok: true, target: {kind: 'uuid'|'url', value: string, source: 'argument'|'reply'}, taskUrl: string|null, optionArgs: string[]}
 *   | {ok: false, error: 'no-target'|'many-tasks'|'invalid-link', links?: string[]}}
 *   `taskUrl` is null when the command names no task link: the awaited task's link is started again.
 */
export function parseDependencyCommand({ userArgs = [], replyMessage = null, deps }) {
  const uuidArgs = userArgs.filter(arg => UUID_ONLY_RE.test(String(arg).trim()));
  const rest = userArgs.filter(arg => !uuidArgs.includes(arg));
  const { urls, invalidLinks, optionArgs } = splitCommandTargetLinks(rest, deps);
  if (invalidLinks.length > 0) return { ok: false, error: 'invalid-link', links: invalidLinks };
  if (uuidArgs.length > 1) return { ok: false, error: 'many-tasks', links: uuidArgs };

  let target = null;
  let taskLinks = urls;
  // As in `/stop`, what the command names wins over the replied message.
  if (uuidArgs.length === 1) {
    target = { kind: 'uuid', value: uuidArgs[0].trim().toLowerCase(), source: 'argument' };
  } else if (urls.length >= 2) {
    target = { kind: 'url', value: urls[0], source: 'argument' };
    taskLinks = urls.slice(1);
  } else if (replyMessage) {
    const replyText = getReplyLinkText(replyMessage);
    const replyUuid = extractSessionIdFromText(replyText);
    const replyUrl = replyUuid ? null : extractGitHubTargetLinks(replyText, deps).urls[0] || null;
    if (replyUuid) target = { kind: 'uuid', value: replyUuid, source: 'reply' };
    else if (replyUrl) target = { kind: 'url', value: replyUrl, source: 'reply' };
  }
  if (!target) return { ok: false, error: 'no-target' };
  if (taskLinks.length > 1) return { ok: false, error: 'many-tasks', links: taskLinks };
  return { ok: true, target, taskUrl: taskLinks[0] || null, optionArgs };
}

/** Whether `url` is the link of one of the awaited tasks (re-running a link after its own task is allowed). */
export function isAwaitedTaskUrl(targets = [], url, canonicalize = value => value) {
  const key = canonicalize(url);
  return targets.some(target => (target.url && canonicalize(target.url) === key) || (target.item?.url && canonicalize(target.item.url) === key));
}

/**
 * Decide how one solve task launches: now, after other tasks, or not at all.
 * Combines an `/after`/`/enqueue` dependency with `--respect-blockers`.
 *
 * @param {object} params
 * @param {{targets: object[], mode: string}|null} [params.dependsOn] - From `/after` or `/enqueue`
 * @param {boolean} [params.respectBlockers]
 * @param {Function} params.planBlockers - `() => planBlockerWait(...)` for this URL
 * @param {Function} params.tr - `(key, params) => string` in the requester's locale
 * @param {Function} params.escape - Markdown escaping
 * @returns {Promise<{action: 'start', notes: string[]} | {action: 'wait', targets: object[], mode: string, waitingText: string} | {action: 'reject', reason: string}>}
 */
export async function planSolveLaunchWait({ dependsOn = null, respectBlockers = false, planBlockers, tr, escape = value => value }) {
  const targets = [...(dependsOn?.targets || [])];
  const mode = dependsOn?.mode || DEPENDENCY_MODE.SUCCESS;
  const lines = [];
  const notes = [];
  if (targets.length > 0) {
    const tasks = escape(targets.map(target => target.label).join(', '));
    lines.push(tr(mode === DEPENDENCY_MODE.FINISH ? 'telegram.solve_after_waiting_finish' : 'telegram.solve_after_waiting_success', { tasks }));
  }
  if (respectBlockers) {
    const blockers = await planBlockers();
    if (blockers.action === 'reject') {
      const missing = blockers.missing.map(entry => `${entry.url} (${entry.detail})`).join(', ');
      return { action: 'reject', reason: tr('telegram.solve_after_blockers_not_queued', { blockers: escape(missing), description: escape(blockers.description) }) };
    }
    if (blockers.action === 'wait') {
      const known = new Set(targets.map(target => target.item?.id || [...(target.names || [])].join('|')));
      for (const target of blockers.targets) {
        const id = target.item?.id || [...(target.names || [])].join('|');
        if (known.has(id)) continue;
        known.add(id);
        // A GitHub blocker must succeed, even for an `/enqueue` task.
        targets.push({ ...target, mode: DEPENDENCY_MODE.SUCCESS });
      }
      lines.push(tr('telegram.solve_after_waiting_blockers', { tasks: escape(blockers.targets.map(target => target.label).join(', ')), description: escape(blockers.description) }));
    } else if (blockers.note) notes.push(blockers.note);
  }
  if (targets.length === 0) return { action: 'start', notes };
  return { action: 'wait', targets, mode, waitingText: lines.join('\n') };
}
