// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readCodexAuth, resolveLimitsCredentialPaths, getCodexUsageLimits, getCachedCodexLimits, getCachedCodexSubscription, resetLimitCache } from '../src/limits.lib.mjs';
import { readCanonicalCodexAuth } from '../src/codex-canonical-auth.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-limits-authority-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const canonical = path.join(root, 'canonical');
  const configuration = path.join(root, 'configuration');
  await fs.mkdir(canonical, { mode: 0o700 });
  await fs.mkdir(configuration, { mode: 0o700 });
  const previous = { CODEX_AUTH_HOME: process.env.CODEX_AUTH_HOME, CODEX_HOME: process.env.CODEX_HOME, HOME: process.env.HOME };
  Object.assign(process.env, { CODEX_AUTH_HOME: canonical, CODEX_HOME: configuration, HOME: path.join(root, 'operator') });
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  const auth = path.join(canonical, 'auth.json');
  await fs.writeFile(auth, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'synthetic-canonical' } }), { mode: 0o600 });
  const protectedAuth = path.join(root, 'protected-auth.json');
  await fs.writeFile(protectedAuth, JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: 'synthetic-private' } }), { mode: 0o600 });
  return { root, canonical, configuration, auth, protectedAuth };
}

for (const configurationHome of ['', '.', 'relative', '/', '/private/../other', '/private//config', '/private/config\n']) {
  test(`selected Codex authentication refuses an ambiguous configuration selector ${JSON.stringify(configurationHome)}`, { timeout: 5000 }, async t => {
    const f = await fixture(t);
    await assert.rejects(readCanonicalCodexAuth(f.canonical, { configurationHome }), /Canonical Codex authentication storage/u);
  });
}

test('selected limits do not replace an explicitly empty private selector with a fallback home', { timeout: 5000 }, async t => {
  await fixture(t);
  process.env.CODEX_HOME = '';
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new globalThis.Response('{}'));
  assert.equal((await getCodexUsageLimits()).success, false);
  assert.equal(fetcher.mock.callCount(), 0);
});

test('selected canonical credentials cannot be sent to a private configuration endpoint', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.configuration, 'config.toml'), 'chatgpt_base_url = "https://private-endpoint.invalid"\n');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return new globalThis.Response('{}');
  });
  assert.equal((await getCodexUsageLimits()).success, true);
  assert.deepEqual(requests, ['https://chatgpt.com/backend-api/wham/usage']);
});

test('cached selected results cannot bypass changed storage admission', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  resetLimitCache();
  t.after(resetLimitCache);
  const payload = Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'pro' } })).toString('base64url');
  await fs.writeFile(f.auth, JSON.stringify({ tokens: { id_token: `synthetic.${payload}.synthetic` } }));
  let requests = 0;
  const fetchLimits = async () => {
    requests++;
    return { success: true, marker: 'admitted' };
  };
  assert.equal((await getCachedCodexLimits(false, { fetchLimits })).success, true);
  assert.equal((await getCachedCodexSubscription()).success, true);
  await fs.chmod(f.canonical, 0o755);
  assert.equal((await getCachedCodexLimits(false, { fetchLimits })).success, false);
  assert.equal((await getCachedCodexSubscription()).success, false);
  assert.equal(requests, 1);
});

test('Codex limits select native authentication independently of private configuration', () => {
  const selected = resolveLimitsCredentialPaths({ CODEX_HOME: '/private/config', CODEX_AUTH_HOME: '/canonical/auth' }, '/operator');
  assert.equal(selected.codex, '/canonical/auth/auth.json');
  assert.equal(selected.codexConfig, '/private/config/config.toml');
});

test('Codex limits never normalize an invalid selected authority into another path', () => {
  for (const selector of ['', '.', 'relative', '/', '/canonical/../other', '/canonical//auth', '/canonical/auth\n']) {
    assert.throws(() => resolveLimitsCredentialPaths({ CODEX_AUTH_HOME: selector }, '/operator'), /Canonical Codex authentication storage/u);
  }
});

test('native-selected limits read canonical bytes and observe atomic replacement', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  assert.equal((await readCodexAuth()).tokens.access_token, 'synthetic-canonical');
  const replacement = path.join(f.canonical, 'replacement');
  await fs.writeFile(replacement, JSON.stringify({ tokens: { access_token: 'synthetic-next' } }), { mode: 0o600 });
  await fs.rename(replacement, f.auth);
  assert.equal((await readCodexAuth()).tokens.access_token, 'synthetic-next');
});

test('missing canonical credentials never send a private-home credential', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await fs.copyFile(f.protectedAuth, path.join(f.configuration, 'auth.json'));
  await fs.unlink(f.auth);
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new globalThis.Response('{}'));
  const result = await getCodexUsageLimits(false, undefined, 'http://127.0.0.1');
  assert.equal(result.success, false);
  assert.equal(result.failureKind, 'auth');
  assert.equal(fetcher.mock.callCount(), 0);
});

test('an explicit private credential path cannot bypass the selected canonical authority', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await fs.copyFile(f.protectedAuth, path.join(f.configuration, 'auth.json'));
  assert.equal(await readCodexAuth(path.join(f.configuration, 'auth.json')), null);
});

test('a second private credential authority refuses even when canonical credentials are healthy', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  await fs.copyFile(f.protectedAuth, path.join(f.configuration, 'auth.json'));
  const fetcher = t.mock.method(globalThis, 'fetch', async () => new globalThis.Response('{}'));
  assert.equal((await getCodexUsageLimits(false, undefined, 'http://127.0.0.1')).success, false);
  assert.equal(fetcher.mock.callCount(), 0);
});

for (const changed of ['directory', 'file']) {
  test(`a ${changed} replaced during canonical reading refuses the detached generation`, { timeout: 5000 }, async t => {
    const f = await fixture(t);
    const originalOpen = fs.open;
    let replaced = false;
    t.mock.method(fs, 'open', async (...args) => {
      const descriptor = await originalOpen(...args);
      if (String(args[0]).startsWith('/proc/self/fd/') && !replaced) {
        replaced = true;
        if (changed === 'directory') {
          await fs.rename(f.canonical, `${f.canonical}-saved`);
          await fs.mkdir(f.canonical, { mode: 0o700 });
        } else await fs.rename(f.auth, `${f.auth}-saved`);
        await fs.writeFile(f.auth, '{"tokens":{"access_token":"synthetic-replacement"}}', { mode: 0o600 });
      }
      return descriptor;
    });
    const fetcher = t.mock.method(globalThis, 'fetch', async () => new globalThis.Response('{}'));
    assert.equal((await getCodexUsageLimits(false, undefined, 'http://127.0.0.1')).success, false);
    assert.equal(replaced, true);
    assert.equal(fetcher.mock.callCount(), 0);
    assert.equal(JSON.parse(await fs.readFile(f.auth, 'utf8')).tokens.access_token, 'synthetic-replacement');
  });
}

for (const kind of ['file-symlink', 'file-hardlink', 'directory-alias', 'directory-permissions', 'file-permissions', 'oversize', 'malformed', 'invalid-utf8']) {
  test(`selected Codex limits refuse ${kind} without provider requests`, { timeout: 5000 }, async t => {
    const f = await fixture(t);
    if (kind === 'file-symlink' || kind === 'file-hardlink') {
      await fs.unlink(f.auth);
      const protectedFile = f.protectedAuth;
      if (kind === 'file-symlink') await fs.symlink(protectedFile, f.auth);
      else await fs.link(protectedFile, f.auth);
    } else if (kind === 'directory-alias') {
      const alias = path.join(f.root, 'alias');
      await fs.symlink(f.canonical, alias);
      process.env.CODEX_AUTH_HOME = alias;
    } else if (kind === 'directory-permissions') await fs.chmod(f.canonical, 0o755);
    else if (kind === 'file-permissions') await fs.chmod(f.auth, 0o644);
    else if (kind === 'oversize') await fs.writeFile(f.auth, Buffer.alloc(1024 * 1024 + 1, 32));
    else if (kind === 'invalid-utf8') await fs.writeFile(f.auth, Buffer.concat([Buffer.from('{"tokens":{"access_token":"'), Buffer.from([0xff]), Buffer.from('"}}')]));
    else await fs.writeFile(f.auth, 'invalid synthetic JSON');
    const fetcher = t.mock.method(globalThis, 'fetch', async () => new globalThis.Response('{}'));
    const result = await getCodexUsageLimits(false, undefined, 'http://127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.failureKind, 'auth');
    assert.equal(fetcher.mock.callCount(), 0);
    assert.equal(JSON.parse(await fs.readFile(f.protectedAuth, 'utf8')).tokens.access_token, 'synthetic-private');
  });
}
