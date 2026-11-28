/** Activate the package's native CLI after admission, without provider execution. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { locateNativeCommand as locate, nativeCommandRevision as revision } from './native-agent-command.lib.mjs';
import { installNativeCodexRuntime, NATIVE_CODEX_HOST_MISSING, NATIVE_CODEX_MANIFEST_SCHEMA, readNativeCodexVersion, verifyNativeCodexRuntime } from './native-codex-runtime.lib.mjs';

const refusal = () => new Error('The installed native Codex command could not be verified; installation and execution were refused.');

async function stockPackage(entrypoint, { allowHardLinks = false } = {}) {
  if (path.basename(entrypoint) !== 'codex.js' || path.basename(path.dirname(entrypoint)) !== 'bin') throw refusal();
  const root = path.dirname(path.dirname(entrypoint));
  const filename = path.join(root, 'package.json');
  const descriptor = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || (!allowHardLinks && before.nlink !== 1n) || before.size <= 0n || before.size > 65536n) throw refusal();
    const buffer = Buffer.alloc(Number(before.size) + 1);
    const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, 0);
    if (BigInt(bytesRead) !== before.size || revision(before) !== revision(await descriptor.stat({ bigint: true })) || revision(before) !== revision(await fs.lstat(filename, { bigint: true }))) throw refusal();
    const pkg = JSON.parse(buffer.subarray(0, bytesRead));
    if (pkg.name !== '@openai/codex') throw refusal();
    return { root, version: pkg.version, bin: pkg.bin };
  } finally {
    await descriptor.close();
  }
}

// Native storage selectors belong to Hive Mind's patched runtime.
export function isStockCodexAllowed(env) {
  return env.HIVE_MIND_ALLOW_STOCK_CODEX === '1' && ['CODEX_AUTH_HOME', 'HIVE_MIND_CODEX_AUTH_IDENTITY', 'CODEX_SQLITE_HOME', 'CODEX_ROLLOUT_HOME', 'CODEX_SESSION_INDEX_HOME', 'CODEX_MESSAGE_HISTORY_HOME', 'CODEX_ROLLOUT_MAINTENANCE_HOME'].every(key => env[key] === undefined);
}

/** Identify the opted-in package-manager command without executing it. */
export async function verifyStockCodexCommand({ command = 'codex', searchPath = process.env.PATH } = {}) {
  const bin = await locate(command, searchPath);
  const entrypoint = await fs.realpath(bin);
  if (path.basename(entrypoint) !== 'codex.js') return null;
  try {
    // Bun may hard-link installed stock files to its cache. The package is the
    // operator's source of trust in stock mode, with no native attestation.
    const { root, version, bin: declared } = await stockPackage(entrypoint, { allowHardLinks: true });
    if (path.basename(root) !== 'codex' || path.basename(path.dirname(root)) !== '@openai' || declared?.codex !== 'bin/codex.js' || typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) throw refusal();
    if (!(await fs.lstat(entrypoint)).isFile() || (await fs.realpath(bin)) !== entrypoint) throw refusal();
    return { root, version, entrypoint, command: bin, stock: true };
  } catch {
    throw new Error('The installed stock @openai/codex package could not be verified.');
  }
}

/** Native byte/provenance admission always precedes any version/provider probe. */
export async function verifyNativeCodexCommand({ command = 'codex', searchPath = process.env.PATH } = {}) {
  try {
    const bin = await locate(command, searchPath);
    const entrypoint = await fs.realpath(bin);
    if (path.basename(entrypoint) !== 'codex') throw refusal();
    const verified = await verifyNativeCodexRuntime(path.dirname(entrypoint));
    if ((await fs.realpath(bin)) !== verified.entrypoint) throw refusal();
    return { ...verified, command: bin };
  } catch (error) {
    throw error.code === NATIVE_CODEX_HOST_MISSING ? error : refusal();
  }
}

/** Runs under exclusive package/image installation ownership. Native generation
 * installation leaves all configuration, credentials and history untouched.
 */
export async function installNativeCodexCommand({ command = 'codex', searchPath = process.env.PATH } = {}) {
  let temporary;
  try {
    const bin = await locate(command, searchPath);
    const before = await fs.lstat(bin, { bigint: true });
    if (!before.isSymbolicLink()) throw refusal();
    const link = await fs.readlink(bin);
    const nativeVersion = await readNativeCodexVersion();
    const entrypoint = await fs.realpath(bin);
    let launcher = entrypoint;
    if (path.basename(entrypoint) === 'codex') {
      const generation = path.dirname(entrypoint);
      const scope = path.dirname(generation);
      const legacy = path.join(scope, `codex-hive-${nativeVersion}`);
      // The schema-less selector was used before the companion was packaged.
      // Publish a new generation if this bin still selects that managed runtime.
      if (path.basename(scope) !== '@openai' || !path.basename(generation).startsWith('.hive-native-codex-') || (await fs.realpath(legacy).catch(() => null)) !== generation) return await verifyNativeCodexCommand({ command: bin });
      launcher = path.join(scope, 'codex', 'bin', 'codex.js');
      if ((await fs.realpath(launcher)) !== launcher) throw refusal();
    }
    const upstream = await stockPackage(launcher);
    if (upstream.version !== nativeVersion) throw refusal();
    const destination = path.join(path.dirname(upstream.root), `codex-hive-${nativeVersion}-v${NATIVE_CODEX_MANIFEST_SCHEMA}`);
    const ready = await installNativeCodexRuntime({ destination });
    const staged = path.join(path.dirname(bin), `.hive-codex-bin-${randomUUID()}`);
    await fs.symlink(ready.entrypoint, staged);
    temporary = staged;
    if (revision(await fs.lstat(bin, { bigint: true })) !== revision(before) || (await fs.readlink(bin)) !== link || (await fs.realpath(bin)) !== entrypoint) throw refusal();
    await fs.rename(temporary, bin);
    temporary = undefined;
    return await verifyNativeCodexCommand({ command: bin });
  } catch (error) {
    throw error.code === NATIVE_CODEX_HOST_MISSING ? error : refusal();
  } finally {
    if (temporary)
      await fs.unlink(temporary).catch(() => {
        throw refusal();
      });
  }
}
