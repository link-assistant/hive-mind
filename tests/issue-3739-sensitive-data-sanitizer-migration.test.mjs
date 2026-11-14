#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
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
import { SENSITIVE_DATA_SANITIZER_PACKAGE, UPSTREAM, credentialEnvironmentValues, loadSensitiveDataSanitizer } from '../src/sensitive-data-sanitizer.lib.mjs';
import { KNOWN_LOCAL_TOKEN_ENV_VARS, getEnvironmentTokens, getGitHubTokensFromFiles, sanitizeForPublication, sanitizeOutput } from '../src/token-sanitization.lib.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  // 0.22.4 fixed #172 and #177; #173 (long credential values scan slowly) is a
  // documented limit and #181 (double-backtick code spans) needs a workaround.
  assert.ok(Object.isFrozen(UPSTREAM));
  for (const [key, url] of Object.entries(UPSTREAM)) assert.match(url, /^https:\/\/github\.com\/link-foundation\/sensitive-data-sanitizer\/issues\/\d+$/, key);
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
  for (const prefix of ['', 'start of output\nresponse body=\n']) {
    const suffix = prefix ? '\ntrailing line\n' : '';
    const output = sanitize(prefix + wrapped + suffix);
    assert.ok(output.startsWith(prefix) && output.endsWith(suffix), 'surrounding prose stays intact');
    const body = output.slice(prefix.length, suffix ? -suffix.length : undefined);
    const decoded = Buffer.from(body.replace(/\n/g, ''), 'base64').toString();
    assert.deepEqual(JSON.parse(decoded), { note: 'x'.repeat(60), token: 'ghp…b4N', more: 'y'.repeat(60) });
    const outputLines = body.split('\n');
    assert.ok(outputLines.length > 1 && outputLines.slice(0, -1).every(line => line.length === 40), 'the 40-column wrapping is kept');
  }
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
  const output = dockerErrorMessage({ message: `docker run --env API_TOKEN=${OPAQUE} --token ${OPAQUE} -H "Authorization: token ${GITHUB_TOKEN}"` });
  assert.ok(!output.includes(OPAQUE) && !output.includes(GITHUB_TOKEN));
  assert.match(output, /--env API_TOKEN=\*\*\*/);
  assert.match(output, /--token f3a…3e5/);
  assert.match(output, /Authorization: token ghp…b4N/);
});

console.log('\n6. Known local values are collected by the library\n');

// Awaits `fn`, so asynchronous readers see the environment too.
const withEnv = async (env, fn) => {
  const saved = Object.fromEntries(Object.keys(env).map(name => [name, process.env[name]]));
  Object.assign(process.env, env);
  try {
    return await fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

await test('credential-named environment values are selected; configuration values are not (upstream #141, fixed natively)', () => {
  const credentials = { PGPASSWORD: `pg-${OPAQUE}`, GITHUBTOKEN: `gt-${OPAQUE}`, SESSION_COOKIE: `ck-${OPAQUE}`, GITHUB_PAT: `pat-${OPAQUE}`, AWS_SECRET_ACCESS_KEY: `aws-${OPAQUE}` };
  const configuration = { HIVE_MIND_ROUTER_AUTH_GUARD: '0', MAX_TOKEN_COUNT: '4096', TOKEN_LIMIT: '512', SSH_KEY_PATH: '/tmp/key-path-value', SECRET_NAME: 'name-value', GIT_CONFIG_KEY_0: 'http.extraheader', AWS_ACCESS_KEY_ID: 'id-value' };
  const values = new Set(credentialEnvironmentValues({ ...credentials, ...configuration, HOME: '/home/user' }));
  for (const [name, value] of Object.entries(credentials)) assert.ok(values.has(value), `${name} is a credential`);
  for (const [name, value] of Object.entries(configuration)) assert.ok(!values.has(value), `${name} is configuration`);
  assert.ok(!values.has('/home/user'));
});

await test('a flag set to 0 does not mask every 0 of a log; a credential-named value is masked anywhere', () =>
  withEnv({ HIVE_MIND_ROUTER_AUTH_GUARD: '0', PGPASSWORD: `pg-${OPAQUE}` }, () => {
    const output = sanitizeCredentialText(`exit 0 after 4096 ms, pass pg-${OPAQUE}`);
    assert.equal(output, 'exit 0 after 4096 ms, pass pg-…3e5');
  }));

await test('getEnvironmentTokens reads the explicit KNOWN_LOCAL_TOKEN_ENV_VARS selection', () =>
  withEnv({ TELEGRAM_OWNER_CHAT_ID: '1234567890' }, () => {
    assert.ok(KNOWN_LOCAL_TOKEN_ENV_VARS.includes('TELEGRAM_OWNER_CHAT_ID'));
    assert.deepEqual(
      getEnvironmentTokens().filter(({ name }) => name === 'TELEGRAM_OWNER_CHAT_ID'),
      [{ name: 'TELEGRAM_OWNER_CHAT_ID', value: '1234567890' }]
    );
  }));

await test('getGitHubTokensFromFiles reads every hosts.yml account and survives a malformed file', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hive-3739-gh-'));
  const second = ['gho_', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn', '7Op8Qr9St0Uv1Wx2Yz3A'].join('');
  try {
    writeFileSync(join(directory, 'hosts.yml'), `github.com:\n  users:\n    first:\n      oauth_token: ${GITHUB_TOKEN}\n    second:\n      oauth_token: ${second}\n  oauth_token: ${GITHUB_TOKEN}\n  user: first\n`);
    // Assertions compare without printing values: a wrong directory would read real tokens.
    const tokens = await withEnv({ GH_CONFIG_DIR: directory }, () => getGitHubTokensFromFiles());
    assert.ok(tokens.length === 2 && tokens.includes(GITHUB_TOKEN) && tokens.includes(second), `expected both synthetic accounts, got ${tokens.length} value(s)`);
    writeFileSync(join(directory, 'hosts.yml'), 'github.com:\n  oauth_token: [unclosed\n');
    const malformed = await withEnv({ GH_CONFIG_DIR: directory }, () => getGitHubTokensFromFiles());
    assert.equal(malformed.length, 0, 'a malformed hosts.yml gives no tokens');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
