/**
 * Mechanics shared by every on-demand Docker sidecar Hive Mind runs.
 *
 * The Formal AI sidecar (issue #2146) and the router sidecar (issue #2164) are
 * different services with different reasons to exist, but their *mechanics* are
 * the same problem solved twice: one container shared by concurrent tasks, a
 * lease per task, a durable JSON record that is only ever a cache of what
 * Docker actually reports, and an exclusive lock so a launch and an update can
 * never interleave.
 *
 * Those mechanics live here so the two lifecycles stay in step — a fix to lease
 * reconciliation or to the network guard applies to both — and so each sidecar
 * module is left holding only the part that is genuinely its own: which image,
 * which mounts, which readiness check, and what the task is handed.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { resolveBotStateDir } from './session-store.lib.mjs';

const execFileAsync = promisify(execFile);

export const DEFAULT_DOCKER_TIMEOUT_MS = 120_000;
// Pulling a sidecar image is the one Docker call that legitimately takes many
// minutes, so it gets its own budget instead of the general command timeout.
export const DEFAULT_IMAGE_TIMEOUT_MS = 600_000;

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Run `docker …` and return trimmed stdout. Throws on a non-zero exit. */
export const dockerText = async (run, args, { timeoutMs = DEFAULT_DOCKER_TIMEOUT_MS } = {}) => {
  const result = await run('docker', args, { encoding: 'utf8', timeout: timeoutMs });
  return String(result?.stdout ?? '').trim();
};

/** Run `docker …` for its effect only, reporting success as a boolean. */
export const dockerOk = async (run, args, options) => {
  try {
    await dockerText(run, args, options);
    return true;
  } catch {
    return false;
  }
};

/** The message a failed `docker` invocation should be reported with. */
export const dockerErrorMessage = error => error?.stderr?.toString?.().trim() || error?.message || String(error);

/**
 * Inspect a container without treating "absent" as an error.
 *
 * @returns {Promise<{exists: boolean, running: boolean, image: string|null, imageDigest: string|null}>}
 */
export const inspectDockerContainer = async (name, { run = execFileAsync, timeoutMs } = {}) => {
  try {
    const raw = await dockerText(run, ['inspect', name, '--format', '{{.State.Running}}|{{.Config.Image}}|{{.Image}}'], { timeoutMs });
    const [running, image, imageDigest] = raw.split('|');
    return { exists: true, running: running === 'true', image: image || null, imageDigest: imageDigest || null };
  } catch {
    return { exists: false, running: false, image: null, imageDigest: null };
  }
};

/** Resolve the local content digest of an image reference, or null when it is absent. */
export const readDockerImageDigest = async (image, { run = execFileAsync, timeoutMs } = {}) => {
  try {
    return (await dockerText(run, ['image', 'inspect', image, '--format', '{{.Id}}'], { timeoutMs })) || null;
  } catch {
    return null;
  }
};

/** A container's IPv4 address on one named network, or null when it has none. */
export const readDockerContainerAddress = async (containerName, network, { run = execFileAsync, timeoutMs } = {}) => {
  try {
    return (await dockerText(run, ['inspect', containerName, '--format', `{{with index .NetworkSettings.Networks "${network}"}}{{.IPAddress}}{{end}}`], { timeoutMs })) || null;
  } catch {
    return null;
  }
};

/**
 * Create the private network a sidecar and its tasks share.
 *
 * `--internal` is the security requirement: the sidecar endpoint must not be
 * published to the host and must not be reachable from any other network. An
 * existing network that is *not* internal is a stale artifact from an older
 * deployment and is replaced — but only while nothing is attached to it, since
 * removing a network out from under a running container would break it.
 */
export const ensureInternalDockerNetwork = async ({ name, label, run = execFileAsync, timeoutMs, log = null, verbose = false, logPrefix = 'docker-sidecar' } = {}) => {
  // `null` means "absent", which is different from "present but not internal".
  let internal = null;
  let containers = 0;
  try {
    const raw = await dockerText(run, ['network', 'inspect', name, '--format', '{{.Internal}}|{{len .Containers}}'], { timeoutMs });
    const [internalFlag, containerCount] = raw.split('|');
    internal = internalFlag === 'true';
    containers = Number(containerCount) || 0;
  } catch {
    // Absent; fall through to creation.
  }

  if (internal === true) return { created: false, internal: true };

  if (internal === false) {
    if (containers > 0) {
      if (log) await log(`⚠️ Network '${name}' is not internal but still has ${containers} attached container(s); leaving it in place`);
      return { created: false, internal: false };
    }
    if (verbose && log) await log(`[VERBOSE] ${logPrefix}: replacing non-internal network '${name}'`);
    await dockerOk(run, ['network', 'rm', name], { timeoutMs });
  }

  await dockerText(run, ['network', 'create', '--internal', '--label', `${label}=network`, name], { timeoutMs });
  if (verbose && log) await log(`[VERBOSE] ${logPrefix}: created internal network '${name}'`);
  return { created: true, internal: true };
};

/**
 * Add a network to an already-created container.
 *
 * A single `docker run --network` *replaces* the container's default bridge, so
 * an `--internal` network passed that way would also cut the container off from
 * GitHub and the package registries. Attaching afterwards is additive, which is
 * what both sidecars need — for the task container, and for the router sidecar
 * itself, which must keep its outbound route to the vendor APIs.
 */
export const attachDockerNetwork = async ({ network, container, alias = null, run = execFileAsync, timeoutMs, log = null, verbose = false, logPrefix = 'docker-sidecar' } = {}) => {
  if (!container) return { attached: false, error: 'no container' };
  const args = ['network', 'connect'];
  if (alias) args.push('--alias', alias);
  args.push(network, container);
  try {
    await dockerText(run, args, { timeoutMs });
    if (verbose && log) await log(`[VERBOSE] ${logPrefix}: attached '${container}' to '${network}'${alias ? ` as '${alias}'` : ''}`);
    return { attached: true, error: null };
  } catch (error) {
    const message = dockerErrorMessage(error);
    // Docker reports an already-attached container as an error; that is success.
    if (/already exists in network/i.test(message)) return { attached: true, error: null };
    if (log) await log(`⚠️ Could not attach '${container}' to network '${network}': ${message}`);
    return { attached: false, error: message };
  }
};

/** Create a named volume if it is missing. Never removed by any caller: it holds the data the sidecar exists to keep. */
export const ensureDockerVolume = async ({ name, label, role = 'data', run = execFileAsync, timeoutMs, log = null, verbose = false, logPrefix = 'docker-sidecar' } = {}) => {
  if (await dockerOk(run, ['volume', 'inspect', name], { timeoutMs })) return { created: false };
  await dockerText(run, ['volume', 'create', '--label', `${label}=${role}`, name], { timeoutMs });
  if (verbose && log) await log(`[VERBOSE] ${logPrefix}: created volume '${name}'`);
  return { created: true };
};

/** Path of a sidecar's durable record inside the bot state directory. */
export const resolveSidecarStatePath = (fileName, env = process.env) => path.join(resolveBotStateDir(env), fileName);

/** Read a durable sidecar record. A missing or corrupt file is an empty record, never a throw. */
export const readSidecarState = ({ fileName, emptyState, env = process.env, fsImpl = fs } = {}) => {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(resolveSidecarStatePath(fileName, env), 'utf8'));
    return { ...emptyState, ...parsed, leases: Array.isArray(parsed?.leases) ? parsed.leases : [] };
  } catch {
    return { ...emptyState, leases: [] };
  }
};

/**
 * Persist a sidecar record atomically so a crash mid-write cannot corrupt it.
 *
 * `mode` exists because the router's record holds its JWT signing secret, which
 * mints subscription access: that file must not be world-readable (issue #2164).
 */
export const writeSidecarState = (state, { fileName, env = process.env, fsImpl = fs, mode = 0o600 } = {}) => {
  const target = resolveSidecarStatePath(fileName, env);
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode });
  fsImpl.renameSync(temporary, target);
  return state;
};

/**
 * How long a lease whose container has never been seen running is kept.
 *
 * A lease is taken *before* start-command creates the task container, because
 * the endpoint and the token have to be known when the task's environment is
 * built. During that window the container legitimately does not exist yet — and
 * creating it can take a long time when the isolation image still has to be
 * pulled.
 */
export const LEASE_START_GRACE_MS = 60 * 60 * 1000;

/**
 * Drop leases whose task container no longer runs, so a crashed run cannot pin
 * a sidecar up forever.
 *
 * Liveness is re-derived from Docker on every call rather than trusted from the
 * store, which is what lets a restarted bot converge instead of orphaning.
 *
 * @param {Array<object>} leases
 * @param {{onDropped?: (lease: object) => Promise<void>|void}} options
 *   `onDropped` lets a sidecar clean up what the lease owned — the router
 *   revokes the task's token there.
 */
export const reconcileSidecarLeases = async (leases, { run = execFileAsync, timeoutMs, log = null, verbose = false, now = () => Date.now(), onDropped = null, logPrefix = 'docker-sidecar' } = {}) => {
  const live = [];
  for (const lease of leases) {
    if (!lease?.sessionId) continue;
    const container = await inspectDockerContainer(lease.sessionId, { run, timeoutMs });
    if (container.exists && container.running) {
      live.push(lease.containerSeen ? lease : { ...lease, containerSeen: true });
      continue;
    }
    if (!lease.containerSeen) {
      const age = now() - (Date.parse(lease.acquiredAt ?? '') || 0);
      if (age < LEASE_START_GRACE_MS) {
        if (verbose && log) await log(`[VERBOSE] ${logPrefix}: keeping lease '${lease.sessionId}' whose container has not appeared yet (${Math.round(age / 1000)}s into the ${Math.round(LEASE_START_GRACE_MS / 1000)}s launch grace)`);
        live.push(lease);
        continue;
      }
    }
    if (verbose && log) await log(`[VERBOSE] ${logPrefix}: dropping stale lease '${lease.sessionId}' (container exists=${container.exists} running=${container.running})`);
    if (onDropped) await onDropped(lease);
  }
  return live;
};

export default {
  attachDockerNetwork,
  dockerErrorMessage,
  dockerOk,
  dockerText,
  ensureDockerVolume,
  ensureInternalDockerNetwork,
  inspectDockerContainer,
  readDockerContainerAddress,
  readDockerImageDigest,
  readSidecarState,
  reconcileSidecarLeases,
  resolveSidecarStatePath,
  sleep,
  writeSidecarState,
};
