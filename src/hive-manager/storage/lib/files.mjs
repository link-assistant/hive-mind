import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { absolute, overlaps } from './docker.mjs';

const fdPath = fd => `/proc/self/fd/${fd}`;
const mountId = fd => /^mnt_id:\s+(\d+)$/m.exec(readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'))?.[1];
// Linux O_PATH lets us inspect a leaf descriptor without opening device nodes
// or FIFOs. O_NOFOLLOW keeps a concurrent symlink replacement at the leaf.
const pathOnly = 0x200000 | constants.O_NOFOLLOW;
const safeFile = stat => stat.isFile() && stat.nlink === 1 && stat.blocks > 0;
const stamp = stat => [stat.dev, stat.ino, stat.ctimeMs, stat.mtimeMs, stat.size];
const same = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);

export function openTree(root) {
  const fd = openSync(root, constants.O_DIRECTORY | constants.O_RDONLY);
  const mount = mountId(fd);
  if (!mount) {
    closeSync(fd);
    throw new Error('Mount identity unavailable.');
  }
  return { fd, mount, close: () => closeSync(fd) };
}

function openChild(tree, parent, name, flags) {
  const fd = openSync(join(fdPath(parent), name), flags);
  if (mountId(fd) === tree.mount) return fd;
  closeSync(fd);
  throw new Error('File crossed a mount boundary.');
}

function parentAt(tree, path) {
  const parts = path.slice(1).split('/');
  const name = parts.pop();
  let fd = tree.fd;
  try {
    for (const part of parts) {
      const child = openChild(tree, fd, part, pathOnly | constants.O_DIRECTORY);
      if (fd !== tree.fd) closeSync(fd);
      fd = child;
    }
    return {
      fd,
      name,
      close: () => {
        if (fd !== tree.fd) closeSync(fd);
      },
    };
  } catch (error) {
    if (fd !== tree.fd) closeSync(fd);
    throw error;
  }
}

function readLeaf(tree, parent) {
  const descriptor = openChild(tree, parent.fd, parent.name, pathOnly);
  try {
    return fstatSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function leaf(tree, path) {
  const parent = parentAt(tree, path);
  try {
    return readLeaf(tree, parent);
  } finally {
    parent.close();
  }
}

export function planFiles(tree, upper, paths, protectedPaths, check) {
  const files = new Map();
  let visited = 0;
  function walk(parent, name, path, depth) {
    check();
    if (++visited > 50_000 || depth > 64 || files.size >= 10_000) throw new Error('Cleanup file inventory exceeded its traversal budget.');
    if (protectedPaths.some(root => overlaps(root, path))) return;
    let fd;
    try {
      fd = openChild(upper ?? tree, parent, name, pathOnly);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) return;
      throw error;
    }
    try {
      const backing = fstatSync(fd);
      if (backing.isDirectory()) {
        const dir = opendirSync(fdPath(fd));
        try {
          for (let entry; (entry = dir.readSync());) {
            if (absolute(`${path}/${entry.name}`)) walk(fd, entry.name, `${path}/${entry.name}`, depth + 1);
          }
        } finally {
          dir.closeSync();
        }
      } else if (safeFile(backing)) {
        const view = upper ? leaf(tree, path) : backing;
        if (safeFile(view) && view.size === backing.size && view.mtimeMs === backing.mtimeMs) {
          files.set(path, { path, bytes: backing.blocks * 512, view: stamp(view), upper: upper ? stamp(backing) : null });
        }
      }
    } finally {
      closeSync(fd);
    }
  }
  for (const path of paths) {
    if (!absolute(path) || path === '/' || protectedPaths.some(root => overlaps(root, path))) continue;
    let parent;
    try {
      parent = parentAt(upper ?? tree, path);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue;
      throw error;
    }
    try {
      walk(parent.fd, parent.name, path, 0);
    } finally {
      parent.close();
    }
  }
  return [...files.values()];
}

export function removeApproved(tree, upper, approved, fresh, check) {
  if (!same(approved.view, fresh.view) || Boolean(upper) !== Boolean(approved.upper) || (upper && !same(approved.upper, fresh.upper))) return false;
  const parent = parentAt(tree, fresh.path);
  try {
    check();
    const path = join(fdPath(parent.fd), parent.name);
    if (upper && !same(stamp(leaf(upper, fresh.path)), approved.upper)) return false;
    if (!same(stamp(readLeaf(tree, parent)), approved.view) || !same(stamp(lstatSync(path)), approved.view)) return false;
    unlinkSync(path);
    return true;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) return false;
    throw error;
  } finally {
    parent.close();
  }
}
