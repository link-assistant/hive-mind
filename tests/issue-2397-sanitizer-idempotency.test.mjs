#!/usr/bin/env node
/**
 * Issue #2397: the credential sanitizer must be idempotent, or the publication
 * boundary blocks every log that contains a short `key => value`.
 *
 * sanitizeForPublication re-runs the sanitizer on its own output and blocks the
 * upload when a second pass would change anything ("Residual credential material
 * detected."). For `token => !token` the first pass produced `token => [REDACTED]`;
 * on the second pass the structural guard refused a value starting with `[`, the
 * separator backtracked from `=>` to `=`, and `> [REDACTED]`... became
 * `=[REDACTED] [REDACTED]`. Every arrow function with a sensitive parameter name
 * (`token =>`, `secret =>`, `password =>`) in a Codex/Claude session log therefore
 * blocked the whole log — the 5 MB log of konard/vietnam-accomodation-search#76 was
 * reported only as "Credential sanitization failed; publication was blocked.".
 *
 * Run with: node tests/issue-2397-sanitizer-idempotency.test.mjs
 */

import assert from 'node:assert/strict';
import { findCredentialResiduals, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

const ARROW_AND_HASH_ROCKET_CASES = ['secret=>LH5qO6yo', 'const f = token => !token;', 'const isSet = token =>\n  Boolean(token);', '.filter(token => token.type !== "Shebang")', "{ 'password' => 'hunter2' }", ':token => "abc"', 'api_key => abc123', 'password => [abc]'];

for (const input of ARROW_AND_HASH_ROCKET_CASES) {
  await test(`sanitizing twice equals sanitizing once: ${JSON.stringify(input)}`, () => {
    const once = sanitizeCredentialText(input);
    assert.equal(sanitizeCredentialText(once), once);
    assert.deepEqual(findCredentialResiduals(once), []);
  });
}

await test('an arrow function with a sensitive parameter name no longer blocks publication', async () => {
  const output = await sanitizeForPublication('const f = token => !token;\n');
  assert.ok(!output.includes('!token'), 'the value is still masked');
  assert.match(output, /token => /, 'the arrow is kept intact');
});

await test("a hash-rocket keeps its separator and still masks the value: { 'password' => 'hunter2' }", () => {
  const output = sanitizeCredentialText("{ 'password' => 'hunter2' }");
  assert.ok(!output.includes('hunter2'));
  assert.match(output, /'password' => '/);
});

await test('plain `key=value` and `key: value` assignments are still masked', () => {
  for (const input of ['password=hunter2-long-value', 'token: abcdefghijklmnop', 'secret = s3cr3t']) {
    const output = sanitizeCredentialText(input);
    assert.notEqual(output, input, `${input} must be masked`);
    assert.equal(sanitizeCredentialText(output), output);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
