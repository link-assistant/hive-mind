// Bounded synthetic subprocess for the production OS-lock regression tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { withSharedAuthRefreshLock } from '../../src/shared-auth-refresh-lock.lib.mjs';

const [directory, name, mode] = process.argv.slice(2);
const file = name => path.join(directory, name);
await fs.writeFile(file(`${name}-ready`), 'ready');
await withSharedAuthRefreshLock({ directory, waitMs: 5000 }, async ({ assertCurrent }) => {
  await fs.writeFile(file(`${name}-entered`), 'entered');
  if (mode === 'hold') await delay(6000);
  if (mode !== 'rotate') return;
  if ((await fs.readFile(file('generation'), 'utf8')) !== '0') return;
  await fs.writeFile(file('exchanges'), 'once', { flag: 'wx' });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await fs.stat(file('release')).catch(() => null)) break;
    await delay(20);
  }
  await fs.access(file('release'));
  await assertCurrent();
  await fs.writeFile(file('next-generation'), '1', { flag: 'wx' });
  await fs.rename(file('next-generation'), file('generation'));
});
