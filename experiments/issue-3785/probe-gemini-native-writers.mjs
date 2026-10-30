// Real pinned native OAuth factory/client/writers. Only external transports
// are stubbed; every process uses bounded synthetic credentials and state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL, URLSearchParams } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';

const credential = (value, expired = false) => ({ access_token: `synthetic-access-${value}`, refresh_token: `synthetic-refresh-${value}`, token_type: 'Bearer', expiry_date: Date.now() + (expired ? -60000 : 3600000) });
const generation = value => ['G0', 'G1', 'G2'].find(item => value === `synthetic-access-${item}` || value === `Bearer synthetic-access-${item}`) || 'unexpected';

if (process.argv[2] === '--worker') {
  const native = await import(pathToFileURL(process.argv[3]).href);
  const role = process.argv[4];
  let exchanges = 0;
  native.__probeGoogleAuth.OAuth2Client.prototype.getTokenInfo = async () => ({ expiry_date: Date.now() + 3600000, scopes: [] });
  globalThis.fetch = async url => {
    assert.equal(String(url), 'https://www.googleapis.com/oauth2/v2/userinfo');
    return new globalThis.Response(JSON.stringify({ email: 'synthetic@example.invalid' }), { headers: { 'Content-Type': 'application/json' } });
  };
  const config = { getProxy: () => undefined, isBrowserLaunchSuppressed: () => true, isInteractive: () => false };
  if (role.startsWith('cold-')) {
    native.__probeGoogleAuth.OAuth2Client.prototype.refreshTokenNoCache = async () => {
      exchanges++;
      throw new Error('Unexpected synthetic cold-reader refresh was refused.');
    };
    process.send({ type: 'ready', selected: 'cold', exchanges });
    assert.equal((await new Promise(resolve => process.once('message', resolve))).type, 'start');
    let selected = 'unexpected';
    let initializationRefused = false;
    try {
      await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
    } catch {
      initializationRefused = true;
    }
    if (initializationRefused) {
      selected = 'rejected';
      if (role === 'cold-root-replacement') {
        process.send({ type: 'replace-root' });
        assert.equal((await new Promise(resolve => process.once('message', resolve))).type, 'continue');
        try {
          const replacement = await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
          const headers = await replacement.getRequestHeaders('https://synthetic.example.invalid/model');
          selected = generation(typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization);
        } catch {
          selected = 'rejected';
        }
      }
      if (role.includes('login')) {
        try {
          await native.__probeCacheCredentials({ ...credential('G2'), ...(role === 'cold-same-refresh-login' ? { refresh_token: 'synthetic-refresh-G0' } : {}) });
          const recovered = await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
          const headers = await recovered.getRequestHeaders('https://synthetic.example.invalid/model');
          selected = generation(typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization);
        } catch {
          selected = 'rejected';
        }
      }
    }
    process.send({ type: 'result', selected, exchanges });
    process.disconnect();
  } else {
    const client = await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
    client.transporter.request = async options => {
      if (String(options.url) === 'https://synthetic.example.invalid/model') {
        assert.equal(role, 'inference');
        assert.equal(generation(typeof options.headers.get === 'function' ? options.headers.get('authorization') : options.headers.Authorization), 'G1');
        process.send({ type: 'inference' });
        assert.equal((await new Promise(resolve => process.once('message', resolve))).type, 'finish-inference');
        return { status: 200, headers: {}, data: { synthetic: true } };
      }
      assert.equal(String(options.url), 'https://oauth2.googleapis.com/token');
      assert.equal(options.method, 'POST');
      if (process.env.GEMINI_PROBE_COORDINATED === '1') {
        assert.equal(options.retry, false);
        assert.deepEqual(options.retryConfig, { retry: 0, noResponseRetries: 0 });
      }
      const body = new URLSearchParams(options.data);
      assert.equal(body.get('refresh_token'), 'synthetic-refresh-G0');
      assert.equal(body.get('grant_type'), 'refresh_token');
      exchanges++;
      process.send({ type: 'exchange', predecessor: 'G0' });
      const reply = await new Promise(resolve => process.once('message', resolve));
      if (reply.networkError || reply.invalidGrant) {
        const error = new Error('Synthetic provider refusal.');
        if (reply.invalidGrant) error.response = { status: 400, data: { error: 'invalid_grant' } };
        throw error;
      }
      return { status: 200, headers: {}, data: { access_token: 'synthetic-access-G1', ...(reply.nonRotating ? {} : { refresh_token: 'synthetic-refresh-G1' }), token_type: 'Bearer', expires_in: 3600 } };
    };
    const warm = await client.getRequestHeaders('https://synthetic.example.invalid/model');
    process.send({ type: 'ready', selected: generation(typeof warm.get === 'function' ? warm.get('authorization') : warm.Authorization), exchanges });
    const command = await new Promise(resolve => process.once('message', resolve));
    assert.equal(command.type, 'start');
    try {
      let selected;
      if (role === 'login' || role === 'same-refresh-login') {
        await native.__probeCacheCredentials({ ...credential('G2'), ...(role === 'same-refresh-login' ? { refresh_token: 'synthetic-refresh-G0' } : {}) });
        selected = 'G2';
      } else if (role === 'logout') {
        await native.clearCachedCredentialFile();
        selected = 'cleared';
      } else if (role === 'inference') {
        await client.request({ url: 'https://synthetic.example.invalid/model', method: 'POST', data: { synthetic: true } });
        selected = generation(client.credentials.access_token);
      } else if (role === 'direct') {
        selected = generation((await client.refreshAccessToken()).credentials.access_token);
      } else if (role === 'direct-no-cache') {
        selected = generation((await client.refreshTokenNoCache('synthetic-refresh-G0')).tokens.access_token);
      } else {
        const headers = await client.getRequestHeaders('https://synthetic.example.invalid/model');
        selected = generation(typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization);
      }
      process.send({ type: 'result', selected, exchanges });
    } catch {
      process.send({ type: 'result', selected: 'rejected', exchanges });
    } finally {
      if (process.env.GEMINI_WRITER_TRACE === '1') process.send({ type: 'drained', handles: process._getActiveHandles().map(handle => handle.constructor.name), requests: process._getActiveRequests().map(request => request.constructor.name) });
      process.disconnect();
    }
  }
} else {
  const moduleFile = process.env.GEMINI_PROBE_MODULE;
  assert.ok(moduleFile, 'An exact inspected native package is required.');
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.65.0');
  const source = await fs.readFile(moduleFile, 'utf8');
  assert.ok(['4d9cf6435503e5280ecb0f55078793531c8041fe435f60fa8dfce92317c8a28e', 'e7df0d9801b8ec39c3ed283a614c9ffc6399c00410418d2ed0e6ff86d79b57cd', '41849bd0ccf316e164a7aeafbf7171cf20e36cc1c77cd456dc33e2441eb780e6', 'd4071e79ec12bd57017e020c58944bfb94e8f0d13ffe6995b78e6799bffe4610'].includes(createHash('sha256').update(source).digest('hex')), 'Only an exact inspected native manager stage may run.');
  const legacyConfigs = process.argv.includes('--legacy-configs');
  const trace = process.argv.includes('--trace');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-gemini-writers-'));
  const bundle = path.join(root, 'bundle');
  await fs.mkdir(bundle, { mode: 0o700 });
  for (const item of await fs.readdir(path.dirname(moduleFile))) if (item !== path.basename(moduleFile)) await fs.symlink(path.join(path.dirname(moduleFile), item), path.join(bundle, item));
  const instrumented = path.join(bundle, 'probe-manager.mjs');
  await fs.writeFile(instrumented, source + '\nexport { import_google_auth_library3 as __probeGoogleAuth, cacheCredentials as __probeCacheCredentials };\n', { mode: 0o600 });
  let safeCleanup = true;

  async function scenario(name) {
    const directory = path.join(root, name);
    const authority = path.join(directory, legacyConfigs ? 'shared-config/.gemini' : 'authority');
    const file = path.join(authority, 'oauth_creds.json');
    const lock = path.join(authority, '.hive-mind-refresh.lock');
    const intent = path.join(authority, '.hive-gemini-refresh-intent.json');
    await fs.mkdir(authority, { recursive: true, mode: 0o700 });
    await fs.writeFile(file, JSON.stringify(credential('G0')), { mode: 0o600 });
    await fs.writeFile(lock, '', { mode: 0o600 });
    const initial = await fs.stat(lock, { bigint: true });
    const workers = [];
    let timer;
    let fail;
    const failure = new Promise((_, reject) => {
      fail = reject;
    });

    async function start(role, run = false, expected = 'G0') {
      const home = path.join(directory, `config-${workers.length}`);
      await fs.mkdir(path.join(home, '.gemini'), { recursive: true, mode: 0o700 });
      const child = spawn('/usr/bin/prlimit', ['--data=2147483648', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=256', fileURLToPath(import.meta.url), '--worker', instrumented, role], {
        cwd: home,
        env: { PATH: process.env.PATH, HOME: home, GEMINI_CLI_HOME: legacyConfigs ? path.dirname(authority) : home, GEMINI_AUTH_HOME: authority, GEMINI_CLI_NO_RELAUNCH: '1', GEMINI_WRITER_TRACE: trace ? '1' : '0', GEMINI_PROBE_COORDINATED: source.includes('opts.retry = false;\n            opts.retryConfig = { retry: 0, noResponseRetries: 0 };') ? '1' : '0', XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        detached: true,
      });
      const events = [];
      const pending = [];
      let bytes = 0;
      const diagnostics = [];
      let finished = false;
      child.once('error', () => fail(new Error('Synthetic native writer could not start.')));
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', chunk => {
          bytes += chunk.length;
          if (bytes <= 65536) diagnostics.push(chunk);
          if (bytes > 65536) fail(new Error('Synthetic native diagnostics exceeded their bound.'));
        });
      child.on('message', message => {
        if (trace) console.error(JSON.stringify({ role, ...message }));
        if (message.type === 'result') finished = true;
        events.push(message);
        for (let index = pending.length - 1; index >= 0; index--) if (pending[index].type === message.type) pending.splice(index, 1)[0].resolve(message);
      });
      const worker = {
        child,
        home,
        diagnostics,
        events,
        stopping: false,
        wait: type => {
          const index = events.findIndex(event => event.type === type);
          return index >= 0 ? Promise.resolve(events[index]) : new Promise(resolve => pending.push({ type, resolve }));
        },
      };
      worker.closed = new Promise(resolve =>
        child.once('close', (code, signal) => {
          if (!finished && !worker.stopping) fail(new Error(`Native writer exited before protocol completion (code=${code}, signal=${signal}).`));
          resolve({ code, signal });
        })
      );
      workers.push(worker);
      assert.deepEqual(await worker.wait('ready'), { type: 'ready', selected: expected, exchanges: 0 }, 'Require the expected healthy actual native request header.');
      if (run) child.send({ type: 'start' });
      return worker;
    }
    async function result(worker, selected, exchanges) {
      assert.deepEqual(await worker.wait('result'), { type: 'result', selected, exchanges }, `${name}: native writer result`);
      assert.deepEqual(await worker.closed, { code: 0, signal: null });
    }
    async function blocked(worker) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const children = (await fs.readFile(`/proc/${worker.child.pid}/task/${worker.child.pid}/children`, 'utf8')).trim().split(/\s+/u).filter(Boolean);
        for (const pid of children) if ((await fs.readFile(`/proc/${pid}/wchan`, 'utf8').catch(() => '')).trim() === 'locks_lock_inode_wait') return;
        await delay(20);
      }
      throw new Error('Native writer did not wait for the live kernel-lock owner.');
    }
    async function stop(worker) {
      worker.stopping = true;
      try {
        process.kill(-worker.child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') {
          safeCleanup = false;
          throw new Error('Native writer process-group cleanup failed; fixtures retained.', { cause: error });
        }
      }
      await worker.closed;
    }
    try {
      await Promise.race([
        failure,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Finite native Gemini writer deadline exceeded.')), 25000);
        }),
        (async () => {
          const owner = await start(name === 'inference-overlap' ? 'inference' : name === 'direct-refresh' ? 'direct' : name === 'direct-no-cache' ? 'direct-no-cache' : 'reader');
          const peer = ['two-refreshes', 'login', 'logout', 'owner-death'].includes(name) ? await start(['login', 'logout'].includes(name) ? name : 'reader') : undefined;
          await fs.writeFile(file, JSON.stringify(credential('G0', true)), { mode: 0o600 });
          owner.child.send({ type: 'start' });
          const exchangeOrResult = await Promise.race([owner.wait('exchange'), owner.wait('result')]);
          assert.deepEqual(exchangeOrResult, { type: 'exchange', predecessor: 'G0' }, `${name}: expired native credentials must exchange instead of using cached G0 or refusing a usable authority`);
          if (peer) {
            peer.child.send({ type: 'start' });
            await blocked(peer);
            assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
          }
          if (name === 'publication-race') {
            await fs.writeFile(`${file}.replacement`, JSON.stringify(credential('G2')), { mode: 0o600 });
            await fs.rename(`${file}.replacement`, file);
          }
          if (name === 'owner-death') {
            await stop(owner);
            await result(peer, 'rejected', 0);
          } else {
            owner.child.send({ networkError: ['network-refusal', 'metadata-rewrite', 'factory-root-replacement'].includes(name), invalidGrant: name === 'invalid-grant', nonRotating: name === 'non-rotating' });
            if (name === 'inference-overlap') {
              await owner.wait('inference');
              await result(await start('reader', true, 'G1'), 'G1', 0);
              assert.equal(owner.child.exitCode, null);
              assert.equal(owner.child.signalCode, null);
              owner.child.send({ type: 'finish-inference' });
            }
            await result(owner, ['network-refusal', 'metadata-rewrite', 'factory-root-replacement', 'invalid-grant', 'publication-race'].includes(name) ? 'rejected' : 'G1', 1);
            if (peer) await result(peer, name === 'login' ? 'G2' : name === 'logout' ? 'cleared' : 'G1', 0);
          }
          if (name === 'publication-race') await result(await start('reader', true, 'G2'), 'G2', 0);
          if (['owner-death', 'network-refusal', 'metadata-rewrite', 'factory-root-replacement', 'invalid-grant'].includes(name)) {
            assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
            assert.equal((await fs.stat(intent)).mode & 0o777, 0o600);
            if (name === 'metadata-rewrite') {
              const changed = { ...JSON.parse(await fs.readFile(file, 'utf8')), expiry_date: Date.now() - 120000, metadata: 'synthetic-metadata-only-rewrite' };
              await fs.writeFile(`${file}.replacement`, JSON.stringify(changed), { mode: 0o600 });
              await fs.rename(`${file}.replacement`, file);
            }
            await result(await start('cold-reader', true, 'cold'), 'rejected', 0);
            if (name === 'factory-root-replacement') {
              const redirect = await start('cold-root-replacement', true, 'cold');
              await redirect.wait('replace-root');
              await fs.rename(authority, `${authority}-original`);
              await fs.mkdir(authority, { mode: 0o700 });
              await fs.writeFile(file, JSON.stringify(credential('G2')), { mode: 0o600 });
              redirect.child.send({ type: 'continue' });
              await result(redirect, 'rejected', 0);
              await fs.rm(authority, { recursive: true });
              await fs.rename(`${authority}-original`, authority);
            }
            await result(await start('cold-same-refresh-login', true, 'cold'), 'rejected', 0);
            await result(await start('cold-login', true, 'cold'), 'G2', 0);
            await result(await start('reader', true, 'G2'), 'G2', 0);
            await assert.rejects(fs.lstat(intent), { code: 'ENOENT' });
          } else {
            await assert.rejects(fs.lstat(intent), { code: 'ENOENT' });
            if (name === 'logout') await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
            else {
              const final = JSON.parse(await fs.readFile(file, 'utf8'));
              assert.equal(generation(final.access_token), ['login', 'publication-race'].includes(name) ? 'G2' : 'G1');
              assert.equal(final.refresh_token, `synthetic-refresh-${name === 'non-rotating' ? 'G0' : ['login', 'publication-race'].includes(name) ? 'G2' : 'G1'}`);
            }
          }
          const after = await fs.stat(lock, { bigint: true });
          assert.equal(`${after.dev}:${after.ino}`, `${initial.dev}:${initial.ino}`);
          for (const worker of workers) await assert.rejects(fs.lstat(path.join(worker.home, '.gemini/oauth_creds.json')), { code: 'ENOENT' });
          console.log(`PASS: actual native Gemini ${name}; canonical publication, private configurations and stable lock identity.`);
        })(),
      ]);
    } catch (error) {
      safeCleanup = false;
      console.error(`Synthetic failed-worker evidence retained in ${directory}.`);
      throw error;
    } finally {
      clearTimeout(timer);
      for (const worker of workers) {
        await stop(worker);
        if (!safeCleanup) {
          await fs.writeFile(path.join(worker.home, 'bounded-worker.log'), worker.diagnostics, { mode: 0o600 });
          await fs.writeFile(path.join(worker.home, 'protocol.json'), JSON.stringify(worker.events), { mode: 0o600 });
        }
      }
    }
  }
  try {
    const scenarios = ['inference-overlap', 'two-refreshes', 'login', 'logout', 'owner-death', 'network-refusal', 'metadata-rewrite', 'factory-root-replacement', 'invalid-grant', 'non-rotating', 'direct-refresh', 'direct-no-cache', 'publication-race'];
    const selected = process.argv.find(value => value.startsWith('--scenario='))?.slice('--scenario='.length);
    if (selected) assert.ok(scenarios.includes(selected));
    for (const name of selected ? [selected] : scenarios) await scenario(name);
  } finally {
    if (safeCleanup) await fs.rm(root, { recursive: true, force: true });
  }
}
