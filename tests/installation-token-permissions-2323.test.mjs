/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { probeGitWriteAccess, probeInstallationWriteAccess } from '../src/github-write-permission.lib.mjs';

const { Headers, Response } = globalThis;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const permissions = { admin: false, maintain: false, push: false, pull: false, triage: false };

// Exercise the production functions with only their external dependencies mocked.
function loadPermissionChecks(writeAccess) {
  const calls = [];
  const command = async strings => {
    const text = strings.join('');
    calls.push(text);
    return text.includes('.permissions') ? { code: 0, stdout: JSON.stringify(permissions) } : { code: 1, stdout: '', stderr: 'HTTP 403' };
  };
  const $ = input => (Array.isArray(input) ? command(input) : command);
  const dependencies = {
    $,
    ghCmdRetry: callback => callback(),
    githubLib: { detectRepositoryVisibility: async () => ({ isPublic: true }) },
    log: async () => {},
    detectAllowForking: async () => true,
    describeRepoPermissionLevel: () => 'No confirmed repository access',
    probeInstallationWriteAccess: async () => writeAccess,
    cleanErrorMessage: String,
    reportError: () => {},
    QUIET_PROBE: {},
  };
  const declaration = `const { ${Object.keys(dependencies).join(', ')} } = dependencies;`;
  const forkSource = readFileSync(new URL('../src/solve.fork-detection.lib.mjs', import.meta.url), 'utf8');
  const forkFunction = forkSource.slice(forkSource.indexOf('export async function handleAutoForkOption'), forkSource.indexOf('/**\n * After a fork PR')).replace('export ', '');
  const githubSource = readFileSync(new URL('../src/github.lib.mjs', import.meta.url), 'utf8');
  const writeFunction = githubSource.slice(githubSource.indexOf('export const checkRepositoryWritePermission'), githubSource.indexOf('/**\n * Check if maintainer can modify')).replace('export ', '');
  return {
    calls,
    autoFork: params => new AsyncFunction('dependencies', 'params', `${declaration}\n${forkFunction}\nreturn handleAutoForkOption(params);`)(dependencies, params),
    checkWrite: () => new AsyncFunction('dependencies', `${declaration}\n${writeFunction}\nreturn checkRepositoryWritePermission('test', 'repository');`)(dependencies),
  };
}

test('installation token with Contents write does not enter fork mode when REST role fields are false', { timeout: 5000 }, async () => {
  const checks = loadPermissionChecks(true);
  const argv = { autoFork: true, fork: false };
  await checks.autoFork({ owner: 'test', repo: 'repository', argv, safeExit: () => assert.fail('unexpected exit') });
  assert.equal(argv.fork, false, 'work directly in the repository; installation tokens cannot query /user');
  assert.ok(checks.calls.every(command => !command.includes('user')));
});

test('installation token with Contents write passes the direct repository write check', { timeout: 5000 }, async () => {
  const checks = loadPermissionChecks(true);
  assert.equal(await checks.checkWrite(), true);
  assert.ok(checks.calls.every(command => !command.includes('user')));
});

test('a denied write probe preserves read-only permission behavior', { timeout: 5000 }, async () => {
  const checks = loadPermissionChecks(false);
  const argv = { autoFork: true, fork: false };
  await checks.autoFork({ owner: 'test', repo: 'repository', argv, safeExit: () => assert.fail('unexpected exit') });
  assert.equal(argv.fork, true);
  assert.equal(await checks.checkWrite(), false);
});

const installationToken = ['ghs', 'fixture'].join('_');
const probeOptions = { owner: 'test', repo: 'repository', token: installationToken };
const advertisement = 'application/x-git-receive-pack-advertisement';

test('write authorization uses a read-only authenticated GET and cancels the response body', async () => {
  let cancelled = false;
  const allowed = await probeGitWriteAccess({
    ...probeOptions,
    fetchImpl: async (url, options) => {
      assert.equal(url.href, 'https://github.com/test/repository.git/info/refs?service=git-receive-pack');
      assert.equal(options.method, undefined, 'fetch defaults to GET; no push is sent');
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, 'error', 'credentials never follow a redirect');
      assert.ok(options.signal instanceof AbortSignal);
      const credentials = Buffer.from(options.headers.Authorization.slice('Basic '.length), 'base64').toString();
      assert.equal(credentials, `x-access-token:${installationToken}`);
      return { status: 200, headers: new Headers({ 'content-type': `${advertisement}; charset=utf-8` }), body: { cancel: async () => (cancelled = true) } };
    },
  });
  assert.equal(allowed, true);
  assert.equal(cancelled, true);
});

test('unauthorized, forbidden, and inaccessible repositories cannot grant write access', async () => {
  for (const status of [401, 403, 404]) {
    assert.equal(await probeGitWriteAccess({ ...probeOptions, fetchImpl: async () => new Response('', { status }) }), false);
  }
});

test('unexpected responses and transport failures cannot grant write access', async () => {
  await assert.rejects(probeGitWriteAccess({ ...probeOptions, fetchImpl: async () => new Response('<html>login</html>', { headers: { 'content-type': 'text/html' } }) }), /unexpected content type/);
  await assert.rejects(probeGitWriteAccess({ ...probeOptions, fetchImpl: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(
    probeGitWriteAccess({
      ...probeOptions,
      fetchImpl: async () => {
        throw new Error('network unavailable');
      },
    }),
    /network unavailable/
  );
});

test('installation probe uses the same token precedence as gh and leaves user-role checks unchanged', async () => {
  const fetchImpl = () => assert.fail('ordinary user tokens require no Git probe');
  assert.equal(await probeInstallationWriteAccess({ owner: 'test', repo: 'repository', env: {}, fetchImpl }), false);
  assert.equal(await probeInstallationWriteAccess({ owner: 'test', repo: 'repository', env: { GH_TOKEN: 'user-token', GITHUB_TOKEN: installationToken }, fetchImpl }), false);
  for (const env of [{ GH_TOKEN: installationToken }, { GITHUB_TOKEN: installationToken }]) {
    assert.equal(await probeInstallationWriteAccess({ owner: 'test', repo: 'repository', env, fetchImpl: async () => new Response('', { headers: { 'content-type': advertisement } }) }), true);
  }
});

test('probe validates destinations and supports the configured GitHub Enterprise host', async () => {
  const authenticatedServer = new URL('https://github.com');
  authenticatedServer.username = 'fixture';
  authenticatedServer.password = 'fixture';
  for (const invalid of [{ owner: '../other' }, { repo: 'repo?service=other' }, { serverUrl: 'http://github.com' }, { serverUrl: authenticatedServer.href }, { serverUrl: 'https://github.com/other' }]) {
    await assert.rejects(probeGitWriteAccess({ ...probeOptions, ...invalid, fetchImpl: () => assert.fail('invalid destination must not receive a token') }), /Invalid/);
  }
  assert.equal(
    await probeInstallationWriteAccess({
      owner: 'test',
      repo: 'repository',
      env: { GH_TOKEN: installationToken, GH_HOST: 'github.enterprise.example' },
      fetchImpl: async url => {
        assert.equal(url.host, 'github.enterprise.example');
        return new Response('', { headers: { 'content-type': advertisement } });
      },
    }),
    true
  );
});
