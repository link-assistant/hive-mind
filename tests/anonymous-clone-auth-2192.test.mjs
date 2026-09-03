#!/usr/bin/env node

/**
 * Regression coverage for issue #2192 — `Reason: Repository setup failed`.
 *
 * The failing run (docs/case-studies/issue-2192/data/) clone-failed three times
 * with GitHub's anonymous-download refusal, classified it as "Unknown error",
 * and exited. Two defects are pinned here:
 *
 *   1. the message must be recognised (its own category, not "Unknown error"), and
 *   2. git must carry the token *preemptively*, because a credential helper is
 *      only consulted after a 401 and github.com answers 200 for public repos.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS, describeTransientError, isAnonymousDownloadLimit, isTransientNetworkError } from '../src/transient-errors.lib.mjs';
import { GIT_AUTH_TRANSPORT_DISABLE, GIT_AUTH_TRANSPORT_MARKER, buildAuthorizationHeader, buildGitAuthConfigEnv, ensureAuthenticatedGitTransport, gitAuthConfigKey, hasGitAuthConfig, isGitAuthTransportDisabled, readGitConfigCount, resolveGitHubToken } from '../src/git-auth-transport.lib.mjs';
import { classifyCloneError } from '../src/solve.repository.lib.mjs';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Verbatim from the failing run's log (see the case study).
const ANONYMOUS_LIMIT_MESSAGE = 'fatal: remote error: GitHub is temporarily limiting some unauthenticated downloads to protect the stability of the platform. Please retry later or authenticate.';

// --- classification ---------------------------------------------------------

test('the anonymous-download refusal is recognised, not reported as "Unknown error"', () => {
  const classification = classifyCloneError(ANONYMOUS_LIMIT_MESSAGE);
  assert.equal(classification.type, 'ANONYMOUS_RATE_LIMIT');
  assert.equal(classification.retryable, true);
  assert.notEqual(classification.description, 'Unknown error');
});

test('classification survives the shapes the message arrives in', () => {
  for (const value of [ANONYMOUS_LIMIT_MESSAGE, new Error(ANONYMOUS_LIMIT_MESSAGE), { stderr: ANONYMOUS_LIMIT_MESSAGE }, { stdout: `Cloning into 'repo'...\n${ANONYMOUS_LIMIT_MESSAGE}` }, { message: 'clone failed', cause: new Error(ANONYMOUS_LIMIT_MESSAGE) }]) {
    assert.equal(isAnonymousDownloadLimit(value), true, `recognised: ${JSON.stringify(value)}`);
  }
  assert.equal(isAnonymousDownloadLimit('fatal: repository not found'), false);
  assert.equal(isAnonymousDownloadLimit(null), false);
});

test('the refusal is transient and gets its own diagnostic category', () => {
  const description = describeTransientError(new Error(ANONYMOUS_LIMIT_MESSAGE));
  assert.equal(description.transient, true);
  assert.equal(description.category, 'github-anonymous-rate-limit');
  assert.ok(ANONYMOUS_DOWNLOAD_LIMIT_PATTERNS.includes(description.matchedPattern));
  assert.equal(isTransientNetworkError(ANONYMOUS_LIMIT_MESSAGE), true);
});

test('unrelated clone failures keep their existing classification', () => {
  assert.equal(classifyCloneError('fatal: repository not found').type, 'NOT_FOUND');
  assert.equal(classifyCloneError('remote: error: 503 service unavailable').type, 'TRANSIENT');
  assert.equal(classifyCloneError('fatal: Authentication failed').type, 'PERMISSION');
  assert.equal(classifyCloneError('You have exceeded a secondary rate limit').type, 'RATE_LIMIT');
  assert.equal(classifyCloneError('fatal: write error: No space left on device').type, 'ENOSPC');
});

// --- preemptive authentication ---------------------------------------------

test('the Authorization header carries the token as HTTP Basic, actions/checkout style', () => {
  const header = buildAuthorizationHeader('ghs_exampletoken');
  const [, encoded] = header.split('Authorization: Basic ');
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'x-access-token:ghs_exampletoken');
});

test('the git config key matches every repository on the host and nothing else', () => {
  assert.equal(gitAuthConfigKey('github.com'), 'http.https://github.com/.extraheader');
});

test('the token travels in GIT_CONFIG_* env vars, never in argv or a config file', () => {
  const patch = buildGitAuthConfigEnv({ token: 'ghs_exampletoken', env: {} });
  assert.equal(patch.GIT_CONFIG_COUNT, '1');
  assert.equal(patch.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(patch.GIT_CONFIG_VALUE_0, buildAuthorizationHeader('ghs_exampletoken'));
  assert.equal(patch[GIT_AUTH_TRANSPORT_MARKER], 'github.com');
});

test('existing GIT_CONFIG_* entries from the outer environment are preserved', () => {
  const env = { GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: 'ssh -i /key', GIT_CONFIG_KEY_1: 'safe.directory', GIT_CONFIG_VALUE_1: '*' };
  const patch = buildGitAuthConfigEnv({ token: 'ghs_exampletoken', env });
  assert.equal(patch.GIT_CONFIG_COUNT, '3');
  assert.equal(patch.GIT_CONFIG_KEY_2, 'http.https://github.com/.extraheader');
  assert.equal(patch.GIT_CONFIG_KEY_0, undefined, 'the caller-supplied entries are left untouched');
});

test('a malformed GIT_CONFIG_COUNT does not stop authentication', () => {
  assert.equal(readGitConfigCount({ GIT_CONFIG_COUNT: 'not-a-number' }), 0);
  assert.equal(readGitConfigCount({}), 0);
  assert.equal(buildGitAuthConfigEnv({ token: 't', env: { GIT_CONFIG_COUNT: 'x' } }).GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
});

test('hasGitAuthConfig sees authentication configured by an outer environment', () => {
  assert.equal(hasGitAuthConfig({}), false);
  assert.equal(hasGitAuthConfig({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: 'Authorization: Basic abc' }), true);
  // Declared but empty: a runner that exported the key without a value.
  assert.equal(hasGitAuthConfig({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0: '' }), false);
});

// --- the ensure* entry point ------------------------------------------------

const fakeDollar = result => {
  const tag = () => Promise.resolve(result);
  tag.mockDollar = true;
  return () => tag;
};

test('ensureAuthenticatedGitTransport applies the header from an env token', async () => {
  const env = {};
  const outcome = await ensureAuthenticatedGitTransport({ $: fakeDollar({ code: 1 })(), env: { ...env }, log: async () => {} });
  assert.ok(['applied', 'no-token'].includes(outcome.status));

  const withToken = { GH_TOKEN: 'ghs_fromenv' };
  const applied = await ensureAuthenticatedGitTransport({ $: fakeDollar({ code: 1 })(), env: withToken, log: async () => {} });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.source, 'GH_TOKEN');
  assert.equal(withToken.GIT_CONFIG_VALUE_0, buildAuthorizationHeader('ghs_fromenv'));
});

test('ensureAuthenticatedGitTransport is idempotent', async () => {
  const env = { GH_TOKEN: 'ghs_fromenv' };
  await ensureAuthenticatedGitTransport({ env, log: async () => {} });
  const second = await ensureAuthenticatedGitTransport({ env, log: async () => {} });
  assert.equal(second.status, 'already-configured');
  assert.equal(env.GIT_CONFIG_COUNT, '1', 'the header is not added twice');
});

test('an operator can opt out of forced authentication', async () => {
  assert.equal(isGitAuthTransportDisabled({ [GIT_AUTH_TRANSPORT_DISABLE]: 'true' }), true);
  assert.equal(isGitAuthTransportDisabled({ [GIT_AUTH_TRANSPORT_DISABLE]: '0' }), false);
  const env = { GH_TOKEN: 'ghs_fromenv', [GIT_AUTH_TRANSPORT_DISABLE]: '1' };
  const outcome = await ensureAuthenticatedGitTransport({ env, log: async () => {} });
  assert.equal(outcome.status, 'disabled');
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
});

test('an explicit env token wins over gh auth token, and gh is used otherwise', async () => {
  const fromEnv = await resolveGitHubToken({ $: fakeDollar({ code: 0, stdout: 'ghs_fromgh' })(), env: { GH_TOKEN: 'ghs_fromenv' } });
  assert.deepEqual([fromEnv.token, fromEnv.source], ['ghs_fromenv', 'GH_TOKEN']);

  const fromGh = await resolveGitHubToken({ $: fakeDollar({ code: 0, stdout: 'ghs_fromgh\n' })(), env: {} });
  assert.deepEqual([fromGh.token, fromGh.source], ['ghs_fromgh', 'gh auth token']);

  const loggedOut = await resolveGitHubToken({ $: fakeDollar({ code: 1, stderr: 'gh: not authenticated' })(), env: {} });
  assert.equal(loggedOut.token, null);
});

// --- wiring: every git network entry point authenticates first --------------

test('the clone paths authenticate before the first git network call', async () => {
  const repoSetup = await readFile(join(repoRoot, 'src/solve.repo-setup.lib.mjs'), 'utf8');
  const ensureIndex = repoSetup.indexOf('await ensureAuthenticatedGitTransport(');
  const cloneIndex = repoSetup.indexOf('await cloneRepository(');
  assert.ok(ensureIndex !== -1 && cloneIndex !== -1, 'both calls exist');
  assert.ok(ensureIndex < cloneIndex, 'authentication happens before the clone, not after it');

  for (const file of ['src/review.mjs', 'create-test-repo.mjs']) {
    const source = await readFile(join(repoRoot, file), 'utf8');
    assert.ok(source.includes('ensureAuthenticatedGitTransport'), `${file} authenticates its clone`);
  }
});

test('the retry paths recover instead of merely waiting', async () => {
  const repository = await readFile(join(repoRoot, 'src/solve.repository.lib.mjs'), 'utf8');
  assert.match(repository, /ANONYMOUS_RATE_LIMIT'\) \{\s*\n\s*await ensureAuthenticatedGitTransport\(\{ \$, log, repair: true/, 'the clone retry upgrades the transport before retrying');

  const lib = await readFile(join(repoRoot, 'src/lib.mjs'), 'utf8');
  assert.ok(lib.includes("description.category === 'github-anonymous-rate-limit'"), 'gitCmdRetry recovers the same way');
});

// --- the header must never reach a log ---------------------------------------

test('the preemptive Authorization header is sanitized in every representation', () => {
  // Issue #2192 sends the token on every git request; issue #2156 established
  // that an encoded credential in a log is still a leaked credential.
  const token = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB';
  const header = buildAuthorizationHeader(token);
  const encoded = header.split(' ').pop();
  const envDump = Object.entries(buildGitAuthConfigEnv({ token }))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  for (const [label, text] of [
    ['header', header],
    ['environment dump', envDump],
    ['bare base64', encoded],
  ]) {
    // `includeEnvironmentCredentials: false` proves the masking comes from the
    // text itself, not from the token happening to sit in the test's own env.
    const sanitized = sanitizeCredentialText(text, { includeEnvironmentCredentials: false });
    assert.ok(!sanitized.includes(token), `${label}: plaintext token must not survive`);
    assert.ok(!sanitized.includes(encoded), `${label}: base64 credential must not survive`);
  }
});

test('the already-configured path reports the transport state', async () => {
  const lines = [];
  const env = buildGitAuthConfigEnv({ token: 'ghs_state' });
  const result = await ensureAuthenticatedGitTransport({ env, log: async message => lines.push(message), reason: 'diagnostics' });
  assert.equal(result.status, 'already-configured');
  assert.match(lines.join('\n'), /already configured for github\.com - diagnostics/);
});
