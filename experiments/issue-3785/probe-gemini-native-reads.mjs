// Real Gemini OAuth factory and retained Google OAuth client; synthetic state.
// Only token verification/user-info network boundaries are stubbed. No refresh
// or model request is attempted by these unexpired-credential controls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';

const PIN = '4d9cf6435503e5280ecb0f55078793531c8041fe435f60fa8dfce92317c8a28e';
const READ_PIN = 'e7df0d9801b8ec39c3ed283a614c9ffc6399c00410418d2ed0e6ff86d79b57cd';
const credential = value => ({ access_token: `synthetic-access-${value}`, refresh_token: `synthetic-refresh-${value}`, token_type: 'Bearer', expiry_date: Date.now() + 3600000 });
const generation = authorization => ['G0', 'G1', 'G2'].find(value => authorization === `Bearer synthetic-access-${value}`) || 'unexpected';

if (process.argv[2] === '--worker') {
  const native = await import(pathToFileURL(process.argv[3]).href);
  let attemptedRefresh = 0;
  native.__probeGoogleAuth.OAuth2Client.prototype.getTokenInfo = async () => ({ expiry_date: Date.now() + 3600000, scopes: [] });
  native.__probeGoogleAuth.OAuth2Client.prototype.refreshTokenNoCache = async () => {
    attemptedRefresh++;
    throw new Error('Synthetic refresh transport is unavailable.');
  };
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://www.googleapis.com/oauth2/v2/userinfo');
    return new globalThis.Response(JSON.stringify({ email: 'synthetic@example.invalid' }), { headers: { 'Content-Type': 'application/json' } });
  };
  const config = { getProxy: () => undefined, isBrowserLaunchSuppressed: () => true, isInteractive: () => false };
  const client = await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
  async function read(retained, operation) {
    try {
      const selected = retained ? client : await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
      if (operation === 'cache-writer') {
        await native.__probeCacheCredentials(credential('G2'));
        return 'accepted';
      }
      if (operation === 'logout-writer') {
        await native.clearCachedCredentialFile();
        return 'accepted';
      }
      const headers = await selected.getRequestHeaders('https://synthetic.example.invalid/model');
      return generation(typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization);
    } catch {
      return 'rejected';
    }
  }
  process.send({ type: 'ready', selected: await read(false), attemptedRefresh });
  process.on('message', async message => {
    if (message.type === 'stop') return process.disconnect();
    const selected = await read(message.retained, message.operation);
    process.send({ type: 'result', selected, attemptedRefresh });
  });
} else {
  const moduleFile = process.env.GEMINI_PROBE_MODULE || '/home/box/.bun/install/global/node_modules/@google/gemini-cli/bundle/chunk-DKZARV6U.js';
  const source = await fs.readFile(moduleFile, 'utf8');
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.65.0');
  assert.ok(
    [PIN, READ_PIN, 'd4071e79ec12bd57017e020c58944bfb94e8f0d13ffe6995b78e6799bffe4610', '5f1012b7c71f3ce17b53f923ca244d1ed44b5253fa0a93633c593cee52f38a77', '61f9f7fcc120c811254c8001cc745f2e84c284884d59f2a0e3ac55a6c95f9a5a', '0ecbf961fccd030706d8aa06689e8eb1a10cb8f8e21686fa3003e2319f71410c', '1880e98a06fafd5102d35593b5612c54a0a189dfe60675c9be1546546a4ef120', '4f97e8a434e43e9b9251e5e2a6775922922ed5ead6ed2fbb496451e5604ee764', 'd7770e02fce0af146f78d6f509c83c53de8f0a5eb2933d6956707291ff3a8c9d', '8152d28141b69a2cb351d46faa3fdd3b111ac6bc4d012dafd432a828436a66ae', 'c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792', '6cb363864dca9a4756e66142b3e30244d59a0702a258c2e5279b87b07ff609b3', '3062c3291a9a49d62177b20b8ef450c50f96a507cd4bdc168969a9dc45764970', '4b4daad35a3af8de066e49d866d14f163502a51234acb10c7c2b76a32213af64', '463cf8af6e9a06f2a1ff7ae2a484fcfa5d8d53f77c604f3e51344e71f3b1ed61'].includes(createHash('sha256').update(source).digest('hex')),
    'Only an exact inspected Gemini manager stage may run.'
  );
  const expectGaps = process.argv.includes('--expect-native-gaps');
  const privateConfigs = process.argv.includes('--private-configs');
  const withoutSelector = process.argv.includes('--without-selector');
  const refusalControls = process.argv.includes('--refusal-controls');
  assert.ok(!privateConfigs || !expectGaps, 'Independent-root controls require the selected adapter.');
  assert.ok(!withoutSelector || (!privateConfigs && expectGaps), 'Legacy compatibility controls retain native cache behavior.');
  assert.ok(!refusalControls || (!withoutSelector && !expectGaps), 'Read-stage refusal controls require the selected adapter.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-gemini-reads-'));
  const bundle = path.join(root, 'bundle');
  await fs.mkdir(bundle, { mode: 0o700 });
  // Exporting the bundled dependency permits stubbing external verification;
  // the native manager, credential reads and header methods remain unchanged.
  for (const item of await fs.readdir(path.dirname(moduleFile))) if (item !== path.basename(moduleFile)) await fs.symlink(path.join(path.dirname(moduleFile), item), path.join(bundle, item));
  const instrumented = path.join(bundle, 'probe-manager.mjs');
  await fs.writeFile(instrumented, source + '\nexport { import_google_auth_library3 as __probeGoogleAuth, cacheCredentials as __probeCacheCredentials };\n', { mode: 0o600 });
  let safeCleanup = true;

  async function scenario(name) {
    const privateHome = path.join(root, name);
    const configuration = path.join(privateHome, '.gemini');
    const authority = privateConfigs ? path.join(root, `${name}-authority`) : configuration;
    const file = path.join(authority, 'oauth_creds.json');
    await fs.mkdir(configuration, { recursive: true, mode: 0o700 });
    if (privateConfigs) await fs.mkdir(authority, { mode: 0o700 });
    await fs.writeFile(file, JSON.stringify(credential('G0')), { mode: 0o600 });
    const original = await fs.stat(file);
    let child;
    let timer;
    let closed;
    let bytes = 0;
    let stopping = false;
    const events = [];
    const pending = [];
    let fail;
    const failure = new Promise((_, reject) => {
      fail = reject;
    });
    function wait(type) {
      const index = events.findIndex(event => event.type === type);
      if (index >= 0) return Promise.resolve(events.splice(index, 1)[0]);
      return new Promise(resolve => pending.push({ type, resolve }));
    }
    async function read(retained, selected) {
      child.send({ type: 'read', retained, operation: name });
      assert.deepEqual(await wait('result'), { type: 'result', selected, attemptedRefresh: 0 }, `${name}: ${retained ? 'retained client' : 'native factory'}`);
    }
    async function publish(value) {
      const temporary = path.join(authority, 'synthetic-login.tmp');
      await fs.writeFile(temporary, JSON.stringify(credential(value)), { mode: 0o600 });
      await fs.utimes(temporary, original.atime, original.mtime);
      await fs.rename(temporary, file);
    }
    async function stop() {
      if (!child?.pid) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          safeCleanup = false;
          throw new Error('Native Gemini process-group cleanup failed; fixture retained.', { cause: error });
        }
      }
      await closed;
    }
    try {
      const env = { PATH: process.env.PATH, HOME: privateHome, GEMINI_CLI_HOME: privateHome, GEMINI_AUTH_HOME: authority, GEMINI_CLI_NO_RELAUNCH: '1', XDG_CONFIG_HOME: path.join(privateHome, '.config'), XDG_DATA_HOME: path.join(privateHome, '.local/share'), XDG_CACHE_HOME: path.join(privateHome, '.cache') };
      if (withoutSelector) delete env.GEMINI_AUTH_HOME;
      child = spawn('/usr/bin/prlimit', ['--data=2147483648', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=256', fileURLToPath(import.meta.url), '--worker', instrumented], {
        cwd: privateHome,
        env,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        detached: true,
      });
      closed = new Promise(resolve =>
        child.once('close', (code, signal) => {
          if (!stopping) fail(new Error('Native Gemini worker exited before its expected protocol completion.'));
          resolve({ code, signal });
        })
      );
      child.once('error', () => fail(new Error('Native Gemini read worker could not start.')));
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 65536) fail(new Error('Native Gemini diagnostics exceeded their finite bound.'));
        });
      child.on('message', message => {
        const index = pending.findIndex(item => item.type === message.type);
        if (index < 0) events.push(message);
        else pending.splice(index, 1)[0].resolve(message);
      });
      await Promise.race([
        failure,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Finite native Gemini read deadline exceeded.')), 20000);
        }),
        (async () => {
          assert.deepEqual(await wait('ready'), { type: 'ready', selected: 'G0', attemptedRefresh: 0 }, 'Require a healthy actual native factory and request-header control.');
          if (name === 'replacement') await publish('G1');
          else if (name === 'logout') await fs.unlink(file);
          else if (name === 'malformed') await fs.writeFile(file, '{"synthetic":');
          else if (name === 'permissions') await fs.chmod(file, 0o644);
          else if (name === 'oversized') await fs.writeFile(file, 'x'.repeat(1024 * 1024 + 1));
          else if (name === 'expired') await fs.writeFile(file, JSON.stringify({ ...credential('G0'), expiry_date: Date.now() - 60000 }));
          else if (name === 'parent-replacement') {
            await fs.rename(authority, `${authority}-old`);
            await fs.mkdir(authority, { mode: 0o700 });
          } else if (name === 'private-conflict') {
            await fs.writeFile(path.join(configuration, 'oauth_creds.json'), JSON.stringify(credential('G2')), { mode: 0o600 });
          } else if (name === 'private-disposal') {
            await fs.rm(configuration, { recursive: true });
          } else if (['cache-writer', 'logout-writer'].includes(name)) {
            // These selected native entrypoints are deliberately unavailable
            // until their publication/deletion transactions are implemented.
          } else {
            await fs.rename(file, `${file}-old`);
            if (name === 'symlink') await fs.symlink(`${file}-old`, file);
            else if (name === 'hardlink') await fs.link(`${file}-old`, file);
            else if (name === 'directory') await fs.mkdir(file, { mode: 0o700 });
            else throw new Error('Unknown synthetic native Gemini scenario.');
          }
          const selected = expectGaps || name === 'private-disposal' ? 'G0' : name === 'replacement' ? 'G1' : 'rejected';
          await read(false, selected);
          await read(true, selected);
          if (['cache-writer', 'logout-writer'].includes(name)) assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).access_token, 'synthetic-access-G0');
          if (name === 'logout') {
            await publish('G2');
            await read(false, expectGaps ? 'G0' : 'G2');
            await read(true, expectGaps ? 'G0' : 'G2');
          }
          if (privateConfigs && name !== 'private-conflict') await assert.rejects(fs.lstat(path.join(configuration, 'oauth_creds.json')), { code: 'ENOENT' });
          stopping = true;
          child.send({ type: 'stop' });
          assert.deepEqual(await closed, { code: 0, signal: null });
          console.log(`${expectGaps ? 'REPRODUCED stale native authorization' : 'PASS'}: ${name}, native factory and retained request headers.`);
        })(),
      ]);
    } finally {
      clearTimeout(timer);
      stopping = true;
      await stop();
    }
  }
  try {
    for (const name of ['replacement', 'logout', 'malformed', 'permissions', 'symlink', 'hardlink', 'directory', 'oversized', 'parent-replacement']) await scenario(name);
    if (privateConfigs) for (const name of ['private-conflict', 'private-disposal']) await scenario(name);
    if (refusalControls) for (const name of ['expired', 'cache-writer', 'logout-writer']) await scenario(name);
  } finally {
    if (safeCleanup) await fs.rm(root, { recursive: true, force: true });
  }
}
