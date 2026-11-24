import { basename } from 'node:path';
import { output } from '../../storage/lib/process.mjs';

export async function observedWatchers() {
  const processes = await output('ps', ['-ww', '-o', 'args=', '-u', String(process.getuid())], { maxBytes: 4 * 1024 * 1024 });
  const names = new Set();
  for (const line of processes.split('\n')) {
    const [bin, command, name] = line.trim().split(/\s+/, 3);
    if (bin && basename(bin) === 'docker' && command === 'wait' && /^[\w.-]+$/.test(name ?? '')) names.add(name);
    // start-command waits from a detached shell. The shell is also visible
    // between docker wait calls and during its post-mortem and finalization.
    if (line.includes('__start_command_')) {
      for (const match of line.matchAll(/\bdocker wait '([\w.-]+)'/g)) names.add(match[1]);
    }
  }
  return names;
}
