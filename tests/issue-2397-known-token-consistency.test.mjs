#!/usr/bin/env node
/**
 * Issue #2397: the publication verifier must not block what the maskers leave alone.
 *
 * sanitizeForPublication finishes with containsKnownToken, which checked every
 * KNOWN_LOCAL_TOKEN_ENV_VARS value of any length. The maskers, however, only
 * mask values of 12+ characters, and the log path (sanitizeOutput) only masked
 * GitHub CLI tokens. So with TELEGRAM_OWNER_CHAT_ID=123456789 every log that
 * mentioned that number (or any number containing it) was blocked, and a
 * GITHUB_PAT that does not look like a vendor token was never masked and
 * blocked the log, both as "Credential sanitization failed; publication was blocked."
 *
 * Run with: node tests/issue-2397-known-token-consistency.test.mjs
 */

import assert from 'node:assert/strict';

const CHAT_ID = '123456789';
const PAT = 'custompatvalue-0123456789abcdef';
process.env.TELEGRAM_OWNER_CHAT_ID = CHAT_ID;
process.env.GITHUB_PAT = PAT;

const { containsKnownToken, sanitizeForPublication, sanitizeOutput } = await import('../src/token-sanitization.lib.mjs');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}${error.stage ? ` (stage: ${error.stage}; findings: ${JSON.stringify(error.findings)})` : ''}`);
    failed++;
  }
}

await test('a short non-secret env value (owner chat id) does not block publication', async () => {
  const output = await sanitizeForPublication(`upload size 9${CHAT_ID} bytes\nchat id ${CHAT_ID}\n`);
  assert.match(output, /chat id/);
});

await test('containsKnownToken ignores values too short to be masked', async () => {
  const hits = await containsKnownToken(`chat ${CHAT_ID}`, [{ name: 'TELEGRAM_OWNER_CHAT_ID', source: 'env', value: CHAT_ID }]);
  assert.deepEqual(hits, []);
});

await test('containsKnownToken still reports a maskable known token', async () => {
  const hits = await containsKnownToken(`pat ${PAT}`, [{ name: 'GITHUB_PAT', source: 'env', value: PAT }]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, 'GITHUB_PAT');
});

await test('sanitizeOutput masks every known env token, not only GitHub CLI tokens', async () => {
  const output = await sanitizeOutput(`using ${PAT} now`);
  assert.ok(!output.includes(PAT), 'GITHUB_PAT must be masked in logs');
});

await test('a log with a GITHUB_PAT value is masked and published instead of blocked', async () => {
  const output = await sanitizeForPublication(`git push https://x:${PAT}@github.com/o/r\n`);
  assert.ok(!output.includes(PAT));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
