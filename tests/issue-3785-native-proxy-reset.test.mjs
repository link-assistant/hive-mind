/** @hive-mind-test-suite default */
// The native fixture must survive a refused peer's
// socket reset while still failing unexpected network errors and destinations.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { refuseNativeProxyTunnel } from '../experiments/issue-3785/native-request-proxy.mjs';

for (const code of ['ECONNRESET', 'EPIPE', 'ENETUNREACH']) {
  test(`refused native tunnel survives ${code} and retains network validation`, () => {
    const socket = new EventEmitter();
    const blocked = new Set();
    let invalid = false;
    let response;
    socket.end = value => {
      response = value;
    };
    refuseNativeProxyTunnel({ url: 'github.com:443' }, socket, blocked, () => {
      invalid = true;
    });
    assert.equal(response, 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    assert.deepEqual([...blocked], ['github.com:443']);
    assert.doesNotThrow(() => socket.emit('error', Object.assign(new Error('Synthetic socket failure.'), { code })));
    assert.equal(invalid, code === 'ENETUNREACH');
  });
}

test('an unknown tunnel remains invalid and receives only a local refusal', () => {
  const socket = new EventEmitter();
  let invalid = false;
  let response;
  socket.end = value => {
    response = value;
  };
  refuseNativeProxyTunnel({ url: 'unknown.example.invalid:443' }, socket, new Set(), () => {
    invalid = true;
  });
  assert.equal(invalid, true);
  assert.equal(response, 'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
});
