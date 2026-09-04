/**
 * Lifecycle of the `hive-mind-router` sidecar (issue #2164, EXPERIMENTAL).
 *
 * `router-isolation.lib.mjs` decides what a routed task should see. This module
 * makes that true: it starts one Link.Assistant Router container, mounts the
 * operator's vendor credentials into it and nowhere else, mints one scoped
 * `la_sk_…` token per task, and stops the container once the last task that
 * needed it has finished.
 *
 * Two properties drive the design and are worth stating outright:
 *
 * 1. **The sidecar keeps its default bridge.** Unlike the Formal AI sidecar,
 *    which only ever talks to tasks, this container must reach api.anthropic.com
 *    and api.github.com. A single `docker run --network hive-mind-router` would
 *    *replace* the bridge with an `--internal` network and leave the router with
 *    no upstream, so the internal network is attached afterwards instead.
 * 2. **`TOKEN_SECRET` never leaves this process.** It signs every token, so
 *    anyone holding it can mint subscription access — upstream states it plainly:
 *    "Keep it out of the environment of the tasks themselves." It is generated
 *    once, persisted in a mode-0600 state file, and passed only to the router.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 * @see https://github.com/link-assistant/router
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { attachDockerNetwork, DEFAULT_IMAGE_TIMEOUT_MS, dockerOk, dockerText, ensureDockerVolume, ensureInternalDockerNetwork, inspectDockerContainer, readDockerImageDigest, readSidecarState, reconcileSidecarLeases, resolveSidecarStatePath, sleep, writeSidecarState } from './docker-sidecar.lib.mjs';
import { drainTaskSessionData } from './router-session-drain.lib.mjs';
import { buildRouterTaskWiringScript, getInternalRouterBaseUrl, resolveRouterBaseUrl, resolveRouterDialect, resolveRouterSidecarImage, ROUTER_CREDENTIAL_MOUNTS, ROUTER_DATA_MOUNT, ROUTER_DATA_VOLUME_NAME, ROUTER_GH_CONFIG_MOUNT, ROUTER_SIDECAR_CONTAINER_NAME, ROUTER_SIDECAR_LABEL, ROUTER_SIDECAR_NETWORK_ALIAS, ROUTER_SIDECAR_NETWORK_NAME, ROUTER_SIDECAR_PORT, ROUTER_TLS_DNS_NAMES } from './router-isolation.lib.mjs';
import { withStateLock } from './state-lock.lib.mjs';

const execFileAsync = promisify(execFile);

const LOG_PREFIX = 'router-sidecar';
const STATE_FILE_NAME = 'router-sidecar.json';
const SIDECAR_LOCK_NAME = 'router-sidecar';
const DEFAULT_HEALTH_ATTEMPTS = 60;
/** HOME inside the isolation image; the wiring script writes under it. */
const TASK_CONTAINER_HOME = '/home/box';
const DEFAULT_HEALTH_DELAY_MS = 1000;

/**
 * Default limits stamped onto every task token.
 *
 * A TTL is the crash backstop: if Hive Mind dies before it can revoke, the token
 * stops working on its own. The request cap is deliberately generous — it exists
 * to bound a runaway loop, not to interrupt legitimate work.
 */
export const ROUTER_TOKEN_TTL_HOURS = 24;
export const ROUTER_TOKEN_MAX_REQUESTS = 5000;

const EMPTY_STATE = Object.freeze({ version: 1, image: null, imageDigest: null, startedAt: null, leases: [], tokenSecret: null, lastUpdate: null });

/** Is Hive Mind allowed to manage the router container itself? */
export const isRouterSidecarEnabled = (env = process.env) => {
  const raw = String(env?.HIVE_MIND_ROUTER_SIDECAR || '')
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
};

// Image resolution and the route dialect derived from it now live in
// router-isolation.lib.mjs, the leaf both this module and the task wiring
// import (issue #2202). Re-exported so callers keep their import site.
export { resolveRouterDialect, resolveRouterSidecarImage };

export const resolveRouterSidecarStatePath = (env = process.env) => resolveSidecarStatePath(STATE_FILE_NAME, env);

export const readRouterSidecarState = ({ env = process.env, fsImpl = fs } = {}) => readSidecarState({ fileName: STATE_FILE_NAME, emptyState: EMPTY_STATE, env, fsImpl });

/** Persisted with mode 0600: this record holds the token-signing secret. */
export const writeRouterSidecarState = (state, { env = process.env, fsImpl = fs } = {}) => writeSidecarState(state, { fileName: STATE_FILE_NAME, env, fsImpl, mode: 0o600 });

export const withRouterSidecarLock = (fn, options = {}) => withStateLock(SIDECAR_LOCK_NAME, fn, options);

/**
 * The signing secret, generated once and reused.
 *
 * It must survive a sidecar restart: tokens already handed to running tasks were
 * signed with it, and a fresh secret would invalidate every one of them mid-run.
 * `HIVE_MIND_ROUTER_TOKEN_SECRET` lets an operator supply their own.
 */
export const resolveRouterTokenSecret = ({ state, env = process.env, generate = () => crypto.randomBytes(32).toString('hex') } = {}) => {
  const fromEnv = String(env?.HIVE_MIND_ROUTER_TOKEN_SECRET || '').trim();
  if (fromEnv) return { secret: fromEnv, generated: false };
  if (state?.tokenSecret) return { secret: state.tokenSecret, generated: false };
  return { secret: generate(), generated: true };
};

/**
 * Credential directories to mount into the sidecar, with the env var the router
 * reads each from.
 *
 * `~/.config/gh` is included: the router presents the operator's GitHub token
 * upstream so a routed task never holds one (R12), and it finds that token the
 * same way gh does, through `GH_CONFIG_DIR`.
 */
export const getRouterCredentialMounts = ({ homeDir = os.homedir(), existsSync = fs.existsSync } = {}) => [...ROUTER_CREDENTIAL_MOUNTS, ROUTER_GH_CONFIG_MOUNT].map(mount => ({ ...mount, source: path.join(homeDir, ...mount.home.split('/')) })).filter(mount => existsSync(mount.source));

/** Does the sidecar hold a vendor credential, as opposed to only a GitHub one? */
const hasVendorCredential = mounts => mounts.some(mount => mount.envVar !== ROUTER_GH_CONFIG_MOUNT.envVar);

/**
 * Build the `docker run` argv for the sidecar.
 *
 * The credential mounts are intentionally **not** `:ro`. Vendor OAuth
 * credentials are refresh tokens: the CLI rewrites them when they expire, and a
 * read-only mount would silently discard every rotation, leaving the operator
 * with credentials that stop working the moment the current access token lapses.
 */
export const buildRouterSidecarRunArgs = ({ image, tokenSecret, credentialMounts = [], containerName = ROUTER_SIDECAR_CONTAINER_NAME, env = process.env } = {}) => {
  const args = ['run', '--detach', '--name', containerName, '--label', `${ROUTER_SIDECAR_LABEL}=sidecar`, '--restart', 'no'];

  // No `--network` here: see the module header. The internal network is attached
  // after creation so the default bridge, and with it the route to the vendor
  // APIs the router exists to reach, survives.

  args.push('--env', `ROUTER_PORT=${ROUTER_SIDECAR_PORT}`, '--env', `TOKEN_SECRET=${tokenSecret}`, '--env', `DATA_DIR=${ROUTER_DATA_MOUNT}`, '--env', `AUDIT_LOG=${ROUTER_DATA_MOUNT}/audit.jsonl`);

  // TLS is not optional here: `gh` refuses a plaintext host, so an HTTP router
  // could never mediate GitHub traffic. The certificate names api.github.com as
  // well as the alias, which is what lets an unmodified `gh` inside a task be
  // redirected by /etc/hosts and still verify the connection.
  args.push('--env', 'TLS_SELF_SIGNED=1', '--env', `TLS_SELF_SIGNED_DNS=${ROUTER_TLS_DNS_NAMES}`);

  // R8: one named volume holds every request log and the token store, so the
  // audit trail outlives the container it was produced by.
  args.push('--volume', `${ROUTER_DATA_VOLUME_NAME}:${ROUTER_DATA_MOUNT}`);

  for (const mount of credentialMounts) {
    args.push('--env', `${mount.envVar}=${mount.target}`, '--volume', `${mount.source}:${mount.target}${mount.readOnly ? ':ro' : ''}`);
  }

  // The ChatGPT backend gates its newest models behind a recent client version,
  // and answers `Model not found` for them when the header is absent — which is
  // why the pin is at or above 0.120.0, where the router started sending one.
  // Its bundled default tracks a recent Codex CLI, so it is deliberately left
  // alone by default: forwarding whatever `codex` happens to be installed here
  // could send an *older* version than the router already claims and re-gate the
  // models this pin exists to reach. An operator who needs a specific one sets
  // CODEX_CLIENT_VERSION and it is passed straight through.
  const codexClientVersion = String(env?.CODEX_CLIENT_VERSION || '').trim();
  if (codexClientVersion) args.push('--env', `CODEX_CLIENT_VERSION=${codexClientVersion}`);

  const extraArgs = String(env?.HIVE_MIND_ROUTER_EXTRA_ARGS || '').trim();
  if (extraArgs) args.push(...extraArgs.split(/\s+/));

  args.push(image, 'serve', '--host', '0.0.0.0', '--port', String(ROUTER_SIDECAR_PORT));
  // No `-p`: the endpoint is reachable only from the internal network.
  return args;
};

/**
 * Probe the router's `/health`.
 *
 * The Formal AI sidecar shells out to `curl`; the router's runtime image is
 * `debian:trixie-slim` plus `ca-certificates` and has no curl. It does ship
 * `bun`, which is used here as the HTTP client instead of adding a dependency to
 * an image Hive Mind does not own.
 */
export const checkRouterSidecarHealth = async ({ containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs = 30_000, env = process.env, dialect = null } = {}) => {
  // /health on router 0.x, /api/health on 1.x — and a 404 either way if the
  // wrong one is asked for, which would read as "unhealthy" and stall the
  // acquire loop until it gave up (issue #2202).
  const healthPath = (dialect || resolveRouterDialect({ env }).dialect).health;
  const probe = `fetch("https://127.0.0.1:${ROUTER_SIDECAR_PORT}${healthPath}").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))`;
  // The certificate names the alias, not 127.0.0.1, and this probe is a
  // liveness check on a loopback socket inside the container — there is no
  // network for anyone to sit in the middle of. Verification is disabled for
  // this one call rather than shipping the CA back into the router's own image.
  return dockerOk(run, ['exec', '--env', 'NODE_TLS_REJECT_UNAUTHORIZED=0', containerName, 'bun', '-e', probe], { timeoutMs });
};

export const waitForRouterSidecarHealth = async ({ containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, attempts = DEFAULT_HEALTH_ATTEMPTS, delayMs = DEFAULT_HEALTH_DELAY_MS, sleepImpl = sleep, log = null, verbose = false, env = process.env, dialect = null } = {}) => {
  // Resolved once rather than per attempt: the answer cannot change between
  // them, and probing the wrong path would fail every attempt identically.
  const routes = dialect || resolveRouterDialect({ env }).dialect;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await checkRouterSidecarHealth({ containerName, run, env, dialect: routes })) {
      if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: healthy after ${attempt} attempt(s)`);
      return { healthy: true, attempts: attempt };
    }
    if (attempt < attempts) await sleepImpl(delayMs);
  }
  if (log) await log(`⚠️ Router sidecar did not become healthy after ${attempts} attempt(s)`);
  return { healthy: false, attempts };
};

/**
 * Recover a token's id from the token itself.
 *
 * The router mints `la_sk_<jwt>` whose `sub` claim *is* the token id, and the
 * payload is plain base64url — readable without the signing secret. Reading it
 * here avoids parsing the fixed-width `router tokens list` table, whose column
 * layout is a display detail rather than an interface.
 *
 * @returns {string|null}
 */
export const decodeRouterTokenId = token => {
  const raw = String(token || '').trim();
  if (!raw.startsWith('la_sk_')) return null;
  const segments = raw.slice('la_sk_'.length).split('.');
  if (segments.length < 2) return null;
  try {
    const claims = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
    return typeof claims?.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
};

/**
 * Mint one token for one task.
 *
 * R6: every task gets its own, so each has its own request log and its own
 * budget. Upstream is explicit that sharing breaks attribution: "Never share one
 * token between two tasks."
 *
 * @returns {Promise<{token: string|null, tokenId: string|null, error: string|null}>}
 */
export const issueRouterTaskToken = async ({ sessionId, containerName = ROUTER_SIDECAR_CONTAINER_NAME, ttlHours = ROUTER_TOKEN_TTL_HOURS, maxRequests = ROUTER_TOKEN_MAX_REQUESTS, githubRepo = null, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (!sessionId) return { token: null, tokenId: null, error: 'no sessionId' };
  const issueArgs = ['exec', containerName, 'router', 'tokens', 'issue', '--label', `hive-mind:${sessionId}`, '--ttl-hours', String(ttlHours)];
  if (maxRequests) issueArgs.push('--max-requests', String(maxRequests));
  // Confining the token to one repository is enforced by the router itself: a
  // call about any other repository is refused with "outside this token's
  // repositories", for the git transport as well as the REST surface.
  if (githubRepo) issueArgs.push('--github-repo', githubRepo);
  try {
    // `tokens issue` prints the token and nothing else on stdout.
    const token = await dockerText(run, issueArgs, { timeoutMs });
    if (!token.startsWith('la_sk_')) return { token: null, tokenId: null, error: `unexpected token format from router: ${token.slice(0, 24)}…` };
    const tokenId = decodeRouterTokenId(token);
    if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: issued token ${tokenId || '(id unknown)'} for '${sessionId}'`);
    return { token, tokenId, error: null };
  } catch (error) {
    return { token: null, tokenId: null, error: error?.stderr?.toString?.().trim() || error?.message || String(error) };
  }
};

/**
 * Revoke a task's token.
 *
 * Best-effort by design: the token's TTL is the guarantee, this is the prompt
 * cleanup. A failure is logged and never propagated, because a task must still
 * be able to finish when the router has already gone away.
 */
export const revokeRouterTaskToken = async ({ tokenId, containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (!tokenId) return { revoked: false };
  const revoked = await dockerOk(run, ['exec', containerName, 'router', 'tokens', 'revoke', tokenId], { timeoutMs });
  if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: revoke ${tokenId} → ${revoked ? 'ok' : 'failed (token still expires on its own)'}`);
  return { revoked };
};

/**
 * Close out a lease whose task has ended.
 *
 * Order matters: the session data is copied out of the task container while the
 * router is still up to receive it, and only then is the token revoked. Both
 * steps are best-effort and neither can keep a dead lease alive.
 */
export const finalizeEndedLease = async ({ lease, env = process.env, run = execFileAsync, timeoutMs, log = null, verbose = false, drain = drainTaskSessionData } = {}) => {
  const drained = await drain({ sessionId: lease?.sessionId, env, run, timeoutMs, log, verbose });
  if (drained?.error && log) await log(`⚠️ Could not archive session data for '${lease?.sessionId}': ${drained.error}`);
  const revoked = await revokeRouterTaskToken({ tokenId: lease?.tokenId, run, timeoutMs, log, verbose });
  return { drained, ...revoked };
};

/** Re-derive the sidecar record from Docker, revoking the tokens of leases that died. */
export const reconcileRouterSidecar = async ({ env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  const state = readRouterSidecarState({ env, fsImpl });
  const leases = await reconcileSidecarLeases(state.leases, {
    run,
    timeoutMs,
    log,
    verbose,
    logPrefix: LOG_PREFIX,
    onDropped: lease => finalizeEndedLease({ lease, env, run, timeoutMs, log, verbose }),
  });
  const container = await inspectDockerContainer(ROUTER_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
  const next = {
    ...state,
    leases,
    image: container.exists ? container.image : state.image,
    imageDigest: container.exists ? container.imageDigest : state.imageDigest,
    startedAt: container.running ? state.startedAt : null,
  };
  writeRouterSidecarState(next, { env, fsImpl });
  return { state: next, container, leaseCount: leases.length };
};

/**
 * Stop and remove the sidecar and its network.
 *
 * The data volume is deliberately left in place: it is the audit trail (R8), and
 * the point of the feature is that it outlives the tasks it recorded.
 */
export const stopRouterSidecar = async ({ env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false, reason = 'idle' } = {}) => {
  const container = await inspectDockerContainer(ROUTER_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
  if (container.exists) {
    await dockerOk(run, ['stop', ROUTER_SIDECAR_CONTAINER_NAME], { timeoutMs });
    await dockerOk(run, ['rm', '--force', ROUTER_SIDECAR_CONTAINER_NAME], { timeoutMs });
  }
  await dockerOk(run, ['network', 'rm', ROUTER_SIDECAR_NETWORK_NAME], { timeoutMs });

  const state = readRouterSidecarState({ env, fsImpl });
  writeRouterSidecarState({ ...state, startedAt: null, leases: [] }, { env, fsImpl });
  if (log) await log(`🛑 Router sidecar stopped (${reason}); data volume '${ROUTER_DATA_VOLUME_NAME}' preserved for audit`);
  if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: removed container=${container.exists} network='${ROUTER_SIDECAR_NETWORK_NAME}'`);
  return { stopped: container.exists };
};

/**
 * Ensure a healthy sidecar exists, then mint this task's token.
 *
 * Must run *before* the task container's command is released by the start gate,
 * because the token and endpoint are part of the environment that container is
 * created with.
 *
 * @returns {Promise<{baseUrl: string|null, token: string|null, tokenId: string|null, leaseCount: number, external: boolean, error: string|null}>}
 */
export const acquireRouterSidecar = async ({ sessionId, githubRepo = null, env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, imageTimeoutMs = DEFAULT_IMAGE_TIMEOUT_MS, homeDir = os.homedir(), existsSync = fs.existsSync, log = null, verbose = false, now = () => new Date(), healthAttempts, healthDelayMs, sleepImpl = sleep, lockOptions = {} } = {}) => {
  if (!sessionId) throw new Error('acquireRouterSidecar requires a sessionId');

  const endpoint = resolveRouterBaseUrl({ env });
  if (endpoint.error) return { baseUrl: null, token: null, tokenId: null, leaseCount: 0, external: true, error: endpoint.error };
  if (endpoint.external) {
    // An operator-run router is not ours to start, and we hold no admin
    // credential for it, so the token has to be supplied alongside the URL.
    const token = String(env?.HIVE_MIND_ROUTER_TOKEN || '').trim();
    if (!token) return { baseUrl: null, token: null, tokenId: null, leaseCount: 0, external: true, error: 'HIVE_MIND_ROUTER_URL is set but HIVE_MIND_ROUTER_TOKEN is empty; an external router must be given a token to use' };
    if (log) await log('⚠️ Using an external router: the token is shared by every task, so per-task attribution (issue #2164, R6) does not apply');
    return { baseUrl: endpoint.baseUrl, token, tokenId: decodeRouterTokenId(token), leaseCount: 0, external: true, error: null };
  }

  if (!isRouterSidecarEnabled(env)) {
    return { baseUrl: null, token: null, tokenId: null, leaseCount: 0, external: false, error: 'HIVE_MIND_ROUTER_SIDECAR is disabled but no HIVE_MIND_ROUTER_URL was provided' };
  }

  return withRouterSidecarLock(async () => {
    const image = resolveRouterSidecarImage(env);

    await ensureInternalDockerNetwork({ name: ROUTER_SIDECAR_NETWORK_NAME, label: ROUTER_SIDECAR_LABEL, run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });
    await ensureDockerVolume({ name: ROUTER_DATA_VOLUME_NAME, label: ROUTER_SIDECAR_LABEL, role: 'data', run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });

    const reconciled = await reconcileRouterSidecar({ env, fsImpl, run, timeoutMs, log, verbose });
    const state = reconciled.state;
    const { secret: tokenSecret } = resolveRouterTokenSecret({ state, env });

    let container = reconciled.container;
    let startedAt = state.startedAt;

    if (!container.running) {
      if (container.exists) await dockerOk(run, ['rm', '--force', ROUTER_SIDECAR_CONTAINER_NAME], { timeoutMs });
      if (!(await readDockerImageDigest(image, { run, timeoutMs }))) {
        if (log) await log(`📦 Pulling router image ${image}…`);
        if (!(await dockerOk(run, ['pull', image], { timeoutMs: imageTimeoutMs }))) {
          return { baseUrl: null, token: null, tokenId: null, leaseCount: state.leases.length, external: false, error: `could not pull router image ${image}` };
        }
      }

      const credentialMounts = getRouterCredentialMounts({ homeDir, existsSync });
      // A GitHub credential alone would leave the router with nothing to answer
      // a model request with, so it does not count towards this check.
      if (!hasVendorCredential(credentialMounts)) {
        return { baseUrl: null, token: null, tokenId: null, leaseCount: state.leases.length, external: false, error: 'no vendor credential directory found to mount into the router (looked for ~/.claude, ~/.codex, ~/.gemini, ~/.qwen)' };
      }

      try {
        await dockerText(run, buildRouterSidecarRunArgs({ image, tokenSecret, credentialMounts, env }), { timeoutMs });
      } catch (error) {
        return { baseUrl: null, token: null, tokenId: null, leaseCount: state.leases.length, external: false, error: error?.stderr?.toString?.().trim() || error?.message || String(error) };
      }
      startedAt = now().toISOString();
      if (log) await log(`🔀 Router sidecar started with ${credentialMounts.length} credential mount(s); tasks will not receive vendor credentials directly`);
    }

    // Additive, and a no-op when already attached — so it is safe on every
    // acquire, including the ones that reuse a running container.
    await attachDockerNetwork({ network: ROUTER_SIDECAR_NETWORK_NAME, container: ROUTER_SIDECAR_CONTAINER_NAME, alias: ROUTER_SIDECAR_NETWORK_ALIAS, run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });

    const health = await waitForRouterSidecarHealth({ run, attempts: healthAttempts, delayMs: healthDelayMs, sleepImpl, log, verbose, env });
    if (!health.healthy) {
      return { baseUrl: null, token: null, tokenId: null, leaseCount: state.leases.length, external: false, error: 'router sidecar did not become healthy' };
    }

    const issued = await issueRouterTaskToken({ sessionId, githubRepo, run, timeoutMs, log, verbose });
    if (issued.error || !issued.token) {
      return { baseUrl: null, token: null, tokenId: null, leaseCount: state.leases.length, external: false, error: issued.error || 'router issued no token' };
    }

    container = await inspectDockerContainer(ROUTER_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
    const leases = [...state.leases.filter(lease => lease.sessionId !== sessionId), { sessionId, tokenId: issued.tokenId, acquiredAt: now().toISOString(), containerSeen: false }];
    writeRouterSidecarState({ ...state, leases, tokenSecret, startedAt, image: container.image, imageDigest: container.imageDigest, lastUpdate: now().toISOString() }, { env, fsImpl });

    return { baseUrl: getInternalRouterBaseUrl(), token: issued.token, tokenId: issued.tokenId, leaseCount: leases.length, external: false, error: null };
  }, lockOptions);
};

/**
 * The router's self-signed CA, as PEM.
 *
 * Generated on first start and kept in the data volume, so it survives a
 * restart and every task in a fleet trusts the same authority.
 *
 * @returns {Promise<string|null>} null when the router has no TLS CA to print
 */
export const readRouterCaCertificate = async ({ containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs } = {}) => {
  try {
    const pem = await dockerText(run, ['exec', containerName, 'router', 'tls', 'ca'], { timeoutMs });
    return pem.includes('BEGIN CERTIFICATE') ? pem : null;
  } catch {
    return null;
  }
};

/**
 * The sidecar's address on the internal network.
 *
 * Needed because the interception is by name: the task's `/etc/hosts` has to
 * name an address, and the alias it would otherwise resolve through is exactly
 * what must not be attached to the router (see router-isolation.lib.mjs).
 *
 * @returns {Promise<string|null>}
 */
export const readRouterNetworkIp = async ({ containerName = ROUTER_SIDECAR_CONTAINER_NAME, network = ROUTER_SIDECAR_NETWORK_NAME, run = execFileAsync, timeoutMs } = {}) => {
  try {
    const address = await dockerText(run, ['inspect', '--format', `{{ with index .NetworkSettings.Networks "${network}" }}{{ .IPAddress }}{{ end }}`, containerName], { timeoutMs });
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(address) ? address : null;
  } catch {
    return null;
  }
};

/**
 * Store an upstream provider in the router (R11).
 *
 * Idempotent in practice: re-adding the same name overwrites the entry, so an
 * acquire that reuses a running sidecar can call this unconditionally.
 *
 * @returns {Promise<{registered: boolean, error: string|null}>}
 */
export const registerRouterProvider = async ({ providerArgs, containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (!providerArgs?.length) return { registered: false, error: 'no provider arguments' };
  try {
    // `docker exec` bypasses the image entrypoint, so the binary is named again.
    await dockerText(run, ['exec', containerName, 'router', ...providerArgs], { timeoutMs });
  } catch (error) {
    return { registered: false, error: error?.stderr?.toString?.().trim() || error?.message || String(error) };
  }
  if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: registered provider '${providerArgs[providerArgs.indexOf('--name') + 1]}'`);
  return { registered: true, error: null };
};

/**
 * Put the router itself on another sidecar's internal network.
 *
 * Needed for R11: the router has to be able to resolve
 * `link-assistant-formal-ai` before it can forward anything to it. No alias is
 * requested — nothing on that network calls the router by name.
 */
export const attachRouterToNetwork = async ({ network, containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (!network) return { attached: false, error: 'no network' };
  return attachDockerNetwork({ network, container: containerName, run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });
};

/** Attach a task container to the router network so it can resolve the alias. */
export const attachTaskToRouterNetwork = async ({ sessionId, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (!sessionId) return { attached: false, error: 'no sessionId' };
  return attachDockerNetwork({ network: ROUTER_SIDECAR_NETWORK_NAME, container: sessionId, run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX });
};

/**
 * Finish wiring a task container: trust the router's CA, resolve
 * `api.github.com` to it, and (for codex) write the provider entry that points
 * the CLI at it.
 *
 * This runs as root through `docker exec` while the start gate still holds the
 * task command, because none of it can be expressed as a `docker run` flag
 * start-command forwards, and the CA does not exist until the router has
 * started. Failure is reported rather than swallowed: a task that does not
 * trust the CA cannot reach any model, so the caller stops it (fail closed).
 *
 * @returns {Promise<{wired: boolean, error: string|null}>}
 */
export const wireRouterTaskContainer = async ({ sessionId, tool = 'claude', baseUrl = getInternalRouterBaseUrl(), githubMode = 'transparent', homeDir = TASK_CONTAINER_HOME, containerName = ROUTER_SIDECAR_CONTAINER_NAME, run = execFileAsync, timeoutMs, log = null, verbose = false } = {}) => {
  if (!sessionId) return { wired: false, error: 'no sessionId' };
  const caCertificate = await readRouterCaCertificate({ containerName, run, timeoutMs });
  if (!caCertificate) return { wired: false, error: 'the router printed no TLS CA (`router tls ca`), so the task could not be given anything to trust' };
  const routerIp = githubMode === 'transparent' ? await readRouterNetworkIp({ containerName, run, timeoutMs }) : null;
  if (githubMode === 'transparent' && !routerIp) return { wired: false, error: `the router has no address on '${ROUTER_SIDECAR_NETWORK_NAME}', so api.github.com could not be pointed at it` };
  const script = buildRouterTaskWiringScript({ routerIp, caCertificate, homeDir, tool, baseUrl, githubMode });
  try {
    await dockerText(run, ['exec', '--user', '0', sessionId, 'sh', '-c', script], { timeoutMs });
  } catch (error) {
    return { wired: false, error: error?.stderr?.toString?.().trim() || error?.message || String(error) };
  }
  if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: wired '${sessionId}' (CA installed, github=${githubMode}${routerIp ? ` via ${routerIp}` : ''})`);
  return { wired: true, error: null };
};

/**
 * Revoke this task's token, drop its lease, and stop the sidecar when it was the
 * last one (R5).
 *
 * @returns {Promise<{leaseCount: number, stopped: boolean}>}
 */
export const releaseRouterSidecar = async ({ sessionId, env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, log = null, verbose = false, lockOptions = {} } = {}) => {
  if (!isRouterSidecarEnabled(env) || resolveRouterBaseUrl({ env }).external) return { leaseCount: 0, stopped: false };

  return withRouterSidecarLock(async () => {
    const state = readRouterSidecarState({ env, fsImpl });
    const released = state.leases.find(lease => lease.sessionId === sessionId);
    if (released) await finalizeEndedLease({ lease: released, env, run, timeoutMs, log, verbose });

    const remaining = await reconcileSidecarLeases(
      state.leases.filter(lease => lease.sessionId !== sessionId),
      { run, timeoutMs, log, verbose, logPrefix: LOG_PREFIX, onDropped: lease => finalizeEndedLease({ lease, env, run, timeoutMs, log, verbose }) }
    );
    writeRouterSidecarState({ ...state, leases: remaining }, { env, fsImpl });

    if (remaining.length > 0) {
      if (verbose && log) await log(`[VERBOSE] ${LOG_PREFIX}: '${sessionId}' released; ${remaining.length} lease(s) still hold the sidecar up`);
      return { leaseCount: remaining.length, stopped: false };
    }

    const { stopped } = await stopRouterSidecar({ env, fsImpl, run, timeoutMs, log, verbose, reason: 'last task finished' });
    return { leaseCount: 0, stopped };
  }, lockOptions);
};
