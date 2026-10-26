// Disposable synthetic probe worker only. Not a production credential adapter.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { withSharedAuthRefreshLock } from '../../src/shared-auth-refresh-lock.lib.mjs';

assert.equal(process.env.HIVE_SYNTHETIC_AUTH_PROBE, '1');
const authority = '/authority/state.json';
const refresh = async ({ assertCurrent = async () => {} } = {}) => {
  const current = JSON.parse(await fs.readFile(authority, 'utf8'));
  assert.ok(current.synthetic === true);
  assert.ok(Number.isInteger(current.generation));
  if (current.generation === Number(process.argv[2])) {
    const body = JSON.stringify({ refreshToken: current.refreshToken });
    const next = await new Promise((resolve, reject) => {
      const request = http.request({ socketPath: '/authority/provider.sock', path: '/refresh', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, response => {
        let bytes = '';
        response.on('data', chunk => {
          bytes += chunk;
          if (bytes.length > 16384) request.destroy(new Error('Synthetic provider response exceeded its limit.'));
        });
        response.on('error', reject);
        response.on('end', () => {
          if (response.statusCode !== 200) reject(new Error('Synthetic predecessor was already consumed.'));
          else {
            try {
              resolve(JSON.parse(bytes));
            } catch {
              reject(new Error('Invalid synthetic provider response.'));
            }
          }
        });
      });
      request.on('error', reject);
      request.end(body);
    });
    const temporary = `/authority/.generation-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await assertCurrent();
      await fs.rename(temporary, authority);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  const selected = JSON.parse(await fs.readFile(authority, 'utf8'));
  const lock = await fs.stat('/authority/refresh.lock', { bigint: true });
  process.stdout.write(JSON.stringify({ identity: `${lock.dev}:${lock.ino}`, credentials: { accessToken: selected.accessToken, chatgptAccountId: 'synthetic-account', chatgptPlanType: 'pro' } }));
};
if (process.env.HIVE_SYNTHETIC_LOCKED === '1') await withSharedAuthRefreshLock({ directory: '/authority', lockName: 'refresh.lock', waitMs: 30_000 }, refresh);
else await refresh();
