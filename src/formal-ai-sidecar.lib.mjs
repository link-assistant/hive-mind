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
import { promisify } from 'node:util';

import { FORMAL_AI_MINIMUM_VERSION, isFormalAiVersionAtLeast } from './formal-ai-version.lib.mjs';
import { ensureFormalAiSidecarImage, readAcceptedFormalAiImage, resolveFormalAiSidecarImage } from './formal-ai-image.lib.mjs';
import { isFormalAiModel } from './formal-ai-model.lib.mjs';
import { getModelFromArgs } from './model-args.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';
import { attachDockerNetwork, DEFAULT_IMAGE_TIMEOUT_MS, dockerOk, dockerText, ensureDockerVolume, ensureInternalDockerNetwork, inspectDockerContainer, readDockerContainerAddress, readDockerImageDigest, readSidecarState, reconcileSidecarLeases, resolveSidecarStatePath, sleep, writeSidecarState } from './docker-sidecar.lib.mjs';

const execFileAsync = promisify(execFile);

// Re-exported because callers of this module have always imported them from
// here; the implementations now live in the shared sidecar module.
export { inspectDockerContainer, readDockerImageDigest };

const LOG_PREFIX = 'formal-ai-sidecar';

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

/**
 * Image published by every Formal AI release (`:latest` plus the bare version).
 *
 * Re-exported from `formal-ai-image.lib.mjs`, which owns image resolution since
 * issue #2154 taught us that "which image" and "is it actually pullable" are the
 * same question.
 */
export { FORMAL_AI_IMAGE_REPOSITORY, readAcceptedFormalAiImage, resolveAcceptedFormalAiImageCandidates, resolveFormalAiSidecarImage, resolveFormalAiSidecarImageCandidates } from './formal-ai-image.lib.mjs';

/** Applied to the sidecar, its network and its volume so reconciliation can find them. */
export const FORMAL_AI_SIDECAR_LABEL = 'com.link-assistant.hive-mind.formal-ai';

const STATE_FILE_NAME = 'formal-ai-sidecar.json';
const SIDECAR_LOCK_NAME = 'formal-ai-sidecar';
// Pulling a sidecar image is the one Docker call that legitimately takes many
// minutes, so it gets its own budget instead of the general command timeout.
const DEFAULT_HEALTH_ATTEMPTS = 60;
const DEFAULT_HEALTH_DELAY_MS = 1000;

/**
 * `lastUpdate` is the accepted-release record (issue #2207) and `serving` is the
 * provenance of the container that last answered a lease (issue #2208). Neither
 * is derivable from `image`/`imageDigest`, which are only a cache of whatever is
 * running right now.
 */
const EMPTY_STATE = Object.freeze({ version: 1, image: null, imageReference: null, imageDigest: null, startedAt: null, leases: [], lastUpdate: null, serving: null });

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

export const resolveFormalAiSidecarStatePath = (env = process.env) => resolveSidecarStatePath(STATE_FILE_NAME, env);

/** Read the durable sidecar record. A missing or corrupt file is an empty record, never a throw. */
export const readFormalAiSidecarState = ({ env = process.env, fsImpl = fs } = {}) => readSidecarState({ fileName: STATE_FILE_NAME, emptyState: EMPTY_STATE, env, fsImpl });

/** Persist the sidecar record atomically so a crash mid-write cannot corrupt it. */
export const writeFormalAiSidecarState = (state, { env = process.env, fsImpl = fs } = {}) => writeSidecarState(state, { fileName: STATE_FILE_NAME, env, fsImpl });

/**
 * Serialize every sidecar mutation — task launches, task releases and image
 * updates — behind one exclusive lock.
 *
 * Invariant 7 of the case study: a pull, CLI refresh or memory migration must
 * never begin while a task launch is in flight, and vice versa.
 */
export const withFormalAiSidecarLock = (fn, options = {}) => withStateLock(SIDECAR_LOCK_NAME, fn, options);

/**
 * The sidecar's IPv4 address on the internal network.
 *
 * Task containers are given this address rather than the DNS alias. They are
 * created on the default bridge and attached to the internal network only
 * afterwards, so relying on Docker's embedded DNS being wired up
 * post-attachment would be a needless gamble; the address cannot change during
 * a lease, because an image replacement requires zero leases.
 */
export const readFormalAiSidecarAddress = async ({ containerName = FORMAL_AI_SIDECAR_CONTAINER_NAME, network = FORMAL_AI_SIDECAR_NETWORK_NAME, run = execFileAsync, timeoutMs } = {}) => readDockerContainerAddress(containerName, network, { run, timeoutMs });

/**
 * Create the private network the sidecar and its tasks share.
 *
 * `--internal` is the security requirement from the review: the Formal AI
 * endpoint must not be published to the host and must not be reachable from
 * any other network. An existing network that is *not* internal is a stale
 * artifact from the Compose deployment and is replaced when nothing is
 * attached to it.
 */
export const ensureFormalAiNetwork = async ({ run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => ensureInternalDockerNetwork({ name: FORMAL_AI_SIDECAR_NETWORK_NAME, label: FORMAL_AI_SIDECAR_LABEL, run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });

/**
 * Create the persisted-memory volume if it is missing and hand it to the
 * container's `box` user.
 *
 * Never removed anywhere in this module: it is the memory that must survive
 * task boundaries, sidecar stops, image replacement and rollback.
 */
export const ensureFormalAiMemoryVolume = async ({ image, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  const result = await ensureDockerVolume({ name: FORMAL_AI_MEMORY_VOLUME_NAME, label: FORMAL_AI_SIDECAR_LABEL, role: 'memory', run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });
  if (!result.created) return result;
  // A fresh named volume is root-owned; the image runs application commands as
  // `box`, so seed the ownership exactly as upstream's own upgrade fixture does.
  await dockerOk(run, ['run', '--rm', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`, '--entrypoint', 'chown', image, '-R', 'box:box', FORMAL_AI_MEMORY_MOUNT], { timeoutMs });
  return result;
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
const reconcileLeases = async (leases, options) => reconcileSidecarLeases(leases, { ...options, logPrefix: LOG_PREFIX });

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
export const acquireFormalAiSidecar = async ({ sessionId, tool = null, model = null, env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, imageTimeoutMs = DEFAULT_IMAGE_TIMEOUT_MS, log = null, verbose = false, now = () => new Date(), healthAttempts, healthDelayMs, sleepImpl = sleep, lockOptions = {} } = {}) => {
  if (!sessionId) throw new Error('acquireFormalAiSidecar requires a sessionId');

  return withFormalAiSidecarLock(
    async () => {
      const state = readFormalAiSidecarState({ env, fsImpl });
      const leases = await reconcileLeases(state.leases, { run, timeoutMs, log, verbose });

      let container = await inspectDockerContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
      if (container.exists && !container.running) {
        // A stopped container may predate an image change; recreate instead of
        // resurrecting an unknown revision.
        await dockerOk(run, ['rm', '--force', FORMAL_AI_SIDECAR_CONTAINER_NAME], { timeoutMs });
        container = { exists: false, running: false, image: null, imageDigest: null };
      }

      // Resolve the image *before* anything shells out with it. Until issue
      // #2154 the reference went straight into `docker run`, so a registry that
      // refused the pull surfaced as an unreadable `Command failed: docker run …`
      // dump and the task died even though a usable image sat on the host.
      //
      // `accepted` is what issue #2207 was missing: without it the candidate
      // list was rebuilt from the bootstrap pin on every cold start, so an
      // update that had already been pulled, migrated and verified was silently
      // discarded by the very next task.
      const accepted = readAcceptedFormalAiImage(state);
      const resolved = container.exists && container.image ? { image: container.image, reference: container.image, source: 'running-sidecar', pulled: false } : await ensureFormalAiSidecarImage({ env, accepted, run, timeoutMs: imageTimeoutMs, log, verbose });
      const image = resolved.image;
      const imageReference = resolved.reference || image;

      await ensureFormalAiNetwork({ run, timeoutMs, log, verbose });
      await ensureFormalAiMemoryVolume({ image, run, timeoutMs, log, verbose });

      if (!container.exists) {
        if (log) await log(`🧠 Starting the Formal AI sidecar (${imageReference}${imageReference === image ? '' : ` @ ${image}`}, ${resolved.source}) on the internal network '${FORMAL_AI_SIDECAR_NETWORK_NAME}'`);
        await dockerText(run, buildFormalAiSidecarRunArgs({ image, env }), { timeoutMs });
        container = await inspectDockerContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
      }

      const health = await waitForFormalAiSidecarHealth({ run, attempts: healthAttempts, delayMs: healthDelayMs, sleepImpl, log, verbose });
      if (!health.healthy) {
        // Fail closed: issue #2146 requires a Formal AI run to stop rather than
        // silently fall back to another model.
        throw new Error(`Formal AI sidecar '${FORMAL_AI_SIDECAR_CONTAINER_NAME}' did not become healthy: ${health.error}`);
      }

      // The sidecar may now boot from any of several images (issue #2154), so
      // the version floor is enforced against what the process actually reports
      // rather than assumed from the tag. A too-old binary would answer /health
      // and then fail on the agent-mode API the tasks depend on.
      const reportedVersion = health.health?.version ?? null;
      if (reportedVersion && !isFormalAiVersionAtLeast(reportedVersion, FORMAL_AI_MINIMUM_VERSION)) {
        throw new Error(`Formal AI sidecar image ${imageReference} (${resolved.source}) runs formal-ai ${reportedVersion}, but Hive Mind requires >= ${FORMAL_AI_MINIMUM_VERSION}. Rebuild or repin the image (HIVE_MIND_FORMAL_AI_IMAGE) before running Formal AI tasks.`);
      }

      const address = await readFormalAiSidecarAddress({ run, timeoutMs });
      const acquiredAt = now().toISOString();
      const nextLeases = [...leases.filter(lease => lease.sessionId !== sessionId), { sessionId, tool, model, acquiredAt }];
      // The provenance of what is *actually serving* this lease, so a task's
      // evidence can name the release that answered its requests rather than
      // whatever binary happens to sit next to the wrapper (issue #2208).
      const serving = {
        image: imageReference,
        imageDigest: container.imageDigest ?? resolved.digest ?? null,
        imageSource: resolved.source,
        version: reportedVersion,
        memorySchemaVersion: health.health?.memory?.schema_version ?? null,
        acceptedAt: accepted?.updatedAt ?? null,
        observedAt: acquiredAt,
      };
      writeFormalAiSidecarState({ ...state, image: container.image || image, imageReference, imageDigest: container.imageDigest, startedAt: state.startedAt || acquiredAt, leases: nextLeases, serving }, { env, fsImpl });

      if (verbose && log) await log(`[VERBOSE] formal-ai-sidecar: lease '${sessionId}' acquired (${nextLeases.length} active), image=${imageReference} (${resolved.source}), digest=${container.imageDigest ?? 'unknown'}, address=${address ?? 'unknown'}, formal-ai=${reportedVersion ?? 'unknown'}, memory schema=${serving.memorySchemaVersion ?? 'unknown'}`);

      return {
        address,
        baseUrl: address ? buildFormalAiSidecarBaseUrl(address) : resolveFormalAiSidecarBaseUrl(),
        dnsBaseUrl: resolveFormalAiSidecarBaseUrl(),
        network: FORMAL_AI_SIDECAR_NETWORK_NAME,
        networkAlias: FORMAL_AI_SIDECAR_NETWORK_ALIAS,
        containerName: FORMAL_AI_SIDECAR_CONTAINER_NAME,
        memoryVolume: FORMAL_AI_MEMORY_VOLUME_NAME,
        image: container.image || image,
        imageReference,
        imageSource: resolved.source,
        imageDigest: serving.imageDigest,
        acceptedImage: accepted?.image ?? null,
        acceptedDigest: accepted?.digest ?? null,
        acceptedVersion: accepted?.version ?? null,
        servingVersion: reportedVersion,
        memorySchemaVersion: serving.memorySchemaVersion,
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
  return attachDockerNetwork({ network: FORMAL_AI_SIDECAR_NETWORK_NAME, container: sessionId, run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });
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
  readAcceptedFormalAiImage,
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
