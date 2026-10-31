/** Activate the package's native CLI after admission, without provider execution. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { locateNativeCommand as locate, nativeCommandRevision as revision } from './native-agent-command.lib.mjs';
import { installNativeCodexRuntime, verifyNativeCodexRuntime } from './native-codex-runtime.lib.mjs';

const refusal = () => new Error('The installed native Codex command could not be verified; installation and execution were refused.');

async function stockRoot(entrypoint) {
  if (path.basename(entrypoint) !== 'codex.js' || path.basename(path.dirname(entrypoint)) !== 'bin') throw refusal();
  const root = path.dirname(path.dirname(entrypoint));
  const filename = path.join(root, 'package.json');
  const descriptor = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size <= 0n || before.size > 65536n) throw refusal();
    const buffer = Buffer.alloc(Number(before.size) + 1);
    const { bytesRead } = await descriptor.read(buffer, 0, buffer.length, 0);
    if (BigInt(bytesRead) !== before.size || revision(before) !== revision(await descriptor.stat({ bigint: true })) || revision(before) !== revision(await fs.lstat(filename, { bigint: true }))) throw refusal();
    const pkg = JSON.parse(buffer.subarray(0, bytesRead));
    if (pkg.name !== '@openai/codex' || pkg.version !== '0.164.0') throw refusal();
    return root;
  } finally {
    await descriptor.close();
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
  } catch {
    throw refusal();
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
    const entrypoint = await fs.realpath(bin);
    if (path.basename(entrypoint) === 'codex') return await verifyNativeCodexCommand({ command: bin });
    const upstream = await stockRoot(entrypoint);
    const destination = path.join(path.dirname(upstream), 'codex-hive-0.164.0');
    const ready = await installNativeCodexRuntime({ destination });
    const staged = path.join(path.dirname(bin), `.hive-codex-bin-${randomUUID()}`);
    await fs.symlink(ready.entrypoint, staged);
    temporary = staged;
    if (revision(await fs.lstat(bin, { bigint: true })) !== revision(before) || (await fs.readlink(bin)) !== link || (await fs.realpath(bin)) !== entrypoint) throw refusal();
    await fs.rename(temporary, bin);
    temporary = undefined;
    return await verifyNativeCodexCommand({ command: bin });
  } catch {
    throw refusal();
  } finally {
    if (temporary)
      await fs.unlink(temporary).catch(() => {
        throw refusal();
      });
  }
}
