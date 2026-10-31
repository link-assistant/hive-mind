/** Locate installed commands without executing them or trusting relative PATH. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export const nativeCommandRevision = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;

export async function locateNativeCommand(command, searchPath) {
  if (typeof command !== 'string' || !command || command.includes('\0')) throw new Error('Invalid installed command.');
  const candidates = path.isAbsolute(command)
    ? [command]
    : !command.includes('/')
      ? (searchPath || '')
          .split(path.delimiter)
          .filter(entry => path.isAbsolute(entry))
          .map(entry => path.join(entry, command))
      : [];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate, constants.X_OK);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) continue;
      throw error;
    }
    // Retain the selected bin link so activation can check its identity again.
    return path.join(await fs.realpath(path.dirname(candidate)), path.basename(candidate));
  }
  throw new Error('Installed command is unavailable.');
}
