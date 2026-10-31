/** Activate and verify the installed native adapter without running provider code. */
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { installNativeGemini, verifyNativeGemini } from './native-gemini-package.lib.mjs';
import { locateNativeCommand as locate, nativeCommandRevision as revision } from './native-agent-command.lib.mjs';

const refusal = () => new Error('The installed native Gemini command could not be verified; installation and execution were refused.');

async function selected(bin) {
  const entrypoint = await fs.realpath(bin);
  if (path.basename(entrypoint) !== 'gemini.js' || path.basename(path.dirname(entrypoint)) !== 'bundle') throw refusal();
  return { entrypoint, root: path.dirname(path.dirname(entrypoint)) };
}

/** A matching --version string alone is insufficient for native admission. */
export async function verifyNativeGeminiCommand({ command = 'gemini', searchPath = process.env.PATH } = {}) {
  try {
    const bin = await locate(command, searchPath);
    const target = await selected(bin);
    const verified = await verifyNativeGemini(target.root);
    if ((await fs.realpath(bin)) !== verified.entrypoint) throw refusal();
    return { ...verified, command: bin };
  } catch {
    throw refusal();
  }
}

/** Replace the package manager's bin link after a complete verified install.
 * Installation runs with exclusive ownership of the image/package directory.
 * It does not migrate credentials, configuration, or conversation state.
 */
export async function installNativeGeminiCommand({ command = 'gemini', searchPath = process.env.PATH } = {}) {
  let temporary;
  try {
    const bin = await locate(command, searchPath);
    const before = await fs.lstat(bin, { bigint: true });
    if (!before.isSymbolicLink()) throw refusal();
    const link = await fs.readlink(bin);
    const target = await selected(bin);
    const ready = await fs.lstat(path.join(target.root, '.hive-native-package.json')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    if (ready) return await verifyNativeGeminiCommand({ command: bin });
    const destination = path.join(path.dirname(target.root), 'gemini-cli-hive-0.65.0');
    const verified = await installNativeGemini({ source: target.root, destination });
    const staged = path.join(path.dirname(bin), `.hive-gemini-bin-${randomUUID()}`);
    await fs.symlink(verified.entrypoint, staged);
    temporary = staged;
    if (revision(await fs.lstat(bin, { bigint: true })) !== revision(before) || (await fs.readlink(bin)) !== link || (await fs.realpath(bin)) !== target.entrypoint) throw refusal();
    await fs.rename(temporary, bin);
    temporary = undefined;
    return await verifyNativeGeminiCommand({ command: bin });
  } catch {
    throw refusal();
  } finally {
    if (temporary)
      await fs.unlink(temporary).catch(() => {
        throw refusal();
      });
  }
}
