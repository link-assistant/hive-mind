/**
 * On-demand Formal AI sidecar lifecycle (issue #2146, PR #2147 review).
 *
 * The maintainer's review asked for a container that exists only while Formal
 * AI work exists:
 *
 *   1. start the Formal AI container and connect it to the task's container
 *      over an *internal* Docker network only, and only while tasks run;
 *   2. stop it when no Formal AI task is running;
 *   3. update it to the newest published image while it is stopped/idle;
 *   4. preserve memory between tasks and across container replacement.
 *
 * This module owns (1), (2) and (4); `./formal-ai-updater.lib.mjs` owns (3) and
 * reuses the same durable state and the same exclusive lock so an update can
 * never interleave with a task launch.
 *
 * Design notes that are easy to get wrong and therefore stated explicitly:
 *
 * - **Leases, not a boolean.** Concurrent `/solve --model formal-ai` runs share
 *   one sidecar. Each task holds a named lease; the sidecar is stopped only
 *   after the last lease is released. A crashed bot cannot leak a lease
 *   forever, because every reconcile re-derives liveness from Docker itself.
 * - **Truth comes from Docker.** The JSON store is a cache. `reconcile()` drops
 *   leases whose task container is gone and adopts a sidecar that is running
 *   without a store entry, so a bot restart converges instead of orphaning.
 * - **The memory volume is never removed.** Stopping the sidecar, replacing its
 *   image, or rolling an update back all leave `hive-mind-formal-ai-memory`
 *   in place; that named volume is the persisted memory the review requires.
 * - **`docker network connect`, not `docker run --network`.** A single
 *   `docker run --network` *replaces* the container's default bridge, so an
 *   `--internal` network passed that way would also cut the task off from
 *   GitHub and the package registries. start-command 0.32.0+ (start#156 →
 *   start PR #157) can express both networks at launch by repeating
 *   `--network`, implemented upstream as the same create → connect → start
 *   sequence; Hive Mind keeps issuing the additive `docker network connect`
 *   itself while the start gate still holds the task command back, because
 *   that stays fail-closed on any installed start-command version instead of
 *   silently collapsing to one network on pre-0.32.0 parsers.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/hive-mind/pull/2147
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { FORMAL_AI_BOOTSTRAP_VERSION } from './formal-ai-version.lib.mjs';
import { isFormalAiModel } from './formal-ai-model.lib.mjs';
import { getModelFromArgs } from './model-args.lib.mjs';
import { resolveBotStateDir } from './session-store.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

const execFileAsync = promisify(execFile);

/** Container, network, volume and alias names. Stable so reconciliation works across restarts. */
export const FORMAL_AI_SIDECAR_CONTAINER_NAME = 'hive-mind-formal-ai';
export const FORMAL_AI_SIDECAR_NETWORK_NAME = 'hive-mind-formal-ai';
/**
 * The DNS alias task containers resolve. Deliberately unchanged from the
 * Compose deployment so `HIVE_MIND_FORMAL_AI_BASE_URL` keeps its value and
 * existing operator configuration keeps working.
 */
export const FORMAL_AI_SIDECAR_NETWORK_ALIAS = 'link-assistant-formal-ai';
export const FORMAL_AI_MEMORY_VOLUME_NAME = 'hive-mind-formal-ai-memory';
export const FORMAL_AI_SIDECAR_PORT = 8080;

/**
 * Where the memory volume is mounted inside the sidecar. The published image's
 * DinD entrypoint runs application commands as `box`, so upstream's own
 * released-to-candidate upgrade fixture uses `/home/box/.formal-ai` rather than
 * the image's `/root/.formal-ai` default.
 *
 * @see https://github.com/link-assistant/formal-ai/blob/main/experiments/issue_982_memory_upgrade/run_container_upgrade.sh
 */
export const FORMAL_AI_MEMORY_MOUNT = '/home/box/.formal-ai';
export const FORMAL_AI_MEMORY_PATH = `${FORMAL_AI_MEMORY_MOUNT}/memory.lino`;

/** Image published by every Formal AI release (`:latest` plus the bare version). */
export const FORMAL_AI_IMAGE_REPOSITORY = 'ghcr.io/link-assistant/formal-ai';

/** Applied to the sidecar, its network and its volume so reconciliation can find them. */
export const FORMAL_AI_SIDECAR_LABEL = 'com.link-assistant.hive-mind.formal-ai';

const STATE_FILE_NAME = 'formal-ai-sidecar.json';
const SIDECAR_LOCK_NAME = 'formal-ai-sidecar';
const DEFAULT_DOCKER_TIMEOUT_MS = 120_000;
const DEFAULT_HEALTH_ATTEMPTS = 60;
const DEFAULT_HEALTH_DELAY_MS = 1000;

const EMPTY_STATE = Object.freeze({ version: 1, image: null, imageDigest: null, startedAt: null, leases: [], lastUpdate: null });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * True when a task will be driven by Formal AI.
 *
 * Issue #2146 requires the lifecycle to key off the *model*, never the CLI
 * tool: `--tool claude --model formal-ai` is a Formal AI task, and
 * `--tool claude --model opus` is not.
 *
 * @param {object} params
 * @param {string[]} [params.args] - The task's argument vector.
 * @param {string} [params.model] - An already-resolved model, when known.
 * @returns {boolean}
 */
export const isFormalAiTask = ({ args = [], model = null } = {}) => isFormalAiModel(model || getModelFromArgs(args));

/** Resolve the image the sidecar boots with. Operators may pin their own build. */
export const resolveFormalAiSidecarImage = (env = process.env) => String(env.HIVE_MIND_FORMAL_AI_IMAGE || '').trim() || `${FORMAL_AI_IMAGE_REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`;

/** Build the endpoint origin for a host name or address. */
export const buildFormalAiSidecarBaseUrl = (host = FORMAL_AI_SIDECAR_NETWORK_ALIAS) => `http://${host}:${FORMAL_AI_SIDECAR_PORT}`;

/** The DNS form of the endpoint, used when the sidecar's address is unknown. */
export const resolveFormalAiSidecarBaseUrl = () => buildFormalAiSidecarBaseUrl(FORMAL_AI_SIDECAR_NETWORK_ALIAS);

/**
 * The published image boots a Docker-in-Docker entrypoint. The sidecar only
 * serves HTTP, so the inner daemon is skipped; `--privileged` then buys
 * nothing and is opt-in.
 */
export const shouldRunPrivilegedFormalAiSidecar = (env = process.env) => {
  const raw = String(env.HIVE_MIND_FORMAL_AI_PRIVILEGED ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

/**
 * On-demand lifecycle is the default. `HIVE_MIND_FORMAL_AI_SIDECAR=0` opts a
 * deployment out — for example one that still runs a permanently-up Formal AI
 * service from Compose and reaches it through `HIVE_MIND_FORMAL_AI_BASE_URL`.
 */
export const isFormalAiSidecarEnabled = (env = process.env) => {
  const raw = String(env.HIVE_MIND_FORMAL_AI_SIDECAR ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

export const resolveFormalAiSidecarStatePath = (env = process.env) => path.join(resolveBotStateDir(env), STATE_FILE_NAME);

/** Read the durable sidecar record. A missing or corrupt file is an empty record, never a throw. */
export const readFormalAiSidecarState = ({ env = process.env, fsImpl = fs } = {}) => {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(resolveFormalAiSidecarStatePath(env), 'utf8'));
    return { ...EMPTY_STATE, ...parsed, leases: Array.isArray(parsed?.leases) ? parsed.leases : [] };
  } catch {
    return { ...EMPTY_STATE, leases: [] };
  }
};

/** Persist the sidecar record atomically so a crash mid-write cannot corrupt it. */
export const writeFormalAiSidecarState = (state, { env = process.env, fsImpl = fs } = {}) => {
  const target = resolveFormalAiSidecarStatePath(env);
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fsImpl.renameSync(temporary, target);
  return state;
};

/**
 * Serialize every sidecar mutation — task launches, task releases and image
 * updates — behind one exclusive lock.
 *
 * Invariant 7 of the case study: a pull, CLI refresh or memory migration must
 * never begin while a task launch is in flight, and vice versa.
 */
export const withFormalAiSidecarLock = (fn, options = {}) => withStateLock(SIDECAR_LOCK_NAME, fn, options);

const dockerText = async (run, args, { timeoutMs = DEFAULT_DOCKER_TIMEOUT_MS } = {}) => {
  const result = await run('docker', args, { encoding: 'utf8', timeout: timeoutMs });
  return String(result?.stdout ?? '').trim();
};

const dockerOk = async (run, args, options) => {
  try {
    await dockerText(run, args, options);
    return true;
  } catch {
    return false;
  }
};

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

/**
 * The sidecar's IPv4 address on the internal network.
 *
 * Task containers are given this address rather than the DNS alias. They are
 * created on the default bridge and attached to the internal network only
 * afterwards, so relying on Docker's embedded DNS being wired up
 * post-attachment would be a needless gamble; the address cannot change during
 * a lease, because an image replacement requires zero leases.
 */
export const readFormalAiSidecarAddress = async ({ containerName = FORMAL_AI_SIDECAR_CONTAINER_NAME, network = FORMAL_AI_SIDECAR_NETWORK_NAME, run = execFileAsync, timeoutMs } = {}) => {
  try {
    return (await dockerText(run, ['inspect', containerName, '--format', `{{with index .NetworkSettings.Networks "${network}"}}{{.IPAddress}}{{end}}`], { timeoutMs })) || null;
  } catch {
    return null;
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

/**
 * Create the private network the sidecar and its tasks share.
 *
 * `--internal` is the security requirement from the review: the Formal AI
 * endpoint must not be published to the host and must not be reachable from
 * any other network. An existing network that is *not* internal is a stale
 * artifact from the Compose deployment and is replaced when nothing is
 * attached to it.
 */
export const ensureFormalAiNetwork = async ({ run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  // `null` means "absent", which is different from "present but not internal".
  let internal = null;
  let containers = 0;
  try {
    const raw = await dockerText(run, ['network', 'inspect', FORMAL_AI_SIDECAR_NETWORK_NAME, '--format', '{{.Internal}}|{{len .Containers}}'], { timeoutMs });
    const [internalFlag, containerCount] = raw.split('|');
    internal = internalFlag === 'true';
    containers = Number(containerCount) || 0;
  } catch {
    // Absent; fall through to creation.
  }

  if (internal === true) return { created: false, internal: true };

  if (internal === false) {
    if (containers > 0) {
      if (log) await log(`⚠️ Formal AI network '${FORMAL_AI_SIDECAR_NETWORK_NAME}' is not internal but still has ${containers} attached container(s); leaving it in place`);
      return { created: false, internal: false };
    }
    if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: replacing non-internal network '${FORMAL_AI_SIDECAR_NETWORK_NAME}'`);
    await dockerOk(run, ['network', 'rm', FORMAL_AI_SIDECAR_NETWORK_NAME], { timeoutMs });
  }

  await dockerText(run, ['network', 'create', '--internal', '--label', `${FORMAL_AI_SIDECAR_LABEL}=network`, FORMAL_AI_SIDECAR_NETWORK_NAME], { timeoutMs });
  if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: created internal network '${FORMAL_AI_SIDECAR_NETWORK_NAME}'`);
  return { created: true, internal: true };
};

/**
 * Create the persisted-memory volume if it is missing and hand it to the
 * container's `box` user.
 *
 * Never removed anywhere in this module: it is the memory that must survive
 * task boundaries, sidecar stops, image replacement and rollback.
 */
export const ensureFormalAiMemoryVolume = async ({ image, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (await dockerOk(run, ['volume', 'inspect', FORMAL_AI_MEMORY_VOLUME_NAME], { timeoutMs })) {
    return { created: false };
  }

  await dockerText(run, ['volume', 'create', '--label', `${FORMAL_AI_SIDECAR_LABEL}=memory`, FORMAL_AI_MEMORY_VOLUME_NAME], { timeoutMs });
  // A fresh named volume is root-owned; the image runs application commands as
  // `box`, so seed the ownership exactly as upstream's own upgrade fixture does.
  await dockerOk(run, ['run', '--rm', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`, '--entrypoint', 'chown', image, '-R', 'box:box', FORMAL_AI_MEMORY_MOUNT], { timeoutMs });
  if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: created memory volume '${FORMAL_AI_MEMORY_VOLUME_NAME}'`);
  return { created: true };
};

/** Build the `docker run` argv for the sidecar. Exported so tests can assert the contract. */
export const buildFormalAiSidecarRunArgs = ({ image, env = process.env, containerName = FORMAL_AI_SIDECAR_CONTAINER_NAME } = {}) => {
  const args = ['run', '--detach', '--name', containerName, '--label', `${FORMAL_AI_SIDECAR_LABEL}=sidecar`, '--network', FORMAL_AI_SIDECAR_NETWORK_NAME, '--network-alias', FORMAL_AI_SIDECAR_NETWORK_ALIAS, '--restart', 'no'];

  if (shouldRunPrivilegedFormalAiSidecar(env)) args.push('--privileged');

  args.push(
    // The sidecar serves HTTP only; the image's inner Docker daemon is dead
    // weight and would demand --privileged.
    '--env',
    'DIND_SKIP_DAEMON=1',
    '--env',
    `FORMAL_AI_MEMORY_PATH=${FORMAL_AI_MEMORY_PATH}`,
    '--volume',
    `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`,
    image,
    'formal-ai',
    'serve',
    '--agent-mode',
    '--host',
    '0.0.0.0',
    '--port',
    String(FORMAL_AI_SIDECAR_PORT)
  );
  // No `-p`: the endpoint is reachable only from the internal network.
  return args;
};

/**
 * Read `/health` from inside the sidecar.
 *
 * `docker exec` is used instead of an HTTP client on the host precisely
 * *because* the network is internal — there is no host-visible port, which is
 * the property the review asked for.
 *
 * @returns {Promise<{healthy: boolean, health: object|null, error: string|null}>}
 */
export const checkFormalAiSidecarHealth = async ({ containerName = FORMAL_AI_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs = 30_000 } = {}) => {
  try {
    const raw = await dockerText(run, ['exec', containerName, 'curl', '-fsS', `http://127.0.0.1:${FORMAL_AI_SIDECAR_PORT}/health`], { timeoutMs });
    const health = JSON.parse(raw);
    // 0.336.0+ reports memory compatibility here; refuse a container that can
    // read the endpoint but not the persisted memory it was given.
    const memoryCompatible = health?.memory?.compatible !== false;
    return { healthy: memoryCompatible, health, error: memoryCompatible ? null : `Formal AI reports incompatible memory (migration_state=${health?.memory?.migration_state ?? 'unknown'})` };
  } catch (error) {
    return { healthy: false, health: null, error: error?.stderr?.toString?.().trim() || error?.message || String(error) };
  }
};

/** Poll `/health` until the sidecar answers or the attempt budget runs out. */
export const waitForFormalAiSidecarHealth = async ({ containerName = FORMAL_AI_SIDECAR_CONTAINER_NAME, run = execFileAsync, attempts = DEFAULT_HEALTH_ATTEMPTS, delayMs = DEFAULT_HEALTH_DELAY_MS, sleepImpl = sleep, log = null, verbose = false } = {}) => {
  let last = { healthy: false, health: null, error: 'not probed' };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    last = await checkFormalAiSidecarHealth({ containerName, run });
    if (last.healthy) {
      if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: '${containerName}' healthy after ${attempt} probe(s) (version=${last.health?.version ?? 'unknown'}, memory schema=${last.health?.memory?.schema_version ?? 'unknown'})`);
      return last;
    }
    if (attempt < attempts) await sleepImpl(delayMs);
  }
  return last;
};

/**
 * Drop leases whose task container no longer runs, so a crashed run cannot pin
 * the sidecar.
 *
 * A lease is taken *before* start-command creates the task container, because
 * the endpoint has to be known when the task's environment is built. During
 * that window the container legitimately does not exist yet — and creating it
 * can take a long time when the isolation image still has to be pulled. A lease
 * that has never been seen running is therefore kept until
 * `LEASE_START_GRACE_MS` elapses; afterwards, and always once the container has
 * been observed, liveness is Docker's answer alone.
 */
const LEASE_START_GRACE_MS = 60 * 60 * 1000;

const reconcileLeases = async (leases, { run, timeoutMs, log, verbose, now = () => Date.now() }) => {
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
        if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: keeping lease '${lease.sessionId}' whose container has not appeared yet (${Math.round(age / 1000)}s into the ${Math.round(LEASE_START_GRACE_MS / 1000)}s launch grace)`);
        live.push(lease);
        continue;
      }
    }
    if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: dropping stale lease '${lease.sessionId}' (container exists=${container.exists} running=${container.running})`);
  }
  return live;
};

/**
 * Re-derive the sidecar record from Docker.
 *
 * Invariant 5 of the case study: truth comes from container and network state
 * as well as the durable store, so a bot restart converges instead of leaving
 * an orphaned container running with nothing to serve.
 */
export const reconcileFormalAiSidecar = async ({ env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  const state = readFormalAiSidecarState({ env, fsImpl });
  const leases = await reconcileLeases(state.leases, { run, timeoutMs, log, verbose });
  const container = await inspectDockerContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
  const next = {
    ...state,
    leases,
    image: container.exists ? container.image : state.image,
    imageDigest: container.exists ? container.imageDigest : state.imageDigest,
    startedAt: container.running ? state.startedAt : null,
  };
  writeFormalAiSidecarState(next, { env, fsImpl });
  return { state: next, container, leaseCount: leases.length };
};

/**
 * Stop and remove the sidecar and its network. The memory volume is left
 * untouched — see invariant 6.
 */
export const stopFormalAiSidecar = async ({ env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false, reason = 'idle' } = {}) => {
  const container = await inspectDockerContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
  if (container.exists) {
    await dockerOk(run, ['stop', FORMAL_AI_SIDECAR_CONTAINER_NAME], { timeoutMs });
    await dockerOk(run, ['rm', '--force', FORMAL_AI_SIDECAR_CONTAINER_NAME], { timeoutMs });
  }
  await dockerOk(run, ['network', 'rm', FORMAL_AI_SIDECAR_NETWORK_NAME], { timeoutMs });

  const state = readFormalAiSidecarState({ env, fsImpl });
  writeFormalAiSidecarState({ ...state, startedAt: null, leases: [] }, { env, fsImpl });
  if (log) await log(`🛑 Formal AI sidecar stopped (${reason}); memory volume '${FORMAL_AI_MEMORY_VOLUME_NAME}' preserved`);
  if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: removed container=${container.exists} network='${FORMAL_AI_SIDECAR_NETWORK_NAME}'`);
  return { stopped: container.exists };
};

/**
 * Ensure a healthy sidecar exists and record a lease for `sessionId`.
 *
 * Must be called *before* the task container's command is allowed to run.
 * Returns the endpoint the task should be pointed at.
 */
export const acquireFormalAiSidecar = async ({ sessionId, tool = null, model = null, env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false, now = () => new Date(), healthAttempts, healthDelayMs, sleepImpl = sleep, lockOptions = {} } = {}) => {
  if (!sessionId) throw new Error('acquireFormalAiSidecar requires a sessionId');

  return withFormalAiSidecarLock(
    async () => {
      const image = resolveFormalAiSidecarImage(env);
      const state = readFormalAiSidecarState({ env, fsImpl });
      const leases = await reconcileLeases(state.leases, { run, timeoutMs, log, verbose });

      await ensureFormalAiNetwork({ run, timeoutMs, log, verbose });
      await ensureFormalAiMemoryVolume({ image, run, timeoutMs, log, verbose });

      let container = await inspectDockerContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
      if (container.exists && !container.running) {
        // A stopped container may predate an image change; recreate instead of
        // resurrecting an unknown revision.
        await dockerOk(run, ['rm', '--force', FORMAL_AI_SIDECAR_CONTAINER_NAME], { timeoutMs });
        container = { exists: false, running: false, image: null, imageDigest: null };
      }

      if (!container.exists) {
        if (log) await log(`🧠 Starting the Formal AI sidecar (${image}) on the internal network '${FORMAL_AI_SIDECAR_NETWORK_NAME}'`);
        await dockerText(run, buildFormalAiSidecarRunArgs({ image, env }), { timeoutMs });
        container = await inspectDockerContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
      }

      const health = await waitForFormalAiSidecarHealth({ run, attempts: healthAttempts, delayMs: healthDelayMs, sleepImpl, log, verbose });
      if (!health.healthy) {
        // Fail closed: issue #2146 requires a Formal AI run to stop rather than
        // silently fall back to another model.
        throw new Error(`Formal AI sidecar '${FORMAL_AI_SIDECAR_CONTAINER_NAME}' did not become healthy: ${health.error}`);
      }

      const address = await readFormalAiSidecarAddress({ run, timeoutMs });
      const acquiredAt = now().toISOString();
      const nextLeases = [...leases.filter(lease => lease.sessionId !== sessionId), { sessionId, tool, model, acquiredAt }];
      writeFormalAiSidecarState({ ...state, image: container.image || image, imageDigest: container.imageDigest, startedAt: state.startedAt || acquiredAt, leases: nextLeases }, { env, fsImpl });

      if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: lease '${sessionId}' acquired (${nextLeases.length} active), image=${container.image || image}, digest=${container.imageDigest ?? 'unknown'}, address=${address ?? 'unknown'}, formal-ai=${health.health?.version ?? 'unknown'}, memory schema=${health.health?.memory?.schema_version ?? 'unknown'}`);

      return {
        address,
        baseUrl: address ? buildFormalAiSidecarBaseUrl(address) : resolveFormalAiSidecarBaseUrl(),
        dnsBaseUrl: resolveFormalAiSidecarBaseUrl(),
        network: FORMAL_AI_SIDECAR_NETWORK_NAME,
        networkAlias: FORMAL_AI_SIDECAR_NETWORK_ALIAS,
        containerName: FORMAL_AI_SIDECAR_CONTAINER_NAME,
        memoryVolume: FORMAL_AI_MEMORY_VOLUME_NAME,
        image: container.image || image,
        imageDigest: container.imageDigest,
        health: health.health,
        leaseCount: nextLeases.length,
      };
    },
    { env, fsImpl, sleepImpl, log, ...lockOptions }
  );
};

/**
 * Attach a launched task container to the internal Formal AI network.
 *
 * Called while the Docker start gate still holds the task command back, so the
 * endpoint is resolvable before the first request is made.
 */
export const attachTaskToFormalAiNetwork = async ({ sessionId, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (!sessionId) return { attached: false, error: 'no sessionId' };
  try {
    await dockerText(run, ['network', 'connect', FORMAL_AI_SIDECAR_NETWORK_NAME, sessionId], { timeoutMs });
    if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: attached task container '${sessionId}' to '${FORMAL_AI_SIDECAR_NETWORK_NAME}'`);
    return { attached: true, error: null };
  } catch (error) {
    const message = error?.stderr?.toString?.().trim() || error?.message || String(error);
    // Docker reports an already-attached container as an error; that is success.
    if (/already exists in network/i.test(message)) return { attached: true, error: null };
    if (log) await log(`⚠️ Could not attach task container '${sessionId}' to the Formal AI network: ${message}`);
    return { attached: false, error: message };
  }
};

/**
 * Release `sessionId`'s lease and, when it was the last one, stop the sidecar.
 *
 * @returns {Promise<{leaseCount: number, stopped: boolean}>}
 */
export const releaseFormalAiSidecar = async ({ sessionId, env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false, sleepImpl = sleep, lockOptions = {} } = {}) => {
  return withFormalAiSidecarLock(
    async () => {
      const state = readFormalAiSidecarState({ env, fsImpl });
      const remaining = await reconcileLeases(
        state.leases.filter(lease => lease.sessionId !== sessionId),
        { run, timeoutMs, log, verbose }
      );
      writeFormalAiSidecarState({ ...state, leases: remaining }, { env, fsImpl });

      if (remaining.length > 0) {
        if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: lease '${sessionId}' released, ${remaining.length} still active; sidecar stays up`);
        return { leaseCount: remaining.length, stopped: false };
      }

      const { stopped } = await stopFormalAiSidecar({ env, fsImpl, run, timeoutMs, log, verbose, reason: 'no Formal AI tasks running' });
      return { leaseCount: 0, stopped };
    },
    { env, fsImpl, sleepImpl, log, ...lockOptions }
  );
};

export default {
  acquireFormalAiSidecar,
  attachTaskToFormalAiNetwork,
  buildFormalAiSidecarBaseUrl,
  buildFormalAiSidecarRunArgs,
  checkFormalAiSidecarHealth,
  ensureFormalAiMemoryVolume,
  ensureFormalAiNetwork,
  inspectDockerContainer,
  isFormalAiSidecarEnabled,
  isFormalAiTask,
  readDockerImageDigest,
  readFormalAiSidecarAddress,
  readFormalAiSidecarState,
  reconcileFormalAiSidecar,
  releaseFormalAiSidecar,
  resolveFormalAiSidecarBaseUrl,
  resolveFormalAiSidecarImage,
  resolveFormalAiSidecarStatePath,
  stopFormalAiSidecar,
  waitForFormalAiSidecarHealth,
  withFormalAiSidecarLock,
  writeFormalAiSidecarState,
};
