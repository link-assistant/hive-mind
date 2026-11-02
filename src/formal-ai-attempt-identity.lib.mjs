/**
 * Inside the solve container: prove the Formal AI process answering this task
 * is the binary the attempt selected (issue #3909).
 *
 * The Formal AI draft runner verifies the binary, the image and a serving probe
 * before it starts solve, and passes what it verified as environment
 * (`HIVE_MIND_FORMAL_AI_EXPECTED_SHA256`, `…_EXPECTED_VERSION`). solve then
 * checks the server it starts for the task itself, because that is the process
 * whose answers become the task's effects. Version equality alone is not
 * enough — two commits can carry one version — so the executable of the
 * running server process (`/proc/<pid>/exe`) is hashed and compared.
 *
 * Without those variables nothing changes: an ordinary `solve --model
 * formal-ai` run has no attempt identity to check.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3909
 * @module formal-ai-attempt-identity
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/** Kept in step with `ATTEMPT_ENV` in `scripts/formal-ai-draft-identity.lib.mjs`. */
export const FORMAL_AI_ATTEMPT_ENV = Object.freeze({
  id: 'HIVE_MIND_ATTEMPT_ID',
  mode: 'HIVE_MIND_ATTEMPT_MODE',
  expectedSha256: 'HIVE_MIND_FORMAL_AI_EXPECTED_SHA256',
  expectedVersion: 'HIVE_MIND_FORMAL_AI_EXPECTED_VERSION',
  expectedSource: 'HIVE_MIND_FORMAL_AI_EXPECTED_SOURCE',
});

const SHA256 = /^[0-9a-f]{64}$/;

/** The attempt's expectation, or null when this run carries none. */
export const readFormalAiAttemptExpectation = (env = process.env) => {
  const read = name => String(env[name] || '').trim() || null;
  const sha256 = read(FORMAL_AI_ATTEMPT_ENV.expectedSha256)?.toLowerCase().replace(/^sha256:/, '') || null;
  const version = read(FORMAL_AI_ATTEMPT_ENV.expectedVersion);
  const id = read(FORMAL_AI_ATTEMPT_ENV.id);
  if (!sha256 && !version) return null;
  if (sha256 && !SHA256.test(sha256)) throw new Error(`${FORMAL_AI_ATTEMPT_ENV.expectedSha256} is not a sha256 digest: ${JSON.stringify(env[FORMAL_AI_ATTEMPT_ENV.expectedSha256])}`);
  return { id, mode: read(FORMAL_AI_ATTEMPT_ENV.mode), sha256, version, source: read(FORMAL_AI_ATTEMPT_ENV.expectedSource) };
};

/** sha256 of a file, streamed. */
export const sha256OfFile = path =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });

/** The file `formalAiPath` resolves to on `PATH`, as `execFile` would find it. */
export const resolveExecutable = async (formalAiPath, env = process.env, accessImpl = access) => {
  if (isAbsolute(formalAiPath) || formalAiPath.includes('/')) return formalAiPath;
  for (const dir of String(env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, formalAiPath);
    try {
      await accessImpl(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  throw new Error(`${formalAiPath} is not on PATH`);
};

const short = sha => (sha ? `${sha.slice(0, 12)}…` : 'unknown');

/**
 * Check the wrapper executable before it is used.
 *
 * @returns {Promise<{path: string, sha256: string}|null>} null when the run carries no expectation
 */
export const verifyFormalAiWrapperBinding = async ({ expectation, formalAiPath, env = process.env, deps = {} }) => {
  if (!expectation?.sha256) return null;
  const path = await (deps.resolveExecutableImpl || resolveExecutable)(formalAiPath, env);
  const sha256 = await (deps.hashImpl || sha256OfFile)(path);
  if (sha256 !== expectation.sha256) throw new Error(`attempt ${expectation.id ?? 'unknown'}: ${path} hashes to ${short(sha256)}, not the selected Formal AI ${short(expectation.sha256)}. Refusing to run a different backend than the attempt selected (issue #3909).`);
  return { path, sha256 };
};

/**
 * Check the process that serves the task, after it answered `/health`.
 *
 * @param {object} params
 * @param {object|null} params.expectation from {@link readFormalAiAttemptExpectation}
 * @param {number|null} params.serverPid the server this run started; null for an external endpoint
 * @param {string} params.servingVersion the version `/health` reported
 * @returns {Promise<{attemptId: string|null, mode: string|null, servingExeSha256: string|null, version: string}|null>}
 */
export const verifyFormalAiServingBinding = async ({ expectation, serverPid, servingVersion, deps = {} }) => {
  if (!expectation) return null;
  const who = `attempt ${expectation.id ?? 'unknown'}`;
  if (expectation.version && servingVersion !== expectation.version) throw new Error(`${who}: the serving backend reports Formal AI ${servingVersion}, but the attempt selected ${expectation.version} (issue #3909).`);
  let servingExeSha256 = null;
  if (expectation.sha256) {
    if (!serverPid) throw new Error(`${who} selected a Formal AI binary by digest, but this task is served by an external endpoint whose executable cannot be checked; unset HIVE_MIND_FORMAL_AI_BASE_URL so solve serves the selected binary itself (issue #3909).`);
    servingExeSha256 = await (deps.hashImpl || sha256OfFile)(`/proc/${serverPid}/exe`);
    if (servingExeSha256 !== expectation.sha256) throw new Error(`${who}: the Formal AI server (pid ${serverPid}) runs an executable hashing ${short(servingExeSha256)}, not the selected ${short(expectation.sha256)} (issue #3909).`);
  }
  return { attemptId: expectation.id, mode: expectation.mode, source: expectation.source, servingExeSha256, version: servingVersion };
};

/** One log line for a verified binding. */
export const describeFormalAiAttemptBinding = binding => `attempt ${binding.attemptId ?? 'unknown'}${binding.mode ? ` (${binding.mode})` : ''}: serving Formal AI ${binding.version}${binding.servingExeSha256 ? `, executable sha256 ${binding.servingExeSha256}` : ''}${binding.source ? `, source ${binding.source}` : ''} — verified`;
