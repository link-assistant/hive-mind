/** @hive-mind-test-suite default */
// Issue #3785: a CONNECT socket leaves Node's HTTP error handling, so a killed or
// reaped native peer that resets a refused tunnel crashed a synthetic provider
// with an unhandled ECONNRESET (native Codex owner-death probe, CI run 41465682937).
// Every synthetic proxy in the gates and probes must handle tunnel socket errors.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..');
const directories = ['scripts', 'experiments/issue-3785'];

test('every synthetic CONNECT handler registers a socket error handler', async () => {
  const handlers = [];
  for (const directory of directories) {
    for (const name of await fs.readdir(path.join(root, directory))) {
      if (!name.endsWith('.mjs')) continue;
      const source = await fs.readFile(path.join(root, directory, name), 'utf8');
      for (const match of source.matchAll(/\.on\('connect',/gu)) {
        // The handler's opening statements, before any refusal is written.
        const body = source.slice(match.index, match.index + 600);
        const guarded = /socket\.on\('error'|refuseNativeProxyTunnel\(/u.test(body.slice(0, body.search(/socket\.(end|write)\(/u) + 1 || body.length));
        handlers.push({ file: `${directory}/${name}`, guarded });
      }
    }
  }
  assert.ok(handlers.length >= 6, 'The known synthetic proxies must still be scanned.');
  assert.deepEqual(
    handlers.filter(handler => !handler.guarded),
    []
  );
});
