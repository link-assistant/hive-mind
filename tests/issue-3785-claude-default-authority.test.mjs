// @hive-mind-test-suite default
// Issue #3785 (2026-11-01 review): the default host -> root -> task projection
// must share Claude's credential *parent* and refresh locks, not a single file.
// All credentials below are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDockerIsolationStartArgs, getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { CLAUDE_DOCKER_AUTHORITY_HOME, CLAUDE_DOCKER_AUTHORITY_PARENT } from '../src/claude-auth-docker.lib.mjs';
import { ensureClaudeAuthAuthority, resolveClaudeAuthorityCredentialsPath } from '../src/claude-auth-authority.lib.mjs';
import { readCredentials } from '../src/limits.lib.mjs';

const oauth = (accessToken, refreshToken = `${accessToken}-REFRESH`) => JSON.stringify({ claudeAiOauth: { accessToken, refreshToken, expiresAt: 1, scopes: ['user:inference'], subscriptionType: 'max' } });

async function fixture(t, { legacy, canonical, env = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-default-authority-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'operator');
  const configurationHome = path.join(homeDir, '.claude');
  const parent = path.join(configurationHome, '.hive-mind-auth');
  const home = path.join(parent, 'claude');
  await fs.mkdir(configurationHome, { recursive: true, mode: 0o700 });
  for (const name of ['projects', 'sessions']) await fs.mkdir(path.join(configurationHome, name), { mode: 0o700 });
  const legacyPath = path.join(configurationHome, '.credentials.json');
  const canonicalPath = path.join(home, '.credentials.json');
  if (canonical !== undefined) {
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    await fs.writeFile(canonicalPath, canonical, { mode: 0o600 });
  }
  if (legacy !== undefined) await fs.writeFile(legacyPath, legacy, { mode: 0o600 });
  return { root, homeDir, configurationHome, parent, home, legacyPath, canonicalPath, env: { ...env } };
}

const exists = target =>
  fs.access(target).then(
    () => true,
    () => false
  );
const age = (target, msAgo) => fs.utimes(target, new Date(Date.now() - msAgo), new Date(Date.now() - msAgo));

test('Docker preparation moves the conventional credential into the shared authority and projects its parent', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: oauth('SYNTHETIC-A') });
  const inode = (await fs.stat(f.legacyPath)).ino;
  const prepared = await prepareDockerIsolationHostPaths({ tool: 'claude', homeDir: f.homeDir, env: f.env });
  assert.equal(await exists(f.legacyPath), false, 'conventional copy must not remain as a second authority');
  assert.equal(await fs.readFile(f.canonicalPath, 'utf8'), oauth('SYNTHETIC-A'));
  // rename keeps the inode, so a task that still holds the old file bind keeps writing the authority
  assert.equal((await fs.stat(f.canonicalPath)).ino, inode);
  for (const directory of [f.parent, f.home]) assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
  assert.equal(f.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, f.home);
  const mounts = await getDockerIsolationAuthMounts({ tool: 'claude', homeDir: f.homeDir, env: f.env, nativeAuthIdentity: prepared.nativeAuthIdentity });
  assert.ok(
    mounts.some(mount => mount.source === f.parent && mount.target === CLAUDE_DOCKER_AUTHORITY_PARENT),
    'the lock-bearing parent is shared'
  );
  assert.equal(
    mounts.some(mount => mount.target.endsWith('/.claude/.credentials.json')),
    false,
    'no file-only bind remains'
  );
  assert.equal(
    mounts.some(mount => mount.source === f.configurationHome),
    false,
    'configuration stays private'
  );
  const args = await buildDockerIsolationStartArgs('solve', [], { tool: 'claude', homeDir: f.homeDir, env: f.env, nativeAuthIdentity: prepared.nativeAuthIdentity, sessionId: 'synthetic-default-authority' });
  assert.ok(args.includes(`CLAUDE_SECURESTORAGE_CONFIG_DIR=${CLAUDE_DOCKER_AUTHORITY_HOME}`));
  assert.ok(args.includes(`HIVE_MIND_CLAUDE_AUTH_IDENTITY=${prepared.nativeAuthIdentity}`));
  assert.ok(args.includes(`${f.parent}:${CLAUDE_DOCKER_AUTHORITY_PARENT}`));
});

test('a direct run adopts an established authority but never migrates on its own', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: oauth('SYNTHETIC-A') });
  assert.deepEqual(await ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir }), { mode: 'conventional', reason: 'not-established' });
  assert.equal(await exists(f.legacyPath), true);
  assert.equal(f.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, undefined);
  await ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir, establish: true });
  const direct = {};
  assert.equal((await ensureClaudeAuthAuthority({ env: direct, homeDir: f.homeDir })).action, 'kept');
  assert.equal(direct.CLAUDE_SECURESTORAGE_CONFIG_DIR, f.home);
});

test('identical copies collapse to the authority', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: oauth('SYNTHETIC-A'), canonical: oauth('SYNTHETIC-A') });
  assert.equal((await ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir })).action, 'deduplicated');
  assert.equal(await exists(f.legacyPath), false);
});

test('a newer conventional login (re-login after migration) replaces the older authority and keeps it privately', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: oauth('SYNTHETIC-NEW'), canonical: oauth('SYNTHETIC-OLD') });
  await age(f.canonicalPath, 120_000);
  const result = await ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir });
  assert.equal(result.action, 'adopted-newer-login');
  assert.equal(await fs.readFile(f.canonicalPath, 'utf8'), oauth('SYNTHETIC-NEW'));
  assert.equal(await fs.readFile(result.superseded, 'utf8'), oauth('SYNTHETIC-OLD'));
  assert.equal(result.superseded.startsWith(`${f.parent}${path.sep}`), false, 'superseded copy is never projected to tasks');
  assert.equal((await fs.stat(result.superseded)).mode & 0o077, 0);
});

test('an older differing conventional copy is reported as a conflict, never silently picked', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: oauth('SYNTHETIC-OBSOLETE'), canonical: oauth('SYNTHETIC-CURRENT') });
  await age(f.legacyPath, 120_000);
  await assert.rejects(ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir, establish: true }), error => error.code === 'conflict' && !/SYNTHETIC/u.test(error.message));
  assert.equal(await fs.readFile(f.canonicalPath, 'utf8'), oauth('SYNTHETIC-CURRENT'));
  assert.equal(await exists(f.legacyPath), true);
  assert.equal(f.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, undefined);
  assert.equal(await exists(path.join(f.home, '.oauth_refresh.lock')), false, 'locks are released after a refusal');
  await assert.rejects(prepareDockerIsolationHostPaths({ tool: 'claude', homeDir: f.homeDir, env: f.env }), /Conflicting Claude credentials/u);
});

test('a conventional copy whose tokens were cleared does not replace a usable authority', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: JSON.stringify({ claudeAiOauth: null }), canonical: oauth('SYNTHETIC-CURRENT') });
  const result = await ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir });
  assert.equal(result.action, 'kept');
  assert.ok(result.superseded);
  assert.equal(await fs.readFile(f.canonicalPath, 'utf8'), oauth('SYNTHETIC-CURRENT'));
  assert.equal(await exists(f.legacyPath), false);
});

test('migration waits for, and then refuses during, a live native refresh; a stale lock is recovered', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: oauth('SYNTHETIC-A') });
  const lock = path.join(f.configurationHome, '.oauth_refresh.lock');
  await fs.mkdir(lock);
  await assert.rejects(ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir, establish: true, lockAttempts: 2, lockDelayMs: 1 }), error => error.code === 'refresh-busy');
  assert.equal(await exists(f.legacyPath), true, 'nothing moves while another process refreshes');
  await age(lock, 120_000);
  assert.equal((await ensureClaudeAuthAuthority({ env: f.env, homeDir: f.homeDir, establish: true, lockAttempts: 2, lockDelayMs: 1 })).action, 'migrated');
  assert.equal(await exists(lock), false);
});

test('explicit conventional opt-out, custom selectors, API-key hosts and unrecognized files keep their behavior', { timeout: 10000 }, async t => {
  const optOut = await fixture(t, { legacy: oauth('SYNTHETIC-A'), env: { HIVE_MIND_CLAUDE_AUTH_AUTHORITY: 'conventional' } });
  await prepareDockerIsolationHostPaths({ tool: 'claude', homeDir: optOut.homeDir, env: optOut.env });
  assert.equal(await exists(optOut.legacyPath), true);
  const mounts = await getDockerIsolationAuthMounts({ tool: 'claude', homeDir: optOut.homeDir, env: optOut.env });
  assert.ok(mounts.some(mount => mount.source === optOut.legacyPath));

  const custom = await fixture(t, { legacy: oauth('SYNTHETIC-A'), env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: '/synthetic/elsewhere' } });
  assert.deepEqual(await ensureClaudeAuthAuthority({ env: custom.env, homeDir: custom.homeDir, establish: true }), { mode: 'custom' });
  assert.equal(await exists(custom.legacyPath), true);

  const apiKey = await fixture(t);
  assert.equal((await ensureClaudeAuthAuthority({ env: apiKey.env, homeDir: apiKey.homeDir, establish: true })).reason, 'no-credentials');
  assert.equal(await exists(apiKey.parent), false, 'no authority directory is created without credentials');

  const opaque = await fixture(t, { legacy: 'synthetic opaque credential' });
  assert.equal((await ensureClaudeAuthAuthority({ env: opaque.env, homeDir: opaque.homeDir, establish: true })).reason, 'unrecognized-credentials');
  assert.equal(await exists(opaque.legacyPath), true);

  await assert.rejects(ensureClaudeAuthAuthority({ env: { HIVE_MIND_CLAUDE_AUTH_AUTHORITY: 'synthetic' }, homeDir: apiKey.homeDir }), error => error.code === 'invalid-mode');
});

test('/limits reads the authority the launches use', { timeout: 10000 }, async t => {
  const f = await fixture(t, { legacy: oauth('SYNTHETIC-A') });
  assert.equal(await resolveClaudeAuthorityCredentialsPath({ env: { ...f.env }, homeDir: f.homeDir }), f.legacyPath);
  await ensureClaudeAuthAuthority({ env: { ...f.env }, homeDir: f.homeDir, establish: true });
  const limitsPath = await resolveClaudeAuthorityCredentialsPath({ env: { ...f.env }, homeDir: f.homeDir });
  assert.equal(limitsPath, f.canonicalPath);
  assert.equal((await readCredentials(limitsPath)).claudeAiOauth.accessToken, 'SYNTHETIC-A');
  // Even when a reconcile cannot run (conflict), /limits reads the established authority.
  await fs.writeFile(f.legacyPath, oauth('SYNTHETIC-OBSOLETE'), { mode: 0o600 });
  await age(f.legacyPath, 120_000);
  assert.equal(await resolveClaudeAuthorityCredentialsPath({ env: { ...f.env }, homeDir: f.homeDir }), f.canonicalPath);
});
