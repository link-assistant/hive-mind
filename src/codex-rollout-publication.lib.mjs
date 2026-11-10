/** Publish recovered conversation evidence without replacing a live rollout. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

/**
 * Stage the complete copy on the destination filesystem before exposing its
 * native name. link() either publishes that inode or reports an existing name;
 * rename() and a pre-copy existence check can overwrite a concurrent writer.
 * The source is retained, including when publication fails or collides.
 */
export async function publishCodexRollout({ source, target, fsImpl = fs, retainConflict = false }) {
  const directory = path.dirname(target);
  const staging = await fsImpl.mkdtemp(path.join(directory, '.hive-mind-rollout-'));
  let retained = false;
  try {
    const snapshot = path.join(staging, 'snapshot');
    await fsImpl.copyFile(source, snapshot, constants.COPYFILE_EXCL);
    await fsImpl.chmod(snapshot, 0o600);
    const file = await fsImpl.open(snapshot, 'r');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    try {
      await fsImpl.link(snapshot, target);
    } catch (error) {
      if (error.code === 'EEXIST') {
        if (retainConflict) {
          const metadata = await fsImpl.open(path.join(staging, 'metadata.json'), 'wx', 0o600);
          try {
            await metadata.writeFile(JSON.stringify({ schema: 1, requestedName: path.basename(target) }));
            await metadata.sync();
          } finally {
            await metadata.close();
          }
          await syncDirectory(staging, fsImpl);
          await syncDirectory(directory, fsImpl);
          retained = true;
        }
        const existing = await fsImpl.lstat(target);
        if (!existing.isFile() || existing.isSymbolicLink()) throw Object.assign(new Error('Canonical Codex rollout destination is not a regular file.'), { conflictFile: retained ? snapshot : null });
        return { published: false, conflictFile: retained ? snapshot : null };
      }
      throw error;
    }
    await syncDirectory(directory, fsImpl);
    return { published: true, conflictFile: null };
  } finally {
    if (!retained) await fsImpl.rm(staging, { recursive: true, force: true });
  }
}

async function syncDirectory(directory, fsImpl) {
  const handle = await fsImpl.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
