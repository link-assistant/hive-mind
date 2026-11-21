import fs from 'node:fs';

/**
 * A task that has exited is not alive: `Z` until it is reaped, then briefly `X`
 * while its reaper (init, for an orphaned descendant) releases it. Treating `X`
 * as alive made a stopped fixture look alive again right after a `Z` read (#4055).
 */
export function isFixtureProcessAlive(pid, readFile = fs.readFileSync) {
  if (!pid) return false;
  try {
    return !/^\d+ \(.+\) [ZX] /.test(readFile(`/proc/${pid}/stat`, 'utf8'));
  } catch (error) {
    // Linux can remove the task after opening its proc entry but before reading it.
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw error;
  }
}
