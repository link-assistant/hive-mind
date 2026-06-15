#!/usr/bin/env node

/**
 * Regression test for issue #1733.
 *
 * use-m@8.14.0 relocated its eval bundle from `use.js` (package root) to
 * `src/use.js`, so the unversioned https://unpkg.com/use-m/use.js URL the
 * bootstrap fetched began returning `404 Not found`. eval()'ing that 404 body
 * crashed every command with `SyntaxError: Unexpected identifier 'found'`.
 *
 * loadUseMCode() must skip a 404 (or an error-page body served with 200) and
 * fall back to the next candidate URL instead of returning the bad body.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { loadUseMCode, USE_M_CODE_URLS } from '../src/use-m-bootstrap.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

const response = (ok, status, body) => ({ ok, status, text: async () => body });

await test('USE_M_CODE_URLS keeps the original unpkg root URL first', () => {
  assert.equal(USE_M_CODE_URLS[0], 'https://unpkg.com/use-m/use.js');
  // The new src/ layout must be among the fallbacks.
  assert.ok(USE_M_CODE_URLS.includes('https://unpkg.com/use-m/src/use.js'));
});

await test('loadUseMCode falls back past a 404 to the next candidate', async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url);
    if (url === 'https://unpkg.com/use-m/use.js') return response(false, 404, 'Not found: /use-m@8.14.0/use.js');
    return response(true, 200, '({ use: () => {} })');
  };
  const code = await loadUseMCode({ fetchImpl });
  assert.equal(code, '({ use: () => {} })');
  assert.equal(seen[0], 'https://unpkg.com/use-m/use.js'); // tried the primary first
  assert.equal(seen[1], 'https://unpkg.com/use-m/src/use.js'); // then the new layout
});

await test('loadUseMCode rejects a "Not found" body served with HTTP 200', async () => {
  const fetchImpl = async url => {
    if (url === 'https://unpkg.com/use-m/use.js') return response(true, 200, 'Not found: /use-m@8.14.0/use.js');
    return response(true, 200, '({ use: () => {} })');
  };
  const code = await loadUseMCode({ fetchImpl });
  assert.equal(code, '({ use: () => {} })');
});

await test('loadUseMCode skips an HTML error page served with HTTP 200', async () => {
  const fetchImpl = async url => {
    if (url.includes('unpkg.com')) return response(true, 200, '<!DOCTYPE html><html><body>error</body></html>');
    return response(true, 200, '({ use: () => {} })');
  };
  const code = await loadUseMCode({ fetchImpl });
  assert.equal(code, '({ use: () => {} })');
});

await test('loadUseMCode throws when every candidate fails', async () => {
  const fetchImpl = async () => response(false, 404, 'Not found');
  await assert.rejects(() => loadUseMCode({ fetchImpl }), /Failed to fetch use-m bootstrap/);
});

await test('loadUseMCode keeps trying after a thrown network error', async () => {
  const fetchImpl = async url => {
    if (url === 'https://unpkg.com/use-m/use.js') throw new Error('ECONNRESET');
    return response(true, 200, '({ use: () => {} })');
  };
  const code = await loadUseMCode({ fetchImpl });
  assert.equal(code, '({ use: () => {} })');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
