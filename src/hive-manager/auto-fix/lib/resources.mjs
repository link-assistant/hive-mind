import { readFileSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';

const mib = 1024 ** 2;

export function memoryAvailable() {
  const memory = Number(/^MemAvailable:\s+(\d+)\s+kB\b/m.exec(readFileSync('/proc/meminfo', 'utf8'))?.[1]) * 1024;
  if (!Number.isSafeInteger(memory)) throw new Error('Could not measure available Linux memory.');
  let available = memory;
  const scope = /^0::(.*)$/m.exec(readFileSync('/proc/self/cgroup', 'utf8'))?.[1];
  if (scope?.startsWith('/') && !scope.split('/').includes('..')) {
    for (let group = scope; ; group = dirname(group)) {
      const directory = '/sys/fs/cgroup' + (group === '/' ? '' : group);
      let limit = 'max';
      try {
        limit = readFileSync(`${directory}/memory.max`, 'utf8').trim();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (limit !== 'max') {
        const remaining = Number(limit) - Number(readFileSync(`${directory}/memory.current`, 'utf8'));
        if (!Number.isSafeInteger(remaining)) throw new Error('Could not measure cgroup memory headroom.');
        available = Math.min(available, Math.max(remaining, 0));
      }
      if (group === '/') break;
    }
  }
  return Math.floor(available / mib);
}

export function storageAvailable(path) {
  const { bsize, bavail, files, ffree } = statfsSync(path);
  return { availableBytes: bsize * bavail, freeInodes: files > 0 ? ffree : null };
}

export function verifyMemory(minimum) {
  const availableMiB = memoryAvailable();
  if (availableMiB < minimum) throw new Error(`Available memory is ${availableMiB} MiB. This policy requires ${minimum} MiB.`);
  return availableMiB;
}
