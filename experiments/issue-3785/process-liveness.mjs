import fs from 'node:fs';

export function isFixtureProcessAlive(pid, readFile = fs.readFileSync) {
  if (!pid) return false;
  try {
    return !/^\d+ \(.+\) Z /.test(readFile(`/proc/${pid}/stat`, 'utf8'));
  } catch (error) {
    // Linux can remove the task after opening its proc entry but before reading it.
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return false;
    throw error;
  }
}
