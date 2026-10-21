/**
 * Running task containers on the Docker daemon the bot launches into
 * (issue #2917).
 *
 * The per-tool `processing` count used by `/limits` and by the dispatch
 * throttling must come from what is actually running, not from what this bot
 * process remembers. One `docker ps` call lists every running container with
 * the `hive-mind.*` labels set at launch and the `start-command.*` labels
 * start-command adds itself. Containers launched before the labels existed are
 * recognised by their session-UUID name and attributed through the matching
 * `$ --list` record. Each container is then marked tracked or untracked against
 * the bot's session registry.
 *
 * Nothing here throws: a missing `docker` binary or daemon yields `null`, and
 * the queue keeps its other sources.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { execFile } from 'node:child_process';
import { START_COMMAND_LABELS, TASK_CONTAINER_LABELS } from './task-container-labels.lib.mjs';

const FIELDS = [
  ['name', '{{.Names}}'],
  ['createdAt', '{{.CreatedAt}}'],
  ['tool', `{{.Label "${TASK_CONTAINER_LABELS.tool}"}}`],
  ['command', `{{.Label "${TASK_CONTAINER_LABELS.command}"}}`],
  ['url', `{{.Label "${TASK_CONTAINER_LABELS.url}"}}`],
  ['session', `{{.Label "${TASK_CONTAINER_LABELS.session}"}}`],
  ['instance', `{{.Label "${TASK_CONTAINER_LABELS.instance}"}}`],
  ['scSession', `{{.Label "${START_COMMAND_LABELS.session}"}}`],
  ['scRootSession', `{{.Label "${START_COMMAND_LABELS.rootSession}"}}`],
  ['scUuid', `{{.Label "${START_COMMAND_LABELS.uuid}"}}`],
];
export const DOCKER_PS_FORMAT = FIELDS.map(([, template]) => template).join('\t');
const DOCKER_PS_TIMEOUT_MS = 10000;
const DEFAULT_TTL_MS = 15000;
const TASK_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-resume-\d+)?$/i;
const RESUME_SUFFIX = /-resume-\d+$/;

/** Whether a container name has the shape of a start-command task (`<uuid>` or `<uuid>-resume-<n>`). */
export function isTaskContainerName(name) {
  return TASK_NAME_PATTERN.test(String(name || ''));
}

function rootOf(name) {
  return name ? String(name).replace(RESUME_SUFFIX, '') : null;
}

/**
 * Docker prints `2026-10-09 14:32:01 +0000 UTC`.
 * @param {string} value
 * @returns {number|null} Epoch milliseconds.
 */
export function parseDockerCreatedAt(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})/);
  if (match) {
    const ms = Date.parse(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {string} stdout - `docker ps --format DOCKER_PS_FORMAT` output.
 * @returns {Array<Object>}
 */
export function parseDockerPsOutput(stdout) {
  const containers = [];
  for (const line of String(stdout || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const record = {};
    FIELDS.forEach(([key], index) => {
      const value = (parts[index] || '').trim();
      record[key] = value && value !== '<no value>' ? value : null;
    });
    if (!record.name) continue;
    record.createdAtMs = parseDockerCreatedAt(record.createdAt);
    containers.push(record);
  }
  return containers;
}

function parseToolFromCommand(command) {
  const match = String(command || '').match(/['"]?--tool['"]?\s+['"]?([a-z0-9_-]+)/i) || String(command || '').match(/--tool=([a-z0-9_-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

function parseUrlFromCommand(command) {
  const match = String(command || '').match(/https?:\/\/[^\s'"]+/);
  return match ? match[0] : null;
}

// A `$ --list` record of a hive-mind task: `solve`/`hive` (path or not), not any `$ --isolated docker` run.
function isTaskCommand(command) {
  return /(^|[\s/'"])(solve|hive)(\s|$)/.test(String(command || ''));
}

function containerIds(container) {
  return [container.name, rootOf(container.name), container.session, container.scSession, container.scRootSession, container.scUuid].filter(Boolean);
}

function findSessionRecord(container, records) {
  const ids = new Set(containerIds(container));
  return (records || []).find(record => [record?.sessionName, rootOf(record?.sessionName), record?.uuid].some(id => id && ids.has(id))) || null;
}

function findTrackedIdentity(container, identities) {
  const ids = new Set(containerIds(container));
  return (identities || []).find(identity => (identity?.ids || []).some(id => id && ids.has(id))) || null;
}

/**
 * Attribute each running container to a tool and to a tracked session.
 * Containers that are neither labelled nor recognisable as a task are dropped.
 *
 * @param {Object} options
 * @param {Array<Object>} options.containers - From {@link parseDockerPsOutput}.
 * @param {Array<Object>} [options.sessionRecords] - `$ --list` records.
 * @param {Array<{sessionName: string, tool?: string, url?: string, ids: string[]}>} [options.trackedIdentities]
 * @returns {Array<Object>}
 */
export function attributeTaskContainers({ containers = [], sessionRecords = [], trackedIdentities = [] } = {}) {
  const attributed = [];
  for (const container of containers) {
    const labelled = Boolean(container.tool);
    const tracked = findTrackedIdentity(container, trackedIdentities);
    if (!labelled && !isTaskContainerName(container.name) && !tracked) continue;
    const listed = labelled ? null : findSessionRecord(container, sessionRecords);
    // An unlabelled, untracked container counts only when `$ --list` says it runs a task.
    const record = listed && (tracked || isTaskCommand(listed.command)) ? listed : null;
    if (!labelled && !tracked && !record) continue;
    const tool = container.tool || tracked?.tool || parseToolFromCommand(record?.command) || (record || tracked ? 'claude' : null);
    if (!tool) continue;
    attributed.push({
      ...container,
      tool,
      url: container.url || tracked?.url || parseUrlFromCommand(record?.command) || null,
      command: container.command || (record ? 'solve' : null),
      source: labelled ? 'label' : tracked ? 'tracked' : 'session-list',
      tracked: Boolean(tracked),
      trackedSessionName: tracked?.sessionName || null,
      executionUuid: container.scUuid || record?.uuid || null,
    });
  }
  return attributed;
}

/**
 * @param {Array<Object>} attributed - From {@link attributeTaskContainers}.
 * @returns {{byTool: Object, untrackedByTool: Object, total: number, untrackedTotal: number}}
 */
export function summarizeTaskContainers(attributed = []) {
  const byTool = {};
  const untrackedByTool = {};
  for (const container of attributed) {
    byTool[container.tool] = (byTool[container.tool] || 0) + 1;
    if (!container.tracked) untrackedByTool[container.tool] = (untrackedByTool[container.tool] || 0) + 1;
  }
  const sum = counts => Object.values(counts).reduce((total, count) => total + count, 0);
  return { byTool, untrackedByTool, total: sum(byTool), untrackedTotal: sum(untrackedByTool) };
}

function defaultRun(args, { timeout = DOCKER_PS_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile('docker', args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout || ''))));
  });
}

/**
 * Every running container with the fields of {@link DOCKER_PS_FORMAT}.
 * @param {Object} [options]
 * @param {Function} [options.run] - `(args) => Promise<stdout>`, for tests.
 * @param {boolean} [options.verbose]
 * @returns {Promise<Array<Object>|null>} `null` when docker cannot be asked.
 */
export async function listRunningContainers({ run = defaultRun, verbose = false } = {}) {
  try {
    return parseDockerPsOutput(await run(['ps', '--format', DOCKER_PS_FORMAT]));
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] task-containers: docker ps failed: ${error?.message || error}`);
    return null;
  }
}

/**
 * The ids a tracked session can appear under on a container: its session name,
 * start-command execution UUID, container name and root session.
 * @param {Array<{sessionName: string, sessionInfo: Object}>} entries - listTrackedSessionEntries()
 * @returns {Array<{sessionName: string, tool: string|null, url: string|null, ids: string[]}>}
 */
export function toTrackedIdentities(entries = []) {
  return (entries || []).map(({ sessionName, sessionInfo = {} }) => ({
    sessionName,
    tool: sessionInfo?.tool || null,
    url: sessionInfo?.url || null,
    ids: [sessionName, sessionInfo?.sessionId, sessionInfo?.containerName, sessionInfo?.executionUuid, sessionInfo?.rootSessionName].filter(Boolean),
  }));
}

async function defaultTrackedIdentities() {
  const { listTrackedSessionEntries } = await import('./session-monitor.lib.mjs');
  return toTrackedIdentities(listTrackedSessionEntries());
}

const source = {
  enabled: false,
  backend: null,
  run: defaultRun,
  listSessions: null,
  listTrackedIdentities: defaultTrackedIdentities,
  ttlMs: DEFAULT_TTL_MS,
  now: Date.now,
  cache: null,
  inFlight: null,
};

/**
 * Turn the container source on (the Telegram bot does this at startup; tests
 * and other processes leave it off, so the queue keeps its other sources).
 * @param {Object} options
 * @param {boolean} [options.enabled]
 * @param {string|null} [options.backend] - The bot's isolation backend. Under `docker` the host `pgrep` count is not used.
 * @param {Function} [options.run]
 * @param {Function} [options.listSessions] - `$ --list` records, for containers without labels.
 * @param {Function} [options.listTrackedIdentities]
 * @param {number} [options.ttlMs]
 * @param {Function} [options.now]
 */
export function configureTaskContainerSource(options = {}) {
  for (const key of ['enabled', 'backend', 'run', 'listSessions', 'listTrackedIdentities', 'ttlMs', 'now']) {
    if (options[key] !== undefined) source[key] = options[key];
  }
  if (options.run === null) source.run = defaultRun;
  if (options.listTrackedIdentities === null) source.listTrackedIdentities = defaultTrackedIdentities;
  source.cache = null;
}

/** Drop the cached snapshot (after an adoption changed what is tracked). */
export function invalidateTaskContainerSnapshot() {
  source.cache = null;
}

async function collectSnapshot(verbose) {
  const containers = await listRunningContainers({ run: source.run, verbose });
  if (!containers) return null;
  const needsRecords = containers.some(container => !container.tool && isTaskContainerName(container.name));
  const sessionRecords = needsRecords && typeof source.listSessions === 'function' ? await Promise.resolve(source.listSessions(verbose)).catch(() => []) : [];
  const trackedIdentities = await Promise.resolve()
    .then(() => source.listTrackedIdentities())
    .catch(() => []);
  const attributed = attributeTaskContainers({ containers, sessionRecords, trackedIdentities });
  return { ...summarizeTaskContainers(attributed), containers: attributed, ignoreProcessCounts: source.backend === 'docker', observedAt: source.now() };
}

/**
 * The running task containers per tool, or `null` when the source is off or
 * docker cannot be asked. Results are cached for `ttlMs`, because the queue
 * consumer asks on every poll.
 * @param {boolean} [verbose]
 * @param {{fresh?: boolean}} [options]
 * @returns {Promise<Object|null>}
 */
export async function getTaskContainerSnapshot(verbose = false, { fresh = false } = {}) {
  if (!source.enabled) return null;
  if (!fresh && source.cache && source.now() - source.cache.at < source.ttlMs) return source.cache.value;
  if (!source.inFlight) {
    source.inFlight = collectSnapshot(verbose)
      .catch(() => null)
      .then(value => {
        source.cache = { at: source.now(), value };
        return value;
      })
      .finally(() => {
        source.inFlight = null;
      });
  }
  return source.inFlight;
}

/**
 * Fold the container counts into the queue's processing snapshot. Per tool the
 * count is the largest of: host processes (not under docker isolation, where
 * the AI CLI runs in a sibling container), tracked sessions `$ --status`
 * reports as executing, and running task containers. A container counts even
 * when `$ --status` says `executed` or the bot never tracked it.
 *
 * @param {Object} snapshot - `getExternalProcessingSnapshot` result without containers.
 * @param {Object|null} containers - {@link getTaskContainerSnapshot} result.
 * @param {string[]} tools
 * @returns {Object} The snapshot with `containerByTool` and `untrackedByTool`.
 */
export function mergeTaskContainerCounts(snapshot, containers, tools = Object.keys(snapshot.byTool || {})) {
  if (!containers) return { ...snapshot, containerByTool: {}, untrackedByTool: {} };
  const ignoreProcess = containers.ignoreProcessCounts === true;
  const byTool = {};
  for (const tool of new Set([...tools, ...Object.keys(containers.byTool || {})])) {
    const processCount = ignoreProcess ? 0 : snapshot.processByTool?.[tool] || 0;
    byTool[tool] = Math.max(processCount, snapshot.isolatedByTool?.[tool] || 0, containers.byTool?.[tool] || 0);
  }
  const processTotal = ignoreProcess ? 0 : snapshot.processTotal || 0;
  const toolTotal = Object.values(byTool).reduce((sum, count) => sum + count, 0);
  return {
    ...snapshot,
    byTool,
    total: Math.max(processTotal, snapshot.isolatedTotal || 0, containers.total || 0, toolTotal),
    containerByTool: { ...(containers.byTool || {}) },
    untrackedByTool: { ...(containers.untrackedByTool || {}) },
    containerTotal: containers.total || 0,
    untrackedTotal: containers.untrackedTotal || 0,
  };
}
