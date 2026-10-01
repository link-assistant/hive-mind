#!/usr/bin/env node
/**
 * Issue #2400: a language keyword assigned to a sensitive-named variable is code,
 * not a credential.
 *
 * The published excerpts of the #2398 session log read
 * `const fileTokens = [REDACTED] getGitHubTokensFromFiles();` and
 * `skipActiveTokensOutputSanitization: [REDACTED],` — the unquoted-assignment rule
 * masked `await` and `false` because the key contains `token`. The real
 * credentials next to them must still be masked.
 *
 * Run with: node tests/issue-2400-keyword-assignment-not-masked.test.mjs
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

const unchanged = ['const fileTokens = await getGitHubTokensFromFiles();', 'const secretlintResiduals = await detectSecretsWithSecretlint(value);', '    skipActiveTokensOutputSanitization: false,', '{ skipActiveTokensOutputSanitization = false, excludeTokens = [] } = options', 'export const getAllKnownLocalTokens = async () => {', 'const detectSecretsWithSecretlint = async (content, options = {}) => {', 'maskSecrets: false, // We need raw positions', 'secretlintDetections: null,', 'password = None', 'token: undefined', 'const sessionToken = new SessionToken();'];

for (const line of unchanged) {
  await test(`keeps code unchanged: ${line.trim()}`, async () => {
    assert.equal(sanitizeCredentialText(line, { includeEnvironmentCredentials: false }), line);
    assert.deepEqual(findCredentialResiduals(line), []);
  });
}

const masked = [
  ['password=hunter2-correct-horse', 'hunter2-correct-horse'],
  ['token: s3cr3t-value-0123456789', 's3cr3t-value-0123456789'],
  ['api_key = falsehood-is-not-a-keyword', 'falsehood-is-not-a-keyword'],
  ['SECRET=awaitingApproval42xyz', 'awaitingApproval42xyz'],
];

for (const [line, secret] of masked) {
  await test(`still masks a credential that only starts like a keyword: ${line}`, async () => {
    const output = sanitizeCredentialText(line, { includeEnvironmentCredentials: false });
    assert.ok(!output.includes(secret), output);
  });
}

await test('a code excerpt from the #2398 log publishes unchanged', async () => {
  const excerpt = ['const fileTokens = await getGitHubTokensFromFiles();', 'const commandTokens = await getGitHubTokensFromCommand();', 'return sanitizeOutput(text, { skipActiveTokensOutputSanitization: false, excludeTokens: [] });'].join('\n');
  assert.equal(await sanitizeForPublication(excerpt, { includeEnvironmentCredentials: false }), excerpt);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
