/**
 * Which Docker container a tracked session runs in (issue #3532).
 *
 * A tracked session carries up to three identifiers:
 *
 * - its tracking key / `sessionName` — the name the bot launched it with;
 * - `sessionId` — normally the same name, which start-command also gives the
 *   container; after an in-place recovery it is whatever `$ --resume` reported,
 *   which for `docker-start` is start-command's *execution UUID*;
 * - `executionUuid` — start-command's own id, which `$ --status` resolves, but
 *   which is never a container name.
 *
 * In #3532 the recovery session of a `docker-start` resume was tracked as
 * `sessionId = <execution UUID>`, so `docker inspect <execution UUID>` reported
 * "no such container" for a container that was running fine. Two minutes later
 * the monitor declared it dead and launched a second, concurrent solve for the
 * same pull request. Every liveness probe therefore asks this module for the
 * container name instead of reusing `sessionId`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3532
 * @see https://github.com/link-assistant/hive-mind/issues/3530
 */

/** `docker-snapshot` names a resumed container `<root>-resume-<n>` (start-command). */
const RESUME_SUFFIX_PATTERN = /-resume-\d+$/;

/**
 * The name of the container (or screen/tmux session) that backs a tracked
 * session. `containerName` wins because it is the only field recorded *as* a
 * container name; `sessionId` and the tracking key are fallbacks for sessions
 * tracked before #3532 (they were the container name for every original
 * launch).
 *
 * @param {string|null} sessionName - Tracking key
 * @param {Object|null} sessionInfo - Tracked session info
 * @returns {string|null}
 */
export function resolveSessionContainerName(sessionName, sessionInfo) {
  return sessionInfo?.containerName || sessionInfo?.sessionId || sessionName || null;
}

/**
 * The container every attempt of this task descends from: the original
 * launch's container, without any `-resume-<n>` suffix.
 *
 * @param {string|null} sessionName
 * @param {Object|null} sessionInfo
 * @returns {string|null}
 */
export function resolveSessionContainerRoot(sessionName, sessionInfo) {
  const explicit = sessionInfo?.rootContainerName || null;
  if (explicit) return explicit;
  const name = resolveSessionContainerName(sessionName, sessionInfo);
  return name ? name.replace(RESUME_SUFFIX_PATTERN, '') : null;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether a container name belongs to the family of `root`: the root itself or
 * one of its `-resume-<n>` successors.
 *
 * @param {string} name
 * @param {string} root
 * @returns {boolean}
 */
export function isContainerFamilyMember(name, root) {
  if (!name || !root) return false;
  const clean = String(name).replace(/^\//, '');
  return new RegExp(`^${escapeRegExp(root)}(?:-resume-\\d+)?$`).test(clean);
}

/**
 * Parse `docker ps --format '{{.Names}}'` output and keep only the family of
 * `root`. Docker's `name` filter is a substring match, so the exact match is
 * done here.
 *
 * @param {string} output
 * @param {string} root
 * @returns {string[]}
 */
export function parseRunningContainerFamily(output, root) {
  return String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => line.split(','))
    .filter(name => isContainerFamilyMember(name, root));
}

/**
 * Probe whether a tracked session's backend is still alive, using the right
 * name, and — for Docker — whether any container of the task's family still
 * runs. A missing *named* container must never outvote a running sibling: that
 * is exactly how #3532 started a second solve beside a healthy one.
 *
 * Returns the probe's tri-state answer: `true` alive, `false` gone, `null`
 * unknown.
 *
 * @param {string} sessionName
 * @param {Object} sessionInfo
 * @param {Object} context
 * @param {Function|null} context.probe - `(name, backend, verbose) => Promise<boolean|null>`
 * @param {Object|null} [context.runner] - Isolation runner (for `findRunningDockerContainerFamily`)
 * @param {string|null} [context.backend] - Overrides `sessionInfo.isolationBackend`
 * @param {boolean} [context.verbose]
 * @returns {Promise<boolean|null>}
 */
export async function probeSessionBackendAlive(sessionName, sessionInfo, { probe = null, runner = null, backend = null, verbose = false } = {}) {
  const kind = backend || sessionInfo?.isolationBackend || null;
  if (!probe || !kind) return null;
  const name = resolveSessionContainerName(sessionName, sessionInfo);
  const alive = await probe(name, kind, verbose);
  if (alive !== false || kind !== 'docker') return alive;
  const family = await findRunningSessionContainers(sessionName, sessionInfo, { runner, verbose });
  if (family.length > 0) {
    console.log(`[session-monitor] Session ${sessionName}: container ${name} is not running, but ${family.join(', ')} of the same task is; treating the session as alive (issue #3532)`);
    return true;
  }
  return false;
}

/**
 * Running containers of the task's family, or `[]` when none run or the runner
 * cannot list them. `includeHistory` also covers the containers of earlier
 * attempts: the pre-launch guard needs that, while a liveness probe asks only
 * about the current container's family.
 *
 * @param {string} sessionName
 * @param {Object} sessionInfo
 * @param {{runner?: Object|null, includeHistory?: boolean, verbose?: boolean}} [context]
 * @returns {Promise<string[]>}
 */
export async function findRunningSessionContainers(sessionName, sessionInfo, { runner = null, includeHistory = false, verbose = false } = {}) {
  if (typeof runner?.findRunningDockerContainerFamily !== 'function') return [];
  const running = [];
  const roots = includeHistory ? collectSessionContainerRoots(sessionName, sessionInfo) : [resolveSessionContainerRoot(sessionName, sessionInfo)].filter(Boolean);
  for (const root of roots) {
    try {
      const names = await runner.findRunningDockerContainerFamily(root, { verbose });
      for (const name of Array.isArray(names) ? names : []) if (!running.includes(name)) running.push(name);
    } catch (error) {
      if (verbose) console.log(`[VERBOSE] Could not list the running containers of ${root}: ${error?.message || error}`);
    }
  }
  return running;
}

/**
 * Every container root this task has used: the current one plus those of the
 * earlier attempts (a fresh recovery runs in a container with a new name).
 *
 * @param {string|null} sessionName
 * @param {Object|null} sessionInfo
 * @returns {string[]}
 */
export function collectSessionContainerRoots(sessionName, sessionInfo) {
  const roots = [];
  const add = name => {
    const root = name ? String(name).replace(RESUME_SUFFIX_PATTERN, '') : null;
    if (root && !roots.includes(root)) roots.push(root);
  };
  add(resolveSessionContainerRoot(sessionName, sessionInfo));
  for (const name of Array.isArray(sessionInfo?.containerNameHistory) ? sessionInfo.containerNameHistory : []) add(name);
  return roots;
}

/**
 * The container-name history a recovery session inherits: every earlier
 * container of the task plus the killed session's own (issue #3532).
 *
 * @param {string|null} sessionName
 * @param {Object|null} sessionInfo
 * @returns {string[]}
 */
export function nextContainerNameHistory(sessionName, sessionInfo) {
  const history = Array.isArray(sessionInfo?.containerNameHistory) ? sessionInfo.containerNameHistory.filter(Boolean) : [];
  const current = resolveSessionContainerName(sessionName, sessionInfo);
  if (current && !history.includes(current)) history.push(current);
  return history;
}
