/**
 * Docker labels that attribute a task container to the bot that launched it
 * (issue #2917).
 *
 * `/limits` and the dispatch throttling count running tasks per tool. Under
 * `--isolation docker` the AI CLI runs in a sibling container, so `pgrep` in the
 * bot container never sees it, and the in-memory session map only knows tasks
 * this bot process launched. Labels on the container are ground truth that
 * survives a bot restart: `docker ps --filter label=hive-mind.tool` lists every
 * running task with its tool, URL and session, tracked or not.
 *
 * `start-command.*` keys are reserved by start-command, which adds
 * `start-command.session`, `start-command.root-session`, `start-command.uuid`
 * and `start-command.resume-count` itself and re-applies every label when it
 * resumes a container from a snapshot.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import os from 'node:os';

export const TASK_CONTAINER_LABELS = Object.freeze({
  tool: 'hive-mind.tool',
  command: 'hive-mind.command',
  url: 'hive-mind.url',
  session: 'hive-mind.session',
  instance: 'hive-mind.instance',
});

/** Labels start-command sets on every container it launches. */
export const START_COMMAND_LABELS = Object.freeze({
  session: 'start-command.session',
  rootSession: 'start-command.root-session',
  uuid: 'start-command.uuid',
});

export const BOT_INSTANCE_ID_ENV = 'HIVE_MIND_INSTANCE_ID';

const MAX_LABEL_VALUE_LENGTH = 512;

/**
 * The first issue/pull request URL in the task arguments.
 * @param {string[]} args
 * @returns {string|null}
 */
export function extractTaskUrl(args) {
  if (!Array.isArray(args)) return null;
  const url = args.find(arg => typeof arg === 'string' && /^https?:\/\//i.test(arg.trim()));
  return url ? url.trim() : null;
}

/**
 * A label value docker and start-command both accept: one line, bounded.
 * @param {*} value
 * @returns {string}
 */
export function sanitizeLabelValue(value) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_VALUE_LENGTH);
}

/**
 * The id of this bot instance. Set `HIVE_MIND_INSTANCE_ID` when several bots
 * share one Docker daemon; otherwise the host name of the bot container is used.
 * @param {Object} [env]
 * @param {Function} [hostname]
 * @returns {string}
 */
export function resolveBotInstanceId(env = process.env, hostname = os.hostname) {
  const explicit = sanitizeLabelValue(env?.[BOT_INSTANCE_ID_ENV]);
  if (explicit) return explicit;
  try {
    return sanitizeLabelValue(hostname()) || 'hive-mind';
  } catch {
    return 'hive-mind';
  }
}

/**
 * Whether the operator named this instance, which makes the instance label a
 * reliable owner check (several bots on one daemon).
 * @param {Object} [env]
 * @returns {boolean}
 */
export function hasExplicitBotInstanceId(env = process.env) {
  return Boolean(sanitizeLabelValue(env?.[BOT_INSTANCE_ID_ENV]));
}

/**
 * @param {Object} options
 * @param {string} [options.tool]
 * @param {string} [options.command]
 * @param {string[]} [options.args]
 * @param {string|null} [options.url] - Defaults to the first URL in `args`.
 * @param {string|null} [options.sessionId]
 * @param {string|null} [options.instanceId]
 * @param {Object} [options.env]
 * @returns {Object<string,string>} Label key to value, empty values left out.
 */
export function buildTaskContainerLabels({ tool = 'claude', command = 'solve', args = [], url = null, sessionId = null, instanceId = null, env = process.env } = {}) {
  const values = {
    [TASK_CONTAINER_LABELS.tool]: tool || 'claude',
    [TASK_CONTAINER_LABELS.command]: command ? String(command).split('/').pop() : '',
    [TASK_CONTAINER_LABELS.url]: url || extractTaskUrl(args) || '',
    [TASK_CONTAINER_LABELS.session]: sessionId || '',
    [TASK_CONTAINER_LABELS.instance]: instanceId || resolveBotInstanceId(env),
  };
  const labels = {};
  for (const [key, value] of Object.entries(values)) {
    const clean = sanitizeLabelValue(value);
    if (clean) labels[key] = clean;
  }
  return labels;
}

/**
 * The `$ --label KEY=VALUE` arguments for a docker task launch.
 * @param {Object} options - See {@link buildTaskContainerLabels}.
 * @returns {string[]}
 */
export function buildTaskContainerLabelArgs(options = {}) {
  return Object.entries(buildTaskContainerLabels(options)).flatMap(([key, value]) => ['--label', `${key}=${value}`]);
}
