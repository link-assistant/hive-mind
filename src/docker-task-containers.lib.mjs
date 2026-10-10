/**
 * Ground-truth view of the docker-isolated tasks running on the daemon the bot
 * launches into.
 *
 * Issue #2917: `/limits` showed `codex (pending: 0, processing: 0)` while four
 * docker-isolated `/codex` tasks were running, and dispatch throttling used the
 * same zero. Both sources the queue relied on were blind to them:
 *
 *   - `pgrep -x codex` runs in the bot container's PID namespace, and every
 *     docker-isolated AI CLI runs in a sibling container;
 *   - the tracked-session count only covers the bot's in-memory registry, and
 *     tasks resumed outside the bot (an operator `$ --resume <uuid>`) are never
 *     in it.
 *
 * `docker ps` is the one source that cannot miss a running task container, so
 * this module lists running containers and attributes each to a tool, URL and
 * session:
 *
 *   1. the `HIVE_MIND_TOOL` / `HIVE_MIND_TASK_URL` / `HIVE_MIND_PARENT_SESSION_ID`
 *      environment markers set at launch (see `buildTaskContainerMarkerEnv`).
 *      Labels were the first choice, but start-command (0.36.0) has no
 *      `--label` option. It does pass `-e` through, re-applies it on
 *      `$ --resume`, and `docker commit` bakes the env into the snapshot image,
 *      so the markers follow a task across resumes (verified by
 *      experiments/issue-2917-docker-task-containers.mjs);
 *   2. for containers started before the markers existed, the task command
 *      itself (`solve <url> --tool codex`; no `--tool` means claude) and the
 *      session-UUID container name start-command gives docker isolation
 *      (`<uuid>`, `<uuid>-resume-<n>` after a snapshot resume).
 *
 * Everything is injectable so the parsing and the fallbacks are unit-testable
 * without a docker daemon.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const HIVE_MIND_TOOL_ENV = 'HIVE_MIND_TOOL';
export const HIVE_MIND_TASK_URL_ENV = 'HIVE_MIND_TASK_URL';
export const HIVE_MIND_PARENT_SESSION_ENV = 'HIVE_MIND_PARENT_SESSION_ID';

export const DOCKER_TASK_CONTAINER_LIST_TIMEOUT_MS = 10000;
export const DOCKER_TASK_CONTAINER_CACHE_TTL_MS = 5000;

const SESSION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// start-command names a snapshot-resumed container `<previous>-resume-<n>`, so a
// second resume of a resumed task yields `<uuid>-resume-1-resume-2`.
const RESUME_SUFFIX_RE = /(?:-resume-\d+)+$/;
const TASK_COMMAND_RE = /(?:^|[\s'"/;&|(])(solve|hive|task|fix|review)(?:\.mjs)?['"]?(?=\s|$)/;
const TOOL_FLAG_RE = /(?:^|[\s'"])--tool['"]?(?:=|\s+)['"]?([A-Za-z0-9_.-]+)/;
const GITHUB_URL_RE = /https:\/\/github\.com\/[^\s'"]+/;

function cleanMarkerValue(value) {
  const text = String(value ?? '').trim();
  // A newline would corrupt the `-e NAME=value` argument and the container env.
  if (!text || /[\r\n\0]/.test(text)) return null;
  return text;
}

/**
 * Environment markers that let `docker ps` attribute a task container to its
 * tool and URL without the bot's memory (issue #2917).
 *
 * @param {{tool?: string, url?: string}} options
 * @returns {Object<string, string>}
 */
export function buildTaskContainerMarkerEnv({ tool = null, url = null } = {}) {
  const env = {};
  const cleanTool = cleanMarkerValue(tool);
  if (cleanTool) env[HIVE_MIND_TOOL_ENV] = cleanTool.toLowerCase();
  const cleanUrl = cleanMarkerValue(url);
  if (cleanUrl && /^https?:\/\//i.test(cleanUrl)) env[HIVE_MIND_TASK_URL_ENV] = cleanUrl;
  return env;
}

/**
 * The original session name of a (possibly snapshot-resumed) container.
 * @param {string} name
 * @returns {string}
 */
export function getRootSessionName(name) {
  return String(name || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(RESUME_SUFFIX_RE, '');
}

/**
 * Whether `candidate` is a snapshot-resume descendant of `sessionName`.
 * @param {string} candidate
 * @param {string} sessionName
 * @returns {boolean}
 */
export function isResumeDescendantName(candidate, sessionName) {
  if (!candidate || !sessionName) return false;
  const prefix = `${sessionName}-resume-`;
  return candidate.startsWith(prefix) && RESUME_SUFFIX_RE.test(candidate.slice(sessionName.length));
}

/**
 * @param {string[]|null|undefined} list - docker `Config.Env` (`NAME=value`)
 * @returns {Object<string, string>}
 */
export function parseContainerEnv(list) {
  const env = {};
  for (const entry of Array.isArray(list) ? list : []) {
    const text = String(entry);
    const eq = text.indexOf('=');
    if (eq <= 0) continue;
    env[text.slice(0, eq)] = text.slice(eq + 1);
  }
  return env;
}

/**
 * Infer the tool from a hive-mind task command line. `--tool <name>` wins; a
 * hive-mind command without it runs the default tool, claude.
 *
 * @param {string} command
 * @returns {string|null}
 */
export function detectTaskToolFromCommand(command) {
  const text = String(command || '');
  const flag = text.match(TOOL_FLAG_RE);
  if (flag) return flag[1].toLowerCase();
  return TASK_COMMAND_RE.test(text) ? 'claude' : null;
}

function containerCommandText(container) {
  const parts = [];
  if (container?.Path) parts.push(container.Path);
  if (Array.isArray(container?.Args)) parts.push(...container.Args);
  else if (Array.isArray(container?.Config?.Cmd)) parts.push(...container.Config.Cmd);
  return parts.join(' ');
}

/**
 * Turn `docker inspect` output into attributed, running task containers.
 * Containers that are neither marked by hive-mind nor named like a
 * start-command docker-isolation session are ignored, so sidecars and
 * unrelated host containers never count as tasks.
 *
 * @param {Array<object>} inspected - Parsed `docker inspect` JSON array
 * @returns {Array<{id: string|null, name: string, rootSessionName: string, parentSessionId: string|null, tool: string|null, toolSource: string|null, url: string|null, startedAt: string|null, image: string|null}>}
 */
export function parseTaskContainers(inspected) {
  const containers = [];
  for (const container of Array.isArray(inspected) ? inspected : []) {
    if (!container || container.State?.Running === false) continue;
    const name = String(container.Name || '').replace(/^\/+/, '');
    if (!name) continue;
    const env = parseContainerEnv(container.Config?.Env);
    const rootSessionName = getRootSessionName(name);
    const parentSessionId = cleanMarkerValue(env[HIVE_MIND_PARENT_SESSION_ENV]);
    const markedTool = cleanMarkerValue(env[HIVE_MIND_TOOL_ENV]);
    if (!parentSessionId && !markedTool && !SESSION_UUID_RE.test(rootSessionName)) continue;
    const command = containerCommandText(container);
    const commandTool = markedTool ? null : detectTaskToolFromCommand(command);
    // A UUID-named container whose command is not a hive-mind task (and that
    // carries no marker) belongs to someone else's start-command session.
    if (!parentSessionId && !markedTool && !commandTool) continue;
    containers.push({
      id: container.Id || null,
      name,
      rootSessionName,
      parentSessionId,
      tool: markedTool ? markedTool.toLowerCase() : commandTool,
      toolSource: markedTool ? 'env' : commandTool ? 'command' : null,
      url: cleanMarkerValue(env[HIVE_MIND_TASK_URL_ENV]) || command.match(GITHUB_URL_RE)?.[0]?.replace(/['"]+$/, '') || null,
      startedAt: container.State?.StartedAt || null,
      image: container.Config?.Image || null,
    });
  }
  return containers;
}

/**
 * List running, attributed task containers from the local docker daemon.
 * Never throws: an unavailable daemon reports `available: false` so callers
 * fall back to their previous sources instead of counting zero.
 *
 * @param {object} [options]
 * @param {Function} [options.execFileImpl] - promisified execFile replacement
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.verbose]
 * @returns {Promise<{available: boolean, containers: Array, error?: string}>}
 */
export async function listRunningTaskContainers({ execFileImpl = execFileAsync, timeoutMs = DOCKER_TASK_CONTAINER_LIST_TIMEOUT_MS, verbose = false } = {}) {
  try {
    const ps = await execFileImpl('docker', ['ps', '--quiet', '--no-trunc', '--filter', 'status=running'], { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    const ids = String(ps?.stdout || '')
      .split('\n')
      .map(id => id.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      if (verbose) console.log('[VERBOSE] docker-task-containers: no running containers');
      return { available: true, containers: [] };
    }
    const inspect = await execFileImpl('docker', ['inspect', ...ids], { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
    const containers = parseTaskContainers(JSON.parse(String(inspect?.stdout || '[]')));
    if (verbose) {
      const summary = containers.map(c => `${c.name}:${c.tool || 'unknown'}(${c.toolSource || 'none'})`).join(', ');
      console.log(`[VERBOSE] docker-task-containers: ${containers.length}/${ids.length} running container(s) are tasks${summary ? `: ${summary}` : ''}`);
    }
    return { available: true, containers };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] docker-task-containers: listing failed, falling back to tracked sessions: ${error?.message || error}`);
    return { available: false, containers: [], error: error?.message || String(error) };
  }
}

/**
 * Wrap a container lister with a short cache and in-flight de-duplication, so
 * every queue check and monitor tick within one window costs one `docker ps`.
 *
 * @param {object} [options]
 * @param {Function} [options.list] - lister ({verbose}) => result
 * @param {number} [options.ttlMs]
 * @param {Function} [options.now]
 * @returns {Function} (verbose) => Promise<result>
 */
export function createCachedTaskContainerSource({ list = listRunningTaskContainers, ttlMs = DOCKER_TASK_CONTAINER_CACHE_TTL_MS, now = Date.now } = {}) {
  let cached = null;
  let cachedAt = 0;
  let inFlight = null;
  const source = async (verbose = false) => {
    if (cached && now() - cachedAt < ttlMs) return cached;
    if (!inFlight) {
      inFlight = Promise.resolve(list({ verbose }))
        .then(result => {
          cached = result;
          cachedAt = now();
          return result;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };
  source.invalidate = () => {
    cached = null;
    cachedAt = 0;
  };
  return source;
}

export const getRunningTaskContainers = createCachedTaskContainerSource();

/**
 * Collect every name a tracked session can be known by, so a container can be
 * matched to it whichever attempt (original, resumed, recovered) is running.
 *
 * @param {Iterable<[string, object]>} entries - `[sessionName, sessionInfo]`
 * @returns {string[]}
 */
export function collectTrackedSessionIdentities(entries) {
  const identities = new Set();
  for (const [sessionName, sessionInfo] of entries) {
    for (const value of [sessionName, sessionInfo?.sessionId, sessionInfo?.rootSessionName, sessionInfo?.killRecoveryOfSession, sessionInfo?.killRecoverySessionId]) {
      if (!value) continue;
      identities.add(String(value));
      identities.add(getRootSessionName(value));
    }
  }
  return [...identities];
}

/**
 * Split containers into those a tracked session accounts for and the rest.
 *
 * @param {Array} containers
 * @param {Iterable<string>} identities - from collectTrackedSessionIdentities
 * @returns {{tracked: Array, untracked: Array}}
 */
export function partitionTaskContainers(containers, identities) {
  const known = new Set(identities || []);
  const tracked = [];
  const untracked = [];
  for (const container of containers || []) {
    const matched = known.has(container.name) || known.has(container.rootSessionName) || (container.parentSessionId && known.has(container.parentSessionId));
    (matched ? tracked : untracked).push(container);
  }
  return { tracked, untracked };
}

/**
 * Count containers per tool. Unattributed containers are counted under
 * `unknown` so they still weigh on host-resource throttling.
 *
 * @param {Array} containers
 * @returns {Object<string, number>}
 */
export function countTaskContainersByTool(containers) {
  const byTool = {};
  for (const container of containers || []) {
    const tool = container.tool || 'unknown';
    byTool[tool] = (byTool[tool] || 0) + 1;
  }
  return byTool;
}

/**
 * The newest running snapshot-resume descendant of a session's container —
 * proof the work continues even though the session's own container is gone.
 *
 * @param {string} sessionName
 * @param {Array} containers
 * @returns {object|null}
 */
export function findRunningResumeDescendant(sessionName, containers) {
  let best = null;
  for (const container of containers || []) {
    if (!isResumeDescendantName(container.name, sessionName)) continue;
    if (!best || container.name.length > best.name.length) best = container;
  }
  return best;
}
