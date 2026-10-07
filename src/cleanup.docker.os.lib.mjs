/** Docker discovery and deletion for hive-cleanup (issue #2629). */
import { execFileSync } from 'node:child_process';
import { dockerIsolationSessionId, isDockerIsolationSessionName, parseDockerContainerExitCode, planDockerIsolationCleanup } from './cleanup.lib.mjs';

// {{json .}} also requests Size on Docker versions with expensive snapshotters.
const PS_FORMAT = '{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Status}}\t{{.Image}}\t{{.CreatedAt}}';
const RESUME_IMAGE_RE = /^start-command-resume\/([0-9a-f-]+):(\d+)$/i;

function execDocker(cmd, args, options = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000, maxBuffer: 16 * 1024 * 1024, ...options }).trim();
}

function errorText(error) {
  return String(error.stderr || error.message || error).trim();
}

/** Parse explicit size-free rows, accepting JSON fixtures from older callers. */
export function parseDockerPsJsonLines(output) {
  const containers = [];
  const seen = new Set();
  for (const line of String(output || '').split('\n')) {
    if (!line.trim()) continue;
    let data;
    if (line.trimStart().startsWith('{')) {
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
    } else {
      const [ID, Names, State, Status, Image, CreatedAt] = line.split('\t');
      if (!Names || !State) throw new Error('Invalid docker ps output: expected six tab-separated fields');
      data = { ID, Names, State, Status, Image, CreatedAt };
    }
    const state = String(data.State || data.state || '')
      .trim()
      .toLowerCase();
    const status = String(data.Status || data.status || '').trim();
    const names = String(data.Names || data.Name || data.names || data.name || '').split(',');
    for (const rawName of names) {
      const name = rawName.trim().replace(/^\//, '');
      if (!isDockerIsolationSessionName(name) || seen.has(name)) continue;
      seen.add(name);
      containers.push({ id: data.ID || data.Id || data.id || null, name, image: data.Image || data.image || null, createdAt: data.CreatedAt || null, state, status, exitCode: parseDockerContainerExitCode(status), running: ['running', 'paused', 'restarting'].includes(state) || /^Up\b/i.test(status) });
    }
  }
  return containers;
}

/** A missing CLI is optional; an installed Docker CLI's daemon failure is fatal. */
export function listDockerIsolationContainers({ execFn = execDocker, logFn = () => {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return parseDockerPsJsonLines(execFn('docker', ['ps', '-a', '--no-trunc', '--format', PS_FORMAT]));
    } catch (error) {
      if (error.code === 'ENOENT') {
        logFn('Docker CLI unavailable; skipping container discovery');
        return [];
      }
      lastError = error;
      logFn(`docker ps attempt ${attempt}/3 failed: ${errorText(error)}`);
    }
  }
  throw new Error(`⚠️ docker ps failed: ${errorText(lastError)}`, { cause: lastError });
}

/** Sizes are optional and have a shared finite budget, separate from discovery. */
export function collectDockerContainerMetadata(containers, { execFn = execDocker, logFn = () => {}, sizeBudgetMs = 10000 } = {}) {
  const metadataDeadline = Date.now() + 5000;
  for (const container of containers) {
    const target = container.id || container.name;
    container.size = null;
    try {
      const remainingMetadata = metadataDeadline - Date.now();
      if (remainingMetadata <= 0) throw new Error('metadata budget exhausted');
      const state = JSON.parse(execFn('docker', ['inspect', '--format', '{{json .State}}', target], { timeout: Math.min(1500, remainingMetadata) }));
      container.finishedAt = state.FinishedAt || null;
      container.running = state.Running === true || state.Restarting === true || state.Paused === true || Number(state.Pid) > 0;
      container.state = state.Status || container.state;
      if (container.state === 'exited') container.exitCode = state.ExitCode ?? container.exitCode;
    } catch (error) {
      logFn(`Container metadata unavailable for ${container.name}: ${errorText(error)}`);
    }
  }
  const deadline = Date.now() + sizeBudgetMs;
  for (const container of containers) {
    const target = container.id || container.name;
    const remaining = deadline - Date.now();
    if (remaining <= 0) continue;
    try {
      const output = execFn('docker', ['inspect', '--size', '--format', '{{.SizeRw}}', target], { timeout: Math.min(1500, remaining) });
      const size = /^\d+$/.test(output) ? Number(output) : NaN;
      if (Number.isFinite(size) && size >= 0) container.size = size;
    } catch (error) {
      logFn(`Container size unavailable for ${container.name}: ${errorText(error)}`);
    }
  }
  return containers;
}

/** List resume images even when their original containers have disappeared. */
export function listDockerResumeImages({ execFn = execDocker } = {}) {
  let output;
  try {
    output = execFn('docker', ['image', 'ls', '--no-trunc', '--format', '{{json .}}']);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`docker image ls failed: ${errorText(error)}`, { cause: error });
  }
  const images = [];
  for (const line of output.split('\n').filter(Boolean)) {
    const data = JSON.parse(line);
    const name = `${data.Repository}:${data.Tag}`;
    const match = RESUME_IMAGE_RE.exec(name);
    if (!match || !isDockerIsolationSessionName(match[1]) || dockerIsolationSessionId(match[1]) !== match[1]) continue;
    images.push({ name, id: data.ID, sessionId: match[1], attempt: match[2], createdAt: data.CreatedAt, size: null });
  }
  return images;
}

function parseDockerBytes(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(B|kB|MB|GB|TB)$/i.exec(value);
  return match ? Math.round(Number(match[1]) * 1000 ** ['b', 'kb', 'mb', 'gb', 'tb'].indexOf(match[2].toLowerCase())) : null;
}

/** Docker's verbose table exposes unique image bytes; virtual Size does not. */
export function collectDockerResumeImageSizes(images, { execFn = execDocker, logFn = () => {} } = {}) {
  if (!images.length) return images;
  try {
    const output = execFn('docker', ['system', 'df', '-v'], { timeout: 20000 });
    for (const line of output.split('\n')) {
      const columns = line.trim().split(/\s{2,}/);
      if (columns.length < 8) continue;
      const image = images.find(item => item.name === `${columns[0]}:${columns[1]}`);
      if (image) image.size = parseDockerBytes(columns[6]);
    }
  } catch (error) {
    logFn(`Resume image unique sizes unavailable: ${errorText(error)}`);
  }
  return images;
}

/**
 * Recheck immediately, then let Docker refuse a restart racing with removal.
 * An immutable ID prevents a name reused by a new task from being removed.
 */
export function removeDockerContainer(containerName, { id = null, mode = 'all', now = Date.now(), execFn = execDocker, logFn = () => {} } = {}) {
  if (!isDockerIsolationSessionName(containerName) || (id && !/^[0-9a-f]{12,64}$/i.test(id))) return false;
  const target = id || containerName;
  try {
    const state = execFn('docker', ['inspect', '--format', '{{.State.Running}} {{.State.Restarting}} {{.State.Pid}} {{.State.Status}} {{.State.ExitCode}} {{.State.FinishedAt}}', target]);
    const match = /^false false 0 (exited|dead)(?: (-?\d+) (\S+))?$/.exec(state);
    if (!match) {
      logFn(`Kept ${containerName}: container is active or state is unknown (${state})`);
      return false;
    }
    const current = { name: containerName, state: match[1], exitCode: match[2] === undefined ? null : Number(match[2]), finishedAt: match[3] || null };
    if (!planDockerIsolationCleanup({ containers: [current], mode, now }).remove.length) {
      logFn(`Kept ${containerName}: current outcome or finish time is outside cleanup policy`);
      return false;
    }
    execFn('docker', ['rm', target]);
    return true;
  } catch (error) {
    logFn(`Kept ${containerName}: ${errorText(error)}`);
    return false;
  }
}

/** Never force image deletion; Docker checks reference races at removal too. */
export function removeDockerResumeImage(image, { execFn = execDocker, logFn = () => {} } = {}) {
  const match = RESUME_IMAGE_RE.exec(image?.name || '');
  if (!match || dockerIsolationSessionId(match[1]) !== match[1] || !/^sha256:[0-9a-f]{64}$/i.test(image?.id || '')) return false;
  try {
    const users = execFn('docker', ['ps', '-a', '--filter', `ancestor=${image.id}`, '--format', '{{.ID}}']);
    if (users.trim()) {
      logFn(`Kept ${image.name}: image still used by a container`);
      return false;
    }
    // Compare the tag immediately before removal, so a retagged image is kept.
    const id = execFn('docker', ['image', 'inspect', '--format', '{{.Id}}', image.name]);
    if (id !== image.id) {
      logFn(`Kept ${image.name}: image identity changed`);
      return false;
    }
    execFn('docker', ['image', 'rm', image.id]);
    return true;
  } catch (error) {
    logFn(`Kept ${image.name}: ${errorText(error)}`);
    return false;
  }
}
