// Real pinned native OAuth factory/client/writers. Only external transports
// are stubbed; every process uses bounded synthetic credentials and state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
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
  let callbacks = 0;
  let initializationComplete = false;
  native.__probeAuthEvents.on('post_auth', event => {
    assert.equal(event.type, 'authorized_user');
    assert.equal(event.client_email, role === 'account-second' ? 'synthetic-second@example.invalid' : 'synthetic@example.invalid');
    callbacks++;
  });
  native.__probeGoogleAuth.OAuth2Client.prototype.getTokenInfo = async () => ({ expiry_date: Date.now() + 3600000, scopes: [] });
  const nativeFetch = globalThis.fetch;
  globalThis.__probeBrowserOpen = async value => {
    const authorize = new globalThis.URL(value);
    assert.equal(authorize.origin, 'https://accounts.google.com');
    const callback = new globalThis.URL(authorize.searchParams.get('redirect_uri'));
    assert.equal(callback.hostname, '127.0.0.1');
    assert.equal(callback.pathname, '/oauth2callback');
    callback.searchParams.set('state', authorize.searchParams.get('state'));
    callback.searchParams.set('code', 'synthetic-code-G1');
    process.send({ type: 'browser', state: 'native-callback' });
    const response = await nativeFetch(callback, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(new globalThis.URL(response.headers.get('location')).pathname, '/gemini-code-assist/auth_success_gemini');
    return { on() {} };
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://www.googleapis.com/oauth2/v2/userinfo');
    if (role === 'account-fetch' && initializationComplete) {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-access-G0');
      process.send({ type: 'userinfo', selected: 'G0' });
      await new Promise(resolve => process.once('message', resolve));
    }
    return new globalThis.Response(JSON.stringify({ email: role === 'account-second' ? 'synthetic-second@example.invalid' : 'synthetic@example.invalid' }), { headers: { 'Content-Type': 'application/json' } });
  };
  const config = { getProxy: () => undefined, isBrowserLaunchSuppressed: () => role !== 'initial-browser', isInteractive: () => role.startsWith('initial-'), getAcpMode: () => true };
  if (role.startsWith('initial-')) {
    if (role === 'initial-relogin' || role === 'initial-revoke-relogin') {
      const previous = await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, { ...config, isInteractive: () => false });
      const headers = await previous.getRequestHeaders('https://synthetic.example.invalid/model');
      assert.equal(generation(typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization), 'G0');
      if (role === 'initial-relogin') await native.clearCachedCredentialFile();
      else {
        previous.transporter.request = async options => {
          const target = new globalThis.URL(String(options.url));
          assert.equal(target.origin, 'https://oauth2.googleapis.com');
          assert.equal(target.pathname, '/revoke');
          assert.equal(target.searchParams.get('token'), 'synthetic-access-G0');
          assert.equal(options.retry, false);
          return { status: 200, data: {} };
        };
        await previous.revokeCredentials();
      }
    }
    const actual = native.__probeGoogleAuth.OAuth2Client.prototype.getTokenAsync;
    native.__probeGoogleAuth.OAuth2Client.prototype.getTokenAsync = async function (options) {
      this.transporter.request = async request => {
        assert.equal(String(request.url), 'https://oauth2.googleapis.com/token');
        assert.equal(request.method, 'POST');
        assert.equal(request.retry, false);
        assert.deepEqual(request.retryConfig, { retry: 0, noResponseRetries: 0 });
        const body = new URLSearchParams(request.data);
        assert.equal(body.get('grant_type'), 'authorization_code');
        assert.equal(body.get('code'), 'synthetic-code-G1');
        exchanges++;
        process.send({ type: 'exchange', predecessor: 'authorization-code' });
        await new Promise(resolve => process.once('message', resolve));
        return { status: 200, headers: {}, data: { ...credential('G1'), expires_in: 3600 } };
      };
      return actual.call(this, options);
    };
    process.send({ type: 'ready', selected: 'empty', exchanges });
    assert.equal((await new Promise(resolve => process.once('message', resolve))).type, 'start');
    let selected;
    try {
      const client = await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
      const headers = await client.getRequestHeaders('https://synthetic.example.invalid/model');
      selected = generation(typeof headers.get === 'function' ? headers.get('authorization') : headers.Authorization);
      assert.ok(callbacks > 0, 'Native initial login retains its post-auth callback.');
    } catch {
      // Report only structural refusal; native diagnostics stay bounded.
      selected = 'rejected';
    }
    process.send({ type: 'result', selected, exchanges });
    process.disconnect();
  } else if (role.startsWith('cold-')) {
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
    initializationComplete = true;
    client.transporter.request = async options => {
      if (String(options.url) === 'https://synthetic.example.invalid/model') {
        assert.equal(role, 'inference');
        assert.equal(generation(typeof options.headers.get === 'function' ? options.headers.get('authorization') : options.headers.Authorization), 'G1');
        process.send({ type: 'inference' });
        assert.equal((await new Promise(resolve => process.once('message', resolve))).type, 'finish-inference');
        return { status: 200, headers: {}, data: { synthetic: true } };
      }
      if (new globalThis.URL(String(options.url)).origin === 'https://oauth2.googleapis.com' && new globalThis.URL(String(options.url)).pathname === '/revoke') {
        assert.ok(role.startsWith('revoke'));
        assert.equal(new globalThis.URL(String(options.url)).searchParams.get('token'), 'synthetic-access-G2');
        assert.equal(options.method, 'POST');
        assert.equal(options.retry, false);
        assert.deepEqual(options.retryConfig, { retry: 0, noResponseRetries: 0 });
        process.send({ type: 'revocation', selected: 'G2' });
        const reply = await new Promise(resolve => process.once('message', resolve));
        if (reply.networkError) throw new Error('Synthetic revocation network refusal.');
        return { status: 200, data: {} };
      }
      assert.equal(String(options.url), 'https://oauth2.googleapis.com/token');
      assert.equal(options.method, 'POST');
      if (process.env.GEMINI_PROBE_COORDINATED === '1') {
        assert.equal(options.retry, false);
        assert.deepEqual(options.retryConfig, { retry: 0, noResponseRetries: 0 });
      }
      const body = new URLSearchParams(options.data);
      if (role === 'auth-code') {
        assert.equal(body.get('grant_type'), 'authorization_code');
        assert.equal(body.get('code'), 'synthetic-code-G1');
      } else {
        assert.equal(body.get('refresh_token'), 'synthetic-refresh-G0');
        assert.equal(body.get('grant_type'), 'refresh_token');
      }
      exchanges++;
      process.send({ type: 'exchange', predecessor: role === 'auth-code' ? 'authorization-code' : 'G0' });
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
      if (role.startsWith('account-')) {
        if (role === 'account-store') await native.__probeAccounts.cacheGoogleAccount('synthetic@example.invalid', client.credentials);
        else if (role === 'account-fetch') await native.__probeFetchUserInfo(client);
        else if (role === 'account-clear') await native.clearCachedCredentialFile();
        else if (role === 'account-callback') assert.equal(callbacks, 1, 'Cached native login retains its post-auth callback.');
        else if (role === 'account-read' || role === 'account-second') {
          const file = native.__probeAccounts.getGoogleAccountsCachePath();
          assert.equal(file, path.join(process.env.GEMINI_AUTH_HOME, 'google_accounts.json'));
          assert.deepEqual(await native.__probeAccounts.readAccounts(file), native.__probeAccounts.readAccountsSync(file));
          const account = native.__probeAccounts.getCachedGoogleAccount();
          process.send({ type: 'account', selected: account === (role === 'account-second' ? 'synthetic-second@example.invalid' : 'synthetic@example.invalid') ? 'expected' : account === null ? 'empty' : 'unexpected', count: native.__probeAccounts.getLifetimeGoogleAccounts() });
        }
        selected = 'G0';
      } else if (role === 'login' || role === 'same-refresh-login') {
        await native.__probeCacheCredentials({ ...credential('G2'), ...(role === 'same-refresh-login' ? { refresh_token: 'synthetic-refresh-G0' } : {}) });
        selected = 'G2';
      } else if (role === 'logout') {
        await native.clearCachedCredentialFile();
        selected = 'cleared';
      } else if (role.startsWith('revoke')) {
        if (role === 'revoke-direct') await client.revokeToken('synthetic-access-G2');
        else if (role === 'revoke-old') await client.revokeToken('synthetic-access-G0');
        else await client.revokeCredentials();
        selected = 'cleared';
      } else if (role === 'auth-code') {
        selected = generation((await client.getToken({ code: 'synthetic-code-G1', redirect_uri: 'https://synthetic.example.invalid/callback' })).tokens.access_token);
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
      if (selected === 'G1' && exchanges === 1 && process.env.GEMINI_PROBE_COORDINATED === '1') assert.equal(callbacks, 2, 'Refresh/code publication retains the native post-auth callback after cached login.');
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
  assert.ok(
    [
      '4d9cf6435503e5280ecb0f55078793531c8041fe435f60fa8dfce92317c8a28e',
      'e7df0d9801b8ec39c3ed283a614c9ffc6399c00410418d2ed0e6ff86d79b57cd',
      '41849bd0ccf316e164a7aeafbf7171cf20e36cc1c77cd456dc33e2441eb780e6',
      'd4071e79ec12bd57017e020c58944bfb94e8f0d13ffe6995b78e6799bffe4610',
      '5f1012b7c71f3ce17b53f923ca244d1ed44b5253fa0a93633c593cee52f38a77',
      '61f9f7fcc120c811254c8001cc745f2e84c284884d59f2a0e3ac55a6c95f9a5a',
      '0ecbf961fccd030706d8aa06689e8eb1a10cb8f8e21686fa3003e2319f71410c',
      '1880e98a06fafd5102d35593b5612c54a0a189dfe60675c9be1546546a4ef120',
      '4f97e8a434e43e9b9251e5e2a6775922922ed5ead6ed2fbb496451e5604ee764',
      'd7770e02fce0af146f78d6f509c83c53de8f0a5eb2933d6956707291ff3a8c9d',
      '8152d28141b69a2cb351d46faa3fdd3b111ac6bc4d012dafd432a828436a66ae',
      'c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792',
      '6cb363864dca9a4756e66142b3e30244d59a0702a258c2e5279b87b07ff609b3',
      '3062c3291a9a49d62177b20b8ef450c50f96a507cd4bdc168969a9dc45764970',
      '4b4daad35a3af8de066e49d866d14f163502a51234acb10c7c2b76a32213af64',
      '463cf8af6e9a06f2a1ff7ae2a484fcfa5d8d53f77c604f3e51344e71f3b1ed61',
      '0c70897032c0ad76419b3149d783567280dfd972ef2c04e258cbebccc9575c42',
      'ce32eec6ab27f4d9fbf1449a5bdc70ad9b06fde0aff84b560ac1540a9106a9fa',
      '236c3faf39cbe2a022409be5ee3ee3147ac1686d146336d0126f6e23f0b465b2',
      '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b',
      'b1b2ad9594865d2b60aee3d1b6cbf1a8d2bb2e7d72946124f9a25bc3c2808608',
      '9e5df4a69c98a27919561e63ebc5d9338256e399f27c4f5171ff2564cedb9b55',
      'a88db8a10a742aa697d71f2e33b9061d2082f6e9b4330b3d9bbefa54fa9616f3',
      'ace42576cb7d8f0f2ef710e148cbfb81311929f42f5c3a50851e27cb5e744a07',
      '91ce4040ae4296cfa2b82238f2b9a2291bbbf86086a85c1c9b341d08272eae28',
      '13f2fce9a55408b50001683d440f791a1d21cdcc3c22799f8832edad4a1ef769',
    ].includes(createHash('sha256').update(source).digest('hex')),
    'Only an exact inspected native manager stage may run.'
  );
  const legacyConfigs = process.argv.includes('--legacy-configs');
  const trace = process.argv.includes('--trace');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-gemini-writers-'));
  const bundle = path.join(root, 'bundle');
  await fs.mkdir(bundle, { mode: 0o700 });
  for (const item of await fs.readdir(path.dirname(moduleFile))) if (item !== path.basename(moduleFile)) await fs.symlink(path.join(path.dirname(moduleFile), item), path.join(bundle, item));
  const instrumented = path.join(bundle, 'probe-manager.mjs');
  const browserLaunch = 'await open_default(webLogin.authUrl)';
  assert.ok([1, 2].includes(source.split(browserLaunch).length - 1));
  const browserSource = source.replaceAll(browserLaunch, 'await globalThis.__probeBrowserOpen(webLogin.authUrl)');
  await fs.writeFile(instrumented, browserSource + '\nexport { import_google_auth_library3 as __probeGoogleAuth, cacheCredentials as __probeCacheCredentials, userAccountManager2 as __probeAccounts, authEvents as __probeAuthEvents, fetchAndCacheUserInfo as __probeFetchUserInfo };\n', { mode: 0o600 });
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
        stdio: [['initial-login', 'initial-relogin', 'initial-revoke-relogin'].includes(role) ? 'pipe' : 'ignore', 'pipe', 'pipe', 'ipc'],
        detached: true,
      });
      const events = [];
      const pending = [];
      let bytes = 0;
      const diagnostics = [];
      let finished = false;
      let codeEntered = false;
      child.once('error', () => fail(new Error('Synthetic native writer could not start.')));
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', chunk => {
          bytes += chunk.length;
          if (bytes <= 65536) diagnostics.push(chunk);
          if (['initial-login', 'initial-relogin', 'initial-revoke-relogin'].includes(role) && !codeEntered && Buffer.concat(diagnostics).toString('utf8').includes('Enter the authorization code:')) {
            codeEntered = true;
            child.stdin.end('synthetic-code-G1\n');
          }
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
          if (name.startsWith('account-')) {
            const store = path.join(authority, 'google_accounts.json');
            const owner = await start(name === 'account-callback' ? 'account-callback' : name === 'account-stale-response' ? 'account-fetch' : name.startsWith('account-unsafe-') || name === 'account-private-conflict' ? 'account-read' : 'account-store');
            if (name === 'account-private-conflict') await fs.writeFile(path.join(owner.home, '.gemini/google_accounts.json'), '{synthetic-private', { mode: 0o600 });
            if (name.startsWith('account-unsafe-')) {
              await fs.rm(store, { force: true });
              if (name === 'account-unsafe-malformed') await fs.writeFile(store, '{synthetic-malformed', { mode: 0o600 });
              else if (name === 'account-unsafe-permissions') await fs.writeFile(store, '{}', { mode: 0o644 });
              else if (name === 'account-unsafe-hardlink' || name === 'account-unsafe-symlink') {
                const unrelated = path.join(directory, 'unrelated-evidence');
                await fs.writeFile(unrelated, 'synthetic-unrelated', { mode: 0o600 });
                if (name.endsWith('hardlink')) await fs.link(unrelated, store);
                else await fs.symlink(unrelated, store);
              } else if (name === 'account-unsafe-directory') await fs.mkdir(store, { mode: 0o700 });
              else if (name === 'account-unsafe-oversized') await fs.writeFile(store, Buffer.alloc(1024 * 1024 + 1), { mode: 0o600 });
            }
            owner.child.send({ type: 'start' });
            if (name === 'account-stale-response') {
              assert.deepEqual(await owner.wait('userinfo'), { type: 'userinfo', selected: 'G0' });
              await fs.writeFile(`${file}.replacement`, JSON.stringify(credential('G2')), { mode: 0o600 });
              await fs.rename(`${file}.replacement`, file);
              owner.child.send({ type: 'complete' });
            }
            const unsafe = name.startsWith('account-unsafe-') || name === 'account-private-conflict';
            await result(owner, unsafe ? 'rejected' : 'G0', 0);
            if (unsafe) {
              assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
              if (name.endsWith('hardlink') || name.endsWith('symlink')) assert.equal(await fs.readFile(path.join(directory, 'unrelated-evidence'), 'utf8'), 'synthetic-unrelated');
            } else if (name === 'account-stale-response') {
              const account = JSON.parse(await fs.readFile(store, 'utf8'));
              assert.notEqual(account.generation, createHash('sha256').update('gemini-account-generation\0').update('synthetic-refresh-G2').digest('hex'), 'A stale user-info response cannot label a different current generation.');
              await result(await start('account-read', true, 'G2'), 'G0', 0);
            } else {
              assert.equal(JSON.parse(await fs.readFile(store, 'utf8')).active, 'synthetic@example.invalid', 'Account metadata must persist in canonical storage.');
              if (name === 'account-scope-disposal') await fs.rm(owner.home, { recursive: true });
              const peer = await start('account-read', true);
              assert.deepEqual(await peer.wait('account'), { type: 'account', selected: 'expected', count: 1 });
              await result(peer, 'G0', 0);
              if (name === 'account-switch') {
                await fs.writeFile(`${file}.replacement`, JSON.stringify(credential('G2')), { mode: 0o600 });
                await fs.rename(`${file}.replacement`, file);
                const second = await start('account-second', true, 'G2');
                assert.deepEqual(await second.wait('account'), { type: 'account', selected: 'expected', count: 2 });
                await result(second, 'G0', 0);
                const accounts = JSON.parse(await fs.readFile(store, 'utf8'));
                assert.equal(accounts.active, 'synthetic-second@example.invalid');
                assert.deepEqual(accounts.old, ['synthetic@example.invalid']);
              }
              if (name === 'account-logout') {
                await result(await start('account-clear', true), 'G0', 0);
                await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
                const account = JSON.parse(await fs.readFile(store, 'utf8'));
                assert.equal(account.active, null);
                assert.deepEqual(account.old, ['synthetic@example.invalid']);
              }
            }
            if (!unsafe) for (const worker of workers) await assert.rejects(fs.lstat(path.join(worker.home, '.gemini/google_accounts.json')), { code: 'ENOENT' });
            console.log(`PASS: actual native Gemini ${name}; canonical account metadata, native callbacks and generation boundaries.`);
            return;
          }
          if (['initial-login', 'initial-browser', 'initial-malformed', 'initial-relogin', 'initial-revoke-relogin'].includes(name)) {
            if (name === 'initial-malformed') await fs.writeFile(file, '{synthetic-malformed', { mode: 0o600 });
            else if (!name.endsWith('relogin')) await fs.unlink(file);
            const client = await start(name.endsWith('relogin') ? name : name === 'initial-login' ? 'initial-login' : 'initial-browser', true, 'empty');
            if (name === 'initial-malformed') {
              await result(client, 'rejected', 0);
              assert.equal(await fs.readFile(file, 'utf8'), '{synthetic-malformed');
              assert.ok(!client.events.some(event => ['browser', 'exchange'].includes(event.type)));
              console.log('PASS: actual native Gemini initial-malformed; interactive login refuses unsafe existing authority before browser or exchange.');
              return;
            }
            assert.deepEqual(await Promise.race([client.wait('exchange'), client.wait('result')]), { type: 'exchange', predecessor: 'authorization-code' }, 'An explicit interactive native login must use its real authorization-code flow.');
            await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
            client.child.send({ type: 'complete' });
            await result(client, 'G1', 1);
            await result(await start('reader', true, 'G1'), 'G1', 0);
            const final = JSON.parse(await fs.readFile(file, 'utf8'));
            assert.equal(final.refresh_token, 'synthetic-refresh-G1');
            assert.equal(JSON.parse(await fs.readFile(path.join(authority, 'google_accounts.json'), 'utf8')).active, 'synthetic@example.invalid');
            await assert.rejects(fs.lstat(intent), { code: 'ENOENT' });
            const finalLock = await fs.stat(lock, { bigint: true });
            assert.equal(`${finalLock.dev}:${finalLock.ino}`, `${initial.dev}:${initial.ino}`);
            for (const worker of workers) await assert.rejects(fs.lstat(path.join(worker.home, '.gemini/oauth_creds.json')), { code: 'ENOENT' });
            if (name === 'initial-browser') assert.ok(client.events.some(event => event.type === 'browser'));
            console.log(`PASS: actual native Gemini ${name}; native authorization flow, durable publication and fresh peer headers.`);
            return;
          }
          const authCode = name.startsWith('auth-code');
          const revoke = name.startsWith('revoke');
          const owner = await start(revoke ? (name === 'revoke-direct' ? 'revoke-direct' : name === 'revoke-old' ? 'revoke-old' : 'revoke') : authCode ? 'auth-code' : name === 'inference-overlap' ? 'inference' : name === 'direct-refresh' ? 'direct' : name === 'direct-no-cache' ? 'direct-no-cache' : 'reader');
          const peer = ['two-refreshes', 'login', 'logout', 'owner-death'].includes(name) ? await start(['login', 'logout'].includes(name) ? name : 'reader') : undefined;
          await fs.writeFile(file, JSON.stringify(credential(revoke ? 'G2' : 'G0', !revoke)), { mode: 0o600 });
          if (['auth-code-uncertain-repair', 'auth-code-unsafe-intent'].includes(name)) {
            await fs.writeFile(intent, JSON.stringify({ version: name === 'auth-code-unsafe-intent' ? 1 : 2, generation: createHash('sha256').update('gemini-refresh-token\0').update('synthetic-refresh-G0').digest('hex') }), { mode: 0o600 });
          }
          owner.child.send({ type: 'start' });
          if (name === 'auth-code-unsafe-intent') {
            await result(owner, 'rejected', 0);
            assert.ok(!owner.events.some(event => event.type === 'exchange'));
            assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
            assert.equal(JSON.parse(await fs.readFile(intent, 'utf8')).version, 1);
            console.log('PASS: actual native Gemini auth-code-unsafe-intent; preserve uncertainty and credentials without an exchange.');
            return;
          }
          if (revoke) {
            if (name === 'revoke-old') {
              await result(owner, 'rejected', 0);
              assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G2');
            } else {
              assert.deepEqual(await Promise.race([owner.wait('revocation'), owner.wait('result')]), { type: 'revocation', selected: 'G2' }, 'Native revocation must use current G2 instead of cached G0.');
              await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
              owner.child.send({ networkError: name === 'revoke-network-refusal' });
              await result(owner, name === 'revoke-network-refusal' ? 'rejected' : 'cleared', 0);
              await result(await start('cold-reader', true, 'cold'), 'rejected', 0);
            }
            await assert.rejects(fs.lstat(intent), { code: 'ENOENT' });
            const finalLock = await fs.stat(lock, { bigint: true });
            assert.equal(`${finalLock.dev}:${finalLock.ino}`, `${initial.dev}:${initial.ino}`);
            for (const worker of workers) await assert.rejects(fs.lstat(path.join(worker.home, '.gemini/oauth_creds.json')), { code: 'ENOENT' });
            console.log(`PASS: actual native Gemini ${name}; current generation, durable local removal and stable lock identity.`);
            return;
          }
          const exchangeOrResult = await Promise.race([owner.wait('exchange'), owner.wait('result')]);
          assert.deepEqual(exchangeOrResult, { type: 'exchange', predecessor: authCode ? 'authorization-code' : 'G0' }, `${name}: expired native credentials must exchange instead of using cached G0 or refusing a usable authority`);
          if (peer) {
            peer.child.send({ type: 'start' });
            await blocked(peer);
            assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
          }
          if (['publication-race', 'auth-code-publication-race'].includes(name)) {
            await fs.writeFile(`${file}.replacement`, JSON.stringify(credential('G2')), { mode: 0o600 });
            await fs.rename(`${file}.replacement`, file);
          }
          if (name === 'owner-death') {
            await stop(owner);
            await result(peer, 'rejected', 0);
          } else {
            owner.child.send({ networkError: ['network-refusal', 'metadata-rewrite', 'factory-root-replacement', 'auth-code-network-refusal'].includes(name), invalidGrant: name === 'invalid-grant', nonRotating: ['non-rotating', 'auth-code-incomplete'].includes(name) });
            if (name === 'inference-overlap') {
              await owner.wait('inference');
              await result(await start('reader', true, 'G1'), 'G1', 0);
              assert.equal(owner.child.exitCode, null);
              assert.equal(owner.child.signalCode, null);
              owner.child.send({ type: 'finish-inference' });
            }
            await result(owner, ['network-refusal', 'metadata-rewrite', 'factory-root-replacement', 'invalid-grant', 'publication-race', 'auth-code-publication-race', 'auth-code-network-refusal', 'auth-code-incomplete'].includes(name) ? 'rejected' : 'G1', 1);
            if (peer) await result(peer, name === 'login' ? 'G2' : name === 'logout' ? 'cleared' : 'G1', 0);
          }
          if (['publication-race', 'auth-code-publication-race'].includes(name)) await result(await start('reader', true, 'G2'), 'G2', 0);
          if (['auth-code-network-refusal', 'auth-code-incomplete'].includes(name)) {
            assert.equal(generation(JSON.parse(await fs.readFile(file, 'utf8')).access_token), 'G0');
            await assert.rejects(fs.lstat(intent), { code: 'ENOENT' });
          } else if (['owner-death', 'network-refusal', 'metadata-rewrite', 'factory-root-replacement', 'invalid-grant'].includes(name)) {
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
              assert.equal(generation(final.access_token), ['login', 'publication-race', 'auth-code-publication-race'].includes(name) ? 'G2' : 'G1');
              assert.equal(final.refresh_token, `synthetic-refresh-${name === 'non-rotating' ? 'G0' : ['login', 'publication-race', 'auth-code-publication-race'].includes(name) ? 'G2' : 'G1'}`);
              if (generation(final.access_token) === 'G1') {
                const accounts = JSON.parse(await fs.readFile(path.join(authority, 'google_accounts.json'), 'utf8'));
                assert.equal(accounts.active, 'synthetic@example.invalid');
                assert.equal(accounts.generation, createHash('sha256').update('gemini-account-generation\0').update(final.refresh_token).digest('hex'));
              }
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
    const scenarios = ['inference-overlap', 'two-refreshes', 'login', 'logout', 'owner-death', 'network-refusal', 'metadata-rewrite', 'factory-root-replacement', 'invalid-grant', 'non-rotating', 'direct-refresh', 'direct-no-cache', 'publication-race', 'auth-code', 'auth-code-publication-race', 'auth-code-network-refusal', 'auth-code-incomplete', 'auth-code-uncertain-repair', 'auth-code-unsafe-intent', 'revoke', 'revoke-direct', 'revoke-old', 'revoke-network-refusal', 'initial-login', 'initial-browser', 'initial-malformed', 'initial-relogin', 'initial-revoke-relogin', 'account-cache', 'account-callback', 'account-switch', 'account-scope-disposal', 'account-stale-response', 'account-logout', 'account-private-conflict', 'account-unsafe-malformed', 'account-unsafe-permissions', 'account-unsafe-hardlink', 'account-unsafe-symlink', 'account-unsafe-directory', 'account-unsafe-oversized'];
    const selected = process.argv.find(value => value.startsWith('--scenario='))?.slice('--scenario='.length);
    if (selected) assert.ok(scenarios.includes(selected));
    for (const name of selected ? [selected] : scenarios) await scenario(name);
  } finally {
    if (safeCleanup) await fs.rm(root, { recursive: true, force: true });
  }
}
