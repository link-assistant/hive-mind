/** Private cleanup logs live outside executable directories (issue #2629). */
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export function getCleanupLogDirectory({ env = process.env, home = os.homedir() } = {}) {
  const stateHome = env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(home, '.local', 'state');
  return path.join(stateHome, 'hive-mind', 'logs');
}

/** Retain the last 30 completed logs. Never unlink symlinks or unrelated files. */
export async function initializeCleanupLog(logFile, { maxLogs = 30 } = {}) {
  const directory = path.dirname(logFile);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const names = entries
    .filter(entry => entry.isFile() && /^cleanup-\d{4}-\d{2}-\d{2}T[\dTZ-]+\.log$/.test(entry.name))
    .map(entry => entry.name)
    .sort()
    .reverse();
  // Preserve concurrent writers; a PID suffix identifies our running logs.
  for (const name of names.slice(maxLogs - 1)) {
    if (path.join(directory, name) === logFile) continue;
    const pid = /Z-(\d+)\.log$/.exec(name)?.[1];
    if (pid) {
      try {
        process.kill(Number(pid), 0);
        continue;
      } catch (error) {
        if (error.code !== 'ESRCH') continue;
      }
    }
    await fs.unlink(path.join(directory, name)).catch(() => {});
  }
  await fs.writeFile(logFile, `# Cleanup Log - ${new Date().toISOString()}\n\n`, { mode: 0o600, flag: 'wx' });
}
