/** Prepare storage without following links or creating through a replaced Linux parent. */
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const unsafe = () => new Error('Storage directory path is unsafe or changed during preparation.');

export async function prepareStorageDirectory(target, { io = fs } = {}) {
  if (!path.isAbsolute(target) || path.normalize(target) !== target || /[\0\r\n]/u.test(target)) throw unsafe();
  const anchored = process.platform === 'linux';
  const handles = [];
  const observed = [];
  let current = path.parse(target).root;
  let parent;
  let created = false;
  let failure;
  let result;
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  try {
    if (anchored) {
      parent = await io.open(current, flags);
      handles.push(parent);
    }
    for (const segment of target.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      // Linux has no fs.promises.mkdirat. Resolve only the already-open parent
      // descriptor, so renaming/replacing its public path cannot redirect mkdir.
      const location = anchored ? `/proc/self/fd/${parent.fd}/${segment}` : current;
      const inspect = async () => {
        if (!anchored) return { info: await io.lstat(location, { bigint: true }) };
        const handle = await io.open(location, flags);
        handles.push(handle);
        return { handle, info: await handle.stat({ bigint: true }) };
      };
      let entry = await inspect().catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!entry) {
        await io.mkdir(location, { mode: 0o700 }).then(
          () => {
            if (current === target) created = true;
          },
          error => {
            if (error.code !== 'EEXIST') throw error;
          }
        );
        entry = await inspect();
      }
      if (!entry.info.isDirectory() || entry.info.isSymbolicLink()) throw unsafe();
      observed.push({ target: current, info: entry.info });
      parent = entry.handle;
    }
    // The daemon will later resolve public paths, so a detached original
    // directory is not an admissible result even though creation stayed safe.
    for (const entry of observed) {
      const visible = await io.lstat(entry.target, { bigint: true });
      if (!visible.isDirectory() || visible.isSymbolicLink() || visible.dev !== entry.info.dev || visible.ino !== entry.info.ino) throw unsafe();
    }
    const final = observed.at(-1)?.info;
    result = { created, identity: final ? `${final.dev}:${final.ino}` : null };
  } catch (error) {
    failure = error;
  } finally {
    const closed = await Promise.allSettled(handles.reverse().map(handle => handle.close()));
    const rejected = closed.find(result => result.status === 'rejected');
    if (!failure && rejected) failure = rejected.reason;
  }
  if (failure) throw failure;
  return result;
}
