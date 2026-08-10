/**
 * Idle-only Formal AI image updates with non-destructive memory migration
 * (issue #2146, PR #2147 review).
 *
 * The maintainer asked for three things this module owns:
 *
 *   - "Auto update formal-ai docker container when no formal-ai tasks running."
 *   - "When stopped and new version available update to latest."
 *   - "In hive mind docker only initial version of formal-ai should be pinned."
 *
 * The safety property that makes an unattended update acceptable is Formal AI
 * 0.336.0's persisted-memory upgrade contract (formal-ai#982). Every update
 * follows the same sequence upstream validates in its own container fixture:
 *
 *   pull → compare digests → preflight (`memory upgrade-status`, side-effect
 *   free) → `memory migrate --backup --receipt` → boot the new image and
 *   assert `/health` reports compatible memory → stop again.
 *
 * If any step after the migration fails, the byte-exact backup named in the
 * receipt is restored, its SHA-256 is compared against `original_sha256`, and
 * the previous image stays in service. An update therefore either completes or
 * leaves memory exactly as it was; it can never half-migrate.
 *
 * The sidecar is left *stopped* on success, because "stop the container when no
 * formal-ai tasks are running" still applies — the boot is a verification step,
 * not a deployment.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-assistant/formal-ai/issues/982
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

import { FORMAL_AI_IMAGE_REPOSITORY, FORMAL_AI_MEMORY_MOUNT, FORMAL_AI_MEMORY_PATH, FORMAL_AI_MEMORY_VOLUME_NAME, FORMAL_AI_SIDECAR_CONTAINER_NAME, buildFormalAiSidecarRunArgs, ensureFormalAiMemoryVolume, ensureFormalAiNetwork, inspectDockerContainer, readDockerImageDigest, readFormalAiSidecarState, reconcileFormalAiSidecar, stopFormalAiSidecar, waitForFormalAiSidecarHealth, withFormalAiSidecarLock, writeFormalAiSidecarState } from './formal-ai-sidecar.lib.mjs';

const execFileAsync = promisify(execFile);

const DEFAULT_DOCKER_TIMEOUT_MS = 120_000;
const DEFAULT_PULL_TIMEOUT_MS = 30 * 60 * 1000;

/** The moving tag every Formal AI release publishes alongside its bare version. */
export const FORMAL_AI_UPDATE_TAG = 'latest';

/**
 * Resolve the image an update pulls.
 *
 * `HIVE_MIND_FORMAL_AI_IMAGE` is an operator pin — a deliberate choice of a
 * specific build — so it disables auto-update rather than being silently
 * overwritten.
 */
export const resolveFormalAiUpdateImage = (env = process.env) => `${FORMAL_AI_IMAGE_REPOSITORY}:${String(env.HIVE_MIND_FORMAL_AI_UPDATE_TAG || '').trim() || FORMAL_AI_UPDATE_TAG}`;

/** Auto-update is on by default and off when the operator pinned an image or opted out. */
export const isFormalAiAutoUpdateEnabled = (env = process.env) => {
  if (String(env.HIVE_MIND_FORMAL_AI_IMAGE || '').trim()) return false;
  const raw = String(env.HIVE_MIND_FORMAL_AI_AUTO_UPDATE ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  return !['0', 'false', 'no', 'off'].includes(raw);
};

/**
 * Extract the first JSON object in a command's output.
 *
 * The published image's DinD entrypoint can print its own banner before the
 * command runs, so the payload is not always the whole of stdout.
 */
export const parseJsonBlock = text => {
  const raw = String(text ?? '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error(`Expected a JSON object in Formal AI output but found none: ${raw.slice(0, 400)}`);
  return JSON.parse(raw.slice(start, end + 1));
};

/** `parseJsonBlock` for output that is allowed to contain no JSON at all. */
export const tryParseJsonBlock = text => {
  try {
    return parseJsonBlock(text);
  } catch {
    return null;
  }
};

/**
 * Human-readable one-liner for the two refusal shapes the memory CLI prints:
 * an upgrade status with `refusal_code`/`refusal_reason`, and a migration
 * error object with `code`/`message`.
 */
export const describeMemoryRefusal = payload => {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.error?.code || payload.error?.message) return `${payload.error.code ?? 'error'}: ${payload.error.message ?? 'no message given'}`;
  if (payload.refusal_code || payload.refusal_reason) return `${payload.refusal_code ?? 'incompatible'}: ${payload.refusal_reason ?? 'no reason given'}`;
  return null;
};

const dockerText = async (run, args, { timeoutMs = DEFAULT_DOCKER_TIMEOUT_MS } = {}) => {
  const result = await run('docker', args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return String(result?.stdout ?? '').trim();
};

/**
 * Run one `formal-ai memory …` subcommand against the persisted-memory volume
 * using a throwaway container of the given image.
 *
 * The inner Docker daemon is skipped (`DIND_SKIP_DAEMON=1`) and the image's own
 * entrypoint is kept, so the command runs as `box` and can read the volume.
 */
export const runFormalAiMemoryCommand = async (image, memoryArgs, { run = execFileAsync, timeoutMs } = {}) => {
  const args = ['run', '--rm', '--env', 'DIND_SKIP_DAEMON=1', '--env', `FORMAL_AI_MEMORY_PATH=${FORMAL_AI_MEMORY_PATH}`, '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`, image, 'formal-ai', 'memory', ...memoryArgs];
  try {
    return parseJsonBlock(await dockerText(run, args, { timeoutMs }));
  } catch (error) {
    // A refusal is *also* a documented answer: `memory upgrade-status` and
    // `memory migrate` print their JSON on stdout and only then exit nonzero.
    // Re-throwing the bare process error would discard the refusal code the
    // operator needs, so the payload travels with the failure.
    const payload = tryParseJsonBlock(error?.stdout);
    if (!payload) throw error;
    const failure = new Error(describeMemoryRefusal(payload) || error?.message || 'Formal AI refused the persisted memory');
    failure.payload = payload;
    throw failure;
  }
};

/** Byte-exact SHA-256 of a file inside the memory volume, or null when it is absent. */
export const readMemoryFileSha256 = async (image, filePath, { run = execFileAsync, timeoutMs } = {}) => {
  try {
    const raw = await dockerText(run, ['run', '--rm', '--entrypoint', 'sha256sum', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`, image, filePath], { timeoutMs });
    return raw.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
};

/**
 * Restore the byte-exact backup recorded in a migration receipt.
 *
 * `cp` + `sync` is the rollback strategy the upgrade contract documents
 * (`rollback_strategy: "restore_backup_path"`). Success is only claimed when
 * the restored file hashes to the receipt's `original_sha256`.
 */
export const rollbackFormalAiMemory = async ({ image, receipt, run = execFileAsync, timeoutMs, log = null } = {}) => {
  const backupPath = receipt?.backup_path;
  if (!backupPath) return { restored: false, verified: false, error: 'the migration receipt named no backup path' };

  const memoryPath = receipt.memory_path || FORMAL_AI_MEMORY_PATH;
  try {
    await dockerText(run, ['run', '--rm', '--entrypoint', 'sh', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`, image, '-c', `cp -- '${backupPath}' '${memoryPath}' && sync`], { timeoutMs });
  } catch (error) {
    return { restored: false, verified: false, error: error?.stderr?.toString?.().trim() || error?.message || String(error) };
  }

  const restoredSha = await readMemoryFileSha256(image, memoryPath, { run, timeoutMs });
  const verified = Boolean(receipt.original_sha256) && restoredSha === receipt.original_sha256;
  if (log) await log(verified ? `↩️ Formal AI memory restored byte-exactly from ${backupPath} (sha256 ${restoredSha})` : `🚨 Formal AI memory rollback could not be verified: expected sha256 ${receipt.original_sha256}, found ${restoredSha}`);
  return { restored: true, verified, sha256: restoredSha, error: verified ? null : 'restored file did not match the receipt SHA-256' };
};

/**
 * Boot the sidecar on `image`, wait for `/health`, then stop it again.
 *
 * This is how an update proves the new binary can actually serve the migrated
 * memory before the change is accepted.
 */
const verifyImageServesMemory = async ({ image, env, fsImpl, run, timeoutMs, log, verbose, sleepImpl, healthAttempts, healthDelayMs }) => {
  await ensureFormalAiNetwork({ run, timeoutMs, log, verbose });
  const existing = await inspectDockerContainer(FORMAL_AI_SIDECAR_CONTAINER_NAME, { run, timeoutMs });
  if (existing.exists) await stopFormalAiSidecar({ env, fsImpl, run, timeoutMs, log: null, verbose, reason: 'verification restart' });

  await dockerText(run, buildFormalAiSidecarRunArgs({ image, env }), { timeoutMs });
  const health = await waitForFormalAiSidecarHealth({ run, attempts: healthAttempts, delayMs: healthDelayMs, sleepImpl, log, verbose });
  const memory = health.health?.memory ?? null;
  const ok = health.healthy && memory?.compatible !== false && memory?.migration_required !== true;
  await stopFormalAiSidecar({ env, fsImpl, run, timeoutMs, log: null, verbose, reason: 'verification complete' });
  return { ok, health: health.health, error: ok ? null : health.error || `memory not ready after update (state=${memory?.migration_state ?? 'unknown'}, required=${memory?.migration_required ?? 'unknown'})` };
};

/**
 * Update the Formal AI sidecar image, but only while no Formal AI task holds a
 * lease.
 *
 * @returns {Promise<{status: 'disabled'|'busy'|'up-to-date'|'updated'|'rolled-back'|'failed', ...}>}
 */
export const updateFormalAiSidecarWhenIdle = async ({ env = process.env, fsImpl = fs, run = execFileAsync, timeoutMs, pullTimeoutMs = DEFAULT_PULL_TIMEOUT_MS, log = null, verbose = false, sleepImpl, healthAttempts, healthDelayMs, now = () => new Date(), lockOptions = {} } = {}) => {
  if (!isFormalAiAutoUpdateEnabled(env)) {
    if (verbose && log) await log('[VERBOSE] formal-ai-updater: auto-update disabled (operator pin or HIVE_MIND_FORMAL_AI_AUTO_UPDATE=0)');
    return { status: 'disabled', reason: String(env.HIVE_MIND_FORMAL_AI_IMAGE || '').trim() ? 'HIVE_MIND_FORMAL_AI_IMAGE pins a specific build' : 'HIVE_MIND_FORMAL_AI_AUTO_UPDATE is off' };
  }

  return withFormalAiSidecarLock(
    async () => {
      const { leaseCount } = await reconcileFormalAiSidecar({ env, fsImpl, run, timeoutMs, log, verbose });
      if (leaseCount > 0) {
        if (verbose && log) await log(`[VERBOSE] formal-ai-updater: ${leaseCount} Formal AI task(s) running; deferring the update`);
        return { status: 'busy', leaseCount };
      }

      const image = resolveFormalAiUpdateImage(env);
      const previousDigest = await readDockerImageDigest(image, { run, timeoutMs });

      if (log) await log(`⬇️ Checking for a newer Formal AI image (${image})`);
      try {
        await dockerText(run, ['pull', '--quiet', image], { timeoutMs: pullTimeoutMs });
      } catch (error) {
        const message = error?.stderr?.toString?.().trim() || error?.message || String(error);
        if (log) await log(`⚠️ Could not pull ${image}; keeping the current Formal AI image: ${message}`);
        return { status: 'failed', stage: 'pull', image, error: message };
      }

      const pulledDigest = await readDockerImageDigest(image, { run, timeoutMs });
      const state = readFormalAiSidecarState({ env, fsImpl });
      const runningDigest = state.imageDigest || previousDigest;
      if (pulledDigest && pulledDigest === runningDigest) {
        if (verbose && log) await log(`[VERBOSE] formal-ai-updater: ${image} already at ${pulledDigest}`);
        return { status: 'up-to-date', image, digest: pulledDigest };
      }

      // Memory must not be touched while a container has it open.
      await stopFormalAiSidecar({ env, fsImpl, run, timeoutMs, log, verbose, reason: 'updating the Formal AI image' });
      await ensureFormalAiMemoryVolume({ image, run, timeoutMs, log, verbose });

      let preflight;
      try {
        preflight = await runFormalAiMemoryCommand(image, ['upgrade-status', '--path', FORMAL_AI_MEMORY_PATH, '--format', 'json'], { run, timeoutMs });
      } catch (error) {
        const message = error?.payload ? error.message : error?.stderr?.toString?.().trim() || error?.message || String(error);
        if (log) await log(`🚨 Formal AI ${image} refused the persisted memory during preflight; keeping ${runningDigest ?? 'the current image'}: ${message}`);
        return { status: 'failed', stage: 'preflight', image, digest: pulledDigest, preflight: error?.payload ?? null, error: message };
      }

      if (preflight.compatible === false) {
        if (log) await log(`🚨 Formal AI ${image} reports the persisted memory as incompatible (${preflight.refusal_code ?? 'unknown'}: ${preflight.refusal_reason ?? 'no reason given'}); update abandoned`);
        return { status: 'failed', stage: 'preflight', image, digest: pulledDigest, preflight, error: preflight.refusal_reason || 'incompatible memory' };
      }

      let receipt = null;
      if (preflight.migration_required && preflight.path_exists) {
        const backupPath = `${FORMAL_AI_MEMORY_MOUNT}/memory.lino.schema-${preflight.detected_schema_version ?? 'unknown'}.bak`;
        const receiptPath = `${FORMAL_AI_MEMORY_MOUNT}/memory-upgrade-receipt.json`;
        if (log) await log(`🧬 Migrating Formal AI memory from schema ${preflight.detected_schema_version} to ${preflight.target_schema_version} (${preflight.migration_id ?? 'unnamed migration'})`);
        try {
          receipt = await runFormalAiMemoryCommand(image, ['migrate', '--path', FORMAL_AI_MEMORY_PATH, '--backup', backupPath, '--receipt', receiptPath, '--format', 'json'], { run, timeoutMs });
        } catch (error) {
          const message = error?.payload ? error.message : error?.stderr?.toString?.().trim() || error?.message || String(error);
          // The contract is refuse-or-succeed: a failed migrate leaves the file alone.
          if (log) await log(`🚨 Formal AI memory migration refused to modify the file; keeping the current image: ${message}`);
          return { status: 'failed', stage: 'migrate', image, digest: pulledDigest, preflight, refusal: error?.payload ?? null, error: message };
        }

        // A preflight that mutated the file would break the contract's core
        // promise, so prove it did not before trusting the rest.
        if (preflight.source_sha256 && receipt.original_sha256 && preflight.source_sha256 !== receipt.original_sha256) {
          if (log) await log(`🚨 Formal AI preflight changed the memory file (${preflight.source_sha256} → ${receipt.original_sha256}); rolling back`);
          const rollback = await rollbackFormalAiMemory({ image, receipt, run, timeoutMs, log });
          return { status: 'rolled-back', stage: 'preflight-side-effect', image, digest: pulledDigest, preflight, receipt, rollback };
        }
        if (verbose && log) await log(`[VERBOSE] formal-ai-updater: migration ${receipt.migration_id} ${receipt.from_schema_version}→${receipt.to_schema_version}, ${receipt.event_count} event(s), backup ${receipt.backup_path}, rollback=${receipt.rollback_supported}`);
      } else if (verbose && log) {
        await log(`[VERBOSE] formal-ai-updater: no memory migration required (schema ${preflight.detected_schema_version ?? 'none'}, state ${preflight.migration_state})`);
      }

      const verification = await verifyImageServesMemory({ image, env, fsImpl, run, timeoutMs, log, verbose, sleepImpl, healthAttempts, healthDelayMs });
      if (!verification.ok) {
        if (log) await log(`🚨 Formal AI ${image} could not serve the persisted memory after the update: ${verification.error}`);
        const rollback = receipt ? await rollbackFormalAiMemory({ image, receipt, run, timeoutMs, log }) : { restored: false, verified: true, error: null };
        return { status: 'rolled-back', stage: 'verify', image, digest: pulledDigest, preflight, receipt, rollback, error: verification.error };
      }

      const updatedAt = now().toISOString();
      writeFormalAiSidecarState({ ...readFormalAiSidecarState({ env, fsImpl }), image, imageDigest: pulledDigest, lastUpdate: { image, digest: pulledDigest, previousDigest: runningDigest, version: verification.health?.version ?? null, migrationId: receipt?.migration_id ?? null, memorySchemaVersion: verification.health?.memory?.schema_version ?? null, updatedAt } }, { env, fsImpl });

      if (log) await log(`✅ Formal AI updated to ${verification.health?.version ?? pulledDigest}${receipt ? ` (memory migrated ${receipt.from_schema_version}→${receipt.to_schema_version}, backup ${receipt.backup_path})` : ''}; the sidecar stays stopped until a Formal AI task needs it`);
      return { status: 'updated', image, digest: pulledDigest, previousDigest: runningDigest, preflight, receipt, health: verification.health, updatedAt };
    },
    { env, fsImpl, sleepImpl, log, ...lockOptions }
  );
};

export default {
  FORMAL_AI_UPDATE_TAG,
  describeMemoryRefusal,
  isFormalAiAutoUpdateEnabled,
  parseJsonBlock,
  tryParseJsonBlock,
  readMemoryFileSha256,
  resolveFormalAiUpdateImage,
  rollbackFormalAiMemory,
  runFormalAiMemoryCommand,
  updateFormalAiSidecarWhenIdle,
};
