/**
 * Measure how much disk a directory tree occupies (issues #2186, #2187).
 *
 * `du -sk` walks 52k files of a rustup toolchain in ~0.4s and counts hard links
 * once, which a JS walk cannot do; the fallback exists for hosts without `du`
 * (and is capped by an entry budget, reporting a lower bound rather than
 * stalling a logging path).
 *
 * Shared by the toolchain inventory and the reclaimable-space report so both
 * answer "how many bytes would this free" the same way.
 */

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Entries a fallback walk may visit before it reports a lower bound. */
export const DEFAULT_DISK_USAGE_ENTRY_LIMIT = 60_000;

/** Bounded recursive size of a directory, used when `du` is unavailable. */
const measureDirectory = async (fileSystem, directory, budget) => {
  const statPath = fileSystem.lstat ? fileSystem.lstat.bind(fileSystem) : fileSystem.stat.bind(fileSystem);
  let bytes = 0;
  const walk = async current => {
    if (budget.visited >= budget.limit) {
      budget.truncated = true;
      return;
    }
    let names;
    try {
      names = await fileSystem.readdir(current);
    } catch {
      return;
    }
    for (const entry of names) {
      if (budget.visited >= budget.limit) {
        budget.truncated = true;
        return;
      }
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (!name) continue;
      budget.visited += 1;
      const child = path.join(current, name);
      let stats;
      try {
        stats = await statPath(child);
      } catch {
        continue;
      }
      // Symlinks count as their own (tiny) size and are never followed: rustup
      // and nvm hard-link shared components, and following them would report
      // the same bytes under several toolchains.
      if (stats.isDirectory()) {
        await walk(child);
        continue;
      }
      bytes += Number(stats.size) || 0;
    }
  };
  await walk(directory);
  return bytes;
};

/**
 * Disk occupied by one directory tree.
 *
 * @returns {Promise<{bytes: number, truncated: boolean}>}
 */
export const measureDiskUsageBytes = async (targetPath, { exec = execFileAsync, fileSystem = fsPromises, entryLimit = DEFAULT_DISK_USAGE_ENTRY_LIMIT } = {}) => {
  try {
    const { stdout } = await exec('du', ['-sk', targetPath], { timeout: 60_000 });
    const kilobytes = Number(String(stdout).trim().split(/\s+/)[0]);
    if (Number.isFinite(kilobytes)) return { bytes: kilobytes * 1024, truncated: false };
  } catch {
    // No `du` (or it failed on this path) — fall through to the JS walk.
  }
  const budget = { visited: 0, limit: entryLimit, truncated: false };
  const bytes = await measureDirectory(fileSystem, targetPath, budget);
  return { bytes, truncated: budget.truncated };
};

export default {
  DEFAULT_DISK_USAGE_ENTRY_LIMIT,
  measureDiskUsageBytes,
};
