#!/usr/bin/env node
/**
 * Issues #3739 and #3740: Hive Mind's credential sanitization runs on
 * @link-foundation/sensitive-data-sanitizer.
 *
 * #3739: `Authorization: token <value>` masked the scheme word (`token`) and
 * left the credential readable. The scheme must stay and the value must be
 * masked, for every scheme, and shell expressions such as `$(gh auth token)`
 * are not credentials.
 *
 * #3740: the library is the detection and masking engine of every sanitizer
 * (sanitizeCredentialText, sanitizeOutput, sanitizeForPublication, the stream
 * sanitizer and the local redactors). Hive Mind keeps its policy on top of it:
 * credentials only (emails, account ids and logins stay), readable format
 * context, the #1745 carve-out, and workarounds for the library gaps reported
 * upstream (see UPSTREAM in src/sensitive-data-sanitizer.lib.mjs).
 *
 * Every secret below is synthetic and assembled at runtime.
 *
 * Run with: node tests/issue-3739-sensitive-data-sanitizer-migration.test.mjs
 */

import assert from 'node:assert/strict';
import { createCredentialStreamSanitizer, findCredentialResiduals, sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';
import { SENSITIVE_DATA_SANITIZER_PACKAGE, UPSTREAM, loadSensitiveDataSanitizer } from '../src/sensitive-data-sanitizer.lib.mjs';
import { sanitizeForPublication, sanitizeOutput } from '../src/token-sanitization.lib.mjs';
import { redactProcessText } from '../src/process-debug.lib.mjs';
import { redactAuthOutput } from '../src/telegram-auth-command.lib.mjs';
import { dockerErrorMessage } from '../src/docker-sidecar.lib.mjs';

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

const OPTIONS = Object.freeze({ includeEnvironmentCredentials: false });
const sanitize = (text, options = {}) => sanitizeCredentialText(text, { ...OPTIONS, ...options });
const assertFixedPoint = (output, options = {}) => assert.equal(sanitize(output, options), output, `a second pass changes ${JSON.stringify(output)}`);

const GITHUB_TOKEN = ['ghp_', 'Zx9Qw7Er5Ty3Ui1Op0As', '2Df4Gh6Jk8Lz0Xc2Vb4N'].join('');
const OPAQUE = ['f3a9', 'c2e1b7d4', '9a0e6f12', 'c4b8d3e5'].join('');
const BASIC = Buffer.from(`user:${OPAQUE}`).toString('base64');

console.log('1. The library is the engine\n');

await test('the library loads synchronously', () => {
  const library = loadSensitiveDataSanitizer();
  assert.equal(SENSITIVE_DATA_SANITIZER_PACKAGE, '@link-foundation/sensitive-data-sanitizer');
  assert.equal(typeof library.createSyncSanitizer, 'function');
  assert.equal(typeof library.redact, 'function');
});

await test('every workaround names the upstream issue it waits for', () => {
  assert.ok(Object.keys(UPSTREAM).length > 0);
  for (const [key, url] of Object.entries(UPSTREAM)) assert.match(url, /^https:\/\/github\.com\/link-foundation\/sensitive-data-sanitizer\/issues\//, key);
});

console.log('\n2. Issue #3739: the Authorization scheme stays, the value is masked\n');

const SCHEME_CASES = [
  [`curl -H "Authorization: token ${GITHUB_TOKEN}" https://api.github.com/user`, 'curl -H "Authorization: token ghp…b4N" https://api.github.com/user'],
  [`Authorization: Bearer ${OPAQUE}`, 'Authorization: Bearer f3a…3e5'],
  [`Authorization: Basic ${BASIC}`, `Authorization: Basic ${BASIC.slice(0, 3)}…${BASIC.slice(-3)}`],
  [`Authorization: ApiKey ${OPAQUE}`, 'Authorization: ApiKey f3a…3e5'],
  [`Authorization: CustomScheme ${OPAQUE}`, 'Authorization: CustomScheme f3a…3e5'],
  [`Proxy-Authorization: Bearer ${OPAQUE}`, 'Proxy-Authorization: Bearer f3a…3e5'],
  [`{"headers":{"Authorization":"token ${GITHUB_TOKEN}"}}`, '{"headers":{"Authorization":"token ghp…b4N"}}'],
];

for (const [input, expected] of SCHEME_CASES) {
  await test(`scheme kept: ${expected}`, () => {
    const output = sanitize(input);
    assert.equal(output, expected);
    assert.ok(!output.includes(GITHUB_TOKEN) && !output.includes(OPAQUE) && !output.includes(BASIC));
    assertFixedPoint(output);
    assert.deepEqual(findCredentialResiduals(output), []);
  });
}

const PRESERVED = ['curl -H "Authorization: token $(gh auth token)" https://api.github.com/user', 'Authorization: Bearer ${{ secrets.GITHUB_TOKEN }}', 'Authorization: token ${GITHUB_TOKEN}', 'Authorization: Bearer $TOKEN', 'Authorization: Bearer <your-token>'];
for (const input of PRESERVED) {
  await test(`shell expressions and placeholders are not credentials: ${input}`, () => assert.equal(sanitize(input), input));
}

console.log('\n3. Issue #3740: credentials only, readable context\n');

await test('emails, account ids and logins stay (#3724 rule 14)', () => {
  const input = 'Contact someone@example.com, account 12345, login octocat, user id 987654';
  assert.equal(sanitize(input), input);
});

await test('a `key: value` line context masks the value, not the rest of the sentence', () => {
  const output = sanitize(`User token: ${GITHUB_TOKEN}. Next sentence`);
  assert.equal(output, 'User token: ghp…b4N. Next sentence');
  assertFixedPoint(output);
});

await test('masks of other tools (`***`) are already masked', () => {
  const input = 'docker run --env TOKEN_SECRET=*** image';
  assert.equal(sanitize(input), input);
});

await test('a private key body is masked and its markers and the text around it stay', () => {
  const body = ['MIIEvQIBADANBgkqhkiG', '9w0BAQEFAASC'].join('');
  const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\nbetween line stays\n-----BEGIN PRIVATE KEY-----\n${body}${body}\n-----END PRIVATE KEY-----`;
  const output = sanitize(pem);
  assert.ok(!output.includes(body));
  assert.equal(output.match(/-----BEGIN PRIVATE KEY-----/g).length, 2);
  assert.match(output, /\nbetween line stays\n/);
  assertFixedPoint(output);
});

console.log('\n4. Encoded credentials and library limits\n');

await test('a credential inside line-wrapped base64 is masked and the wrapping kept', () => {
  const doc = JSON.stringify({ note: 'x'.repeat(60), token: GITHUB_TOKEN, more: 'y'.repeat(60) });
  const wrapped = Buffer.from(doc)
    .toString('base64')
    .match(/.{1,40}/g)
    .join('\n');
  const output = sanitize(wrapped);
  const decoded = Buffer.from(output.replace(/\n/g, ''), 'base64').toString();
  assert.ok(!decoded.includes(GITHUB_TOKEN));
  assert.ok(decoded.includes('"note":"xxx'));
  const outputLines = output.split('\n');
  assert.ok(outputLines.length > 1 && outputLines.slice(0, -1).every(line => line.length === 40), 'the 40-column wrapping is kept');
});

await test('a long list of identifiers is not masked as one encoded run; the credential after it is', () => {
  const lines = Array.from({ length: 3000 }, (_, i) => `id_${String(i).padStart(4, '0')}abcdefghijklmnop`);
  const output = sanitize(`${lines.join('\n')}\ntoken: ${GITHUB_TOKEN}\n`);
  assert.ok(!output.includes(GITHUB_TOKEN));
  assert.equal(output, `${lines.join('\n')}\ntoken: ghp…b4N\n`);
});

await test('a log with more than 4096 decodable runs is inspected in pieces instead of failing (ERR_LIMIT)', () => {
  const lines = Array.from({ length: 5000 }, (_, i) => Buffer.from(`chunk number ${i} ok`).toString('base64'));
  const output = sanitize(`${lines.join('\n')}\ntoken: ${GITHUB_TOKEN}`);
  assert.equal(output, `${lines.join('\n')}\ntoken: ghp…b4N`);
});

await test('a short hex token is masked without blocking the whole text (ERR_ENCODING)', () => {
  const hex = Buffer.from(['Plain', 'TextPass', 'word1'].join('')).toString('hex');
  const output = sanitize(`password=${hex} and the rest stays`);
  assert.ok(!output.includes(hex));
  assert.match(output, /and the rest stays$/);
});

for (const length of [12, 15, 16, 20]) {
  await test(`the hex and base64 forms of a ${length}-character known secret are masked`, () => {
    const secret = ['Pk7Rm2Qx9L', 'wZaB8yCd4E'].join('').slice(0, length);
    for (const encoded of [Buffer.from(secret).toString('hex'), Buffer.from(secret).toString('base64')]) {
      for (const knownOnly of [false, true]) {
        const output = sanitize(`x ${encoded} y`, { knownTokens: [secret], knownOnly });
        assert.ok(!output.includes(encoded), `${encoded} (knownOnly: ${knownOnly})`);
        assertFixedPoint(output, { knownTokens: [secret], knownOnly });
      }
    }
  });
}

await test('knownOnly masks the known value and nothing else', () => {
  const known = ['Pk7Rm2', 'Qx9Lw'].join('');
  assert.equal(sanitize(`known ${known} and ${GITHUB_TOKEN}`, { knownTokens: [known], knownOnly: true }), `known [REDACTED] and ${GITHUB_TOKEN}`);
});

console.log('\n5. Every sanitizer runs on the same engine\n');

await test('the stream sanitizer keeps the scheme across chunk boundaries', () => {
  const stream = createCredentialStreamSanitizer(OPTIONS);
  const line = `Authorization: token ${GITHUB_TOKEN}\n`;
  const output = stream.write(line.slice(0, 25)) + stream.write(line.slice(25)) + stream.flush();
  assert.equal(output, 'Authorization: token ghp…b4N\n');
});

await test('sanitizeOutput keeps the scheme', async () => {
  const output = await sanitizeOutput(`Authorization: token ${GITHUB_TOKEN}`, { warnOnMismatch: false });
  assert.equal(output, 'Authorization: token ghp…b4N');
});

await test('sanitizeOutput leaves excluded (user-provided) tokens alone (#1745)', async () => {
  const input = `token: ${GITHUB_TOKEN}`;
  assert.equal(await sanitizeOutput(input, { warnOnMismatch: false, excludeTokens: [GITHUB_TOKEN] }), input);
});

await test('sanitizeForPublication keeps the scheme and passes its residual check', async () => {
  const output = await sanitizeForPublication(`curl -H "Authorization: token ${GITHUB_TOKEN}"\n`);
  assert.equal(output, 'curl -H "Authorization: token ghp…b4N"\n');
});

await test('redactProcessText (process debug) keeps the scheme', () => {
  assert.equal(redactProcessText(`Authorization: Bearer ${OPAQUE}`), 'Authorization: Bearer f3a…3e5');
});

await test('redactAuthOutput (/auth) keeps labels and masks tokens', () => {
  const output = redactAuthOutput(`\u001b[32m✓\u001b[0m Token: ${GITHUB_TOKEN}`);
  assert.equal(output, '✓ Token: ghp…b4N');
});

await test('docker error messages keep their argv masking and mask other credentials', () => {
  const output = dockerErrorMessage({ message: `docker run --env API_TOKEN=${OPAQUE} -H "Authorization: token ${GITHUB_TOKEN}"` });
  assert.ok(!output.includes(OPAQUE) && !output.includes(GITHUB_TOKEN));
  assert.match(output, /--env API_TOKEN=\*\*\*/);
  assert.match(output, /Authorization: token ghp…b4N/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
