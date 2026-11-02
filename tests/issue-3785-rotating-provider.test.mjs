/** @hive-mind-test-suite default */
// Issue #3785: the refresh gate's synthetic provider must refuse expired access
// generations as the real API does, so a stale native request is never "served".
import assert from 'node:assert/strict';
import { once } from 'node:events';
import net from 'node:net';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { test } from 'node:test';
import { createRotatingProvider } from '../scripts/verify-mounted-claude-refresh.mjs';

const message = (port, generation) =>
  fetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer SYNTHETIC-ACCESS-G${generation}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(5000),
  });

test('rotating provider refuses expired access generations and serves current ones', { timeout: 10000 }, async t => {
  const { server, state } = createRotatingProvider({ key: undefined, cert: undefined });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  state.expireAccess(60);
  state.expect(60, { revoked: true });
  const refused = await message(port, 60);
  assert.equal(refused.status, 401);
  assert.equal((await refused.json()).error.type, 'authentication_error');
  assert.deepEqual(state.rejected, [60]);
  assert.deepEqual(state.models, [], 'A refused expired token is not a served model request.');

  const served = await message(port, 61);
  assert.equal(served.status, 200);
  await served.text();
  assert.deepEqual(state.models, [61]);

  state.expect(70);
  assert.deepEqual(state.rejected, [], 'Each scenario starts with no refused requests.');
  assert.deepEqual(state.failures, []);
});

test('a reset refused CONNECT tunnel does not crash the gate provider', { timeout: 10000 }, async t => {
  const { server } = createRotatingProvider({ key: undefined, cert: undefined });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();
  const uncaught = [];
  const record = error => uncaught.push(error.code ?? error.message);
  process.prependListener('uncaughtException', record);
  t.after(() => process.removeListener('uncaughtException', record));
  // A killed native peer resets its refused tunnel while the provider is still answering it.
  for (let attempt = 0; attempt < 20; attempt++) {
    const socket = net.connect(port, '127.0.0.1');
    await once(socket, 'connect');
    socket.write('CONNECT example.invalid:443 HTTP/1.1\r\nHost: example.invalid:443\r\n\r\n');
    await once(socket, 'data');
    socket.resetAndDestroy();
  }
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(uncaught, [], 'A peer reset on a refused tunnel must not be an unhandled provider error.');
});
