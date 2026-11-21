#!/usr/bin/env node
/**
 * Issue #3445: release notes are passed through the publication sanitizer, and
 * code or option names in them are not credentials.
 *
 * The v2.33.5 and v2.33.6 notes were published with `…Tokens: [REDACTED]` and
 * `token => [REDACTED]`; rebuilding older notes would also have turned
 * `KNOWN_LOCAL_TOKEN_ENV_VARS` into `KNO…ARS`, `…_token_limit=<tokens>` into
 * `…_token_limit=[REDACTED]` and `--tokens-budget-stats with` into
 * `--tokens-budget-stats [REDACTED]`. The real credentials next to them must
 * still be masked.
 *
 * Run with: node tests/issue-3445-release-notes-not-masked.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
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

const options = { includeEnvironmentCredentials: false };

const unchanged = ['named variables (`fileTokens = await …`, `…Tokens: false`) are no longer masked', 'Logs containing `token => …` or a short known env value are published', '- `KNOWN_LOCAL_TOKEN_ENV_VARS` registry masks tokens by exact env value', '`-c model_auto_compact_token_limit=<tokens>` overrides.', 'Enhance --tokens-budget-stats with sub-session tracking', 'prevented the --tokens-budget-stats option from working', 'run with --max-tokens 4096', 'set `password=<secret>` in the config'];

for (const line of unchanged) {
  await test(`keeps release-note text unchanged: ${line}`, async () => {
    assert.equal(sanitizeCredentialText(line, options), line);
    assert.equal(await sanitizeForPublication(line, options), line);
  });
}

const masked = [
  ['token: abcdefghij1234567890`)', 'abcdefghij1234567890'],
  ['password=hunter2-correct-horse)', 'hunter2-correct-horse'],
  ['--token abcdefghijkl123', 'abcdefghijkl123'],
  ['--access-tokens abcdefghijkl123', 'abcdefghijkl123'],
  ['--github-token=abcdefghijkl123', 'abcdefghijkl123'],
  ['leaked SYNTHETIC_TOKEN_ALPHA_123456 in a log', 'SYNTHETIC_TOKEN_ALPHA_123456'],
  ['token: <script>alert(1)</script>', '<script>alert(1)</script>'],
];

for (const [line, secret] of masked) {
  await test(`still masks a credential: ${line}`, async () => {
    const output = sanitizeCredentialText(line, options);
    assert.ok(!output.includes(secret), output);
  });
}

await test('no CHANGELOG.md line is changed by the publication sanitizer', async () => {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const changed = [];
  for (const line of changelog.split('\n')) {
    if ((await sanitizeForPublication(line, options)) !== line) changed.push(line);
  }
  assert.deepEqual(changed, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
