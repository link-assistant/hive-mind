// Actual pinned native config/client constructors and Code Assist dispatch.
// Only provider transport/token verification/user-info are synthetic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { Buffer } from 'node:buffer';

const credential = value => ({ access_token: `synthetic-access-${value}`, refresh_token: `synthetic-refresh-${value}`, token_type: 'Bearer', expiry_date: Date.now() + 3600000 });
const competingKey = 'synthetic-competing-api-key';
const endpoint = 'https://cloudcode-pa.googleapis.com/v1internal:countTokens';

if (process.argv[2] === '--worker') {
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === 'https://www.googleapis.com/oauth2/v2/userinfo') return new globalThis.Response(JSON.stringify({ email: 'synthetic@example.invalid' }), { headers: { 'Content-Type': 'application/json' } });
    // Real SDK model requests must pass through the inspected synthetic boundary.
    requests++;
    assert.ok(String(url).startsWith('https://generativelanguage.googleapis.com/') || String(url).startsWith('https://aiplatform.googleapis.com/'));
    assert.ok(options);
    return new globalThis.Response(JSON.stringify({ totalTokens: 1 }), { headers: { 'Content-Type': 'application/json' } });
  };
  const native = await import(pathToFileURL(process.argv[3]).href);
  native.__probeGoogleAuth.OAuth2Client.prototype.getTokenInfo = async () => ({ expiry_date: Date.now() + 3600000, scopes: [] });
  const name = process.argv[4];
  const authority = process.env.GEMINI_AUTH_HOME || path.join(process.env.HOME, '.gemini');
  const config = { getProxy: () => undefined, getModel: () => 'gemini-2.5-flash', getClientName: () => undefined, getUsageStatisticsEnabled: () => false, isInteractive: () => false };
  let selected;
  try {
    if (name.startsWith('factory-')) {
      config.env = name === 'factory-env-key' ? { GEMINI_API_KEY: competingKey } : { GEMINI_AUTH_HOME: path.join(process.env.HOME, 'other-authority') };
      await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
      selected = 'accepted';
    } else if (name.startsWith('config-')) {
      let authType = native.AuthType.LOGIN_WITH_GOOGLE;
      let apiKey;
      let baseUrl;
      let headers;
      if (name === 'config-api-key') {
        authType = native.AuthType.USE_GEMINI;
        apiKey = competingKey;
      }
      if (name === 'config-vertex') {
        authType = native.AuthType.USE_VERTEX_AI;
        config.env = { GOOGLE_API_KEY: competingKey };
      }
      if (name === 'config-adc') authType = native.AuthType.COMPUTE_ADC;
      if (name === 'config-gateway') {
        authType = native.AuthType.GATEWAY;
        apiKey = competingKey;
      }
      if (name === 'config-oauth-key') apiKey = competingKey;
      if (name === 'config-oauth-env') config.env = { GEMINI_API_KEY: competingKey };
      if (name === 'config-oauth-root') config.env = { GEMINI_AUTH_HOME: path.join(process.env.HOME, 'other-authority') };
      if (name === 'config-oauth-base') baseUrl = 'https://synthetic-endpoint.example.invalid';
      if (name === 'config-oauth-header') headers = { aUtHoRiZaTiOn: `Bearer ${competingKey}` };
      const result = await native.createContentGeneratorConfig(config, authType, apiKey, baseUrl, headers);
      assert.equal(result.authType, authType);
      if (authType === native.AuthType.USE_GEMINI || authType === native.AuthType.USE_VERTEX_AI || authType === native.AuthType.GATEWAY) assert.equal(result.apiKey, competingKey);
      selected = 'accepted';
    } else if (name.startsWith('constructor-')) {
      const authType = name === 'constructor-vertex' ? native.AuthType.USE_VERTEX_AI : name === 'constructor-gateway' ? native.AuthType.GATEWAY : native.AuthType.USE_GEMINI;
      const generator = await native.createContentGenerator({ authType, apiKey: competingKey }, config, 'synthetic-session');
      assert.ok(generator.getWrapped().getWrapped());
      // SDK constructors are real; dispatch directly through their public models
      // interface so unrelated CLI telemetry configuration cannot mask bypasses.
      if (name === 'constructor-api-key') {
        assert.equal((await generator.getWrapped().getWrapped().countTokens({ model: 'gemini-2.5-flash', contents: 'synthetic' })).totalTokens, 1);
        assert.equal(requests, 1);
      }
      selected = 'accepted';
    } else {
      const client = await native.getOauthClient(native.AuthType.LOGIN_WITH_GOOGLE, config);
      client.transporter.request = async options => {
        requests++;
        const headers = new globalThis.Headers(options.headers);
        if (requests === 1) assert.equal(headers.get('authorization'), 'Bearer synthetic-access-G0');
        if (name === 'request-replacement' && requests === 2) assert.equal(headers.get('authorization'), `Bearer synthetic-access-${process.env.GEMINI_AUTH_HOME ? 'G1' : 'G0'}`);
        return { status: 200, headers: {}, data: { totalTokens: 1 } };
      };
      const options = { headers: { 'X-Synthetic-Trace': 'permitted' } };
      const server = new native.CodeAssistServer(client, 'synthetic-project', options, 'synthetic-session');
      assert.equal((await server.requestPost('countTokens', {})).totalTokens, 1);
      assert.equal(requests, 1, 'Require healthy native dispatch before authority mutation.');
      if (name === 'request-replacement') {
        await fs.writeFile(path.join(authority, 'replacement'), JSON.stringify(credential('G1')), { mode: 0o600 });
        await fs.rename(path.join(authority, 'replacement'), path.join(authority, 'oauth_creds.json'));
      }
      if (name === 'request-env-endpoint') process.env.CODE_ASSIST_ENDPOINT = 'https://synthetic-endpoint.example.invalid';
      if (name === 'request-env-version') process.env.CODE_ASSIST_API_VERSION = 'synthetic-version';
      if (name === 'request-env-header') process.env.GEMINI_CLI_CUSTOM_HEADERS = `Authorization: Bearer ${competingKey}`;
      if (name === 'request-env-api-key') process.env.GEMINI_API_KEY = competingKey;
      if (['request-header', 'request-stream-header', 'request-get-header'].includes(name)) options.headers['aUtHoRiZaTiOn'] = `Bearer ${competingKey}`;
      if (name === 'request-api-header') options.headers['x-goog-api-key'] = competingKey;
      if (name === 'request-client' || name === 'request-client-unset')
        server.client = {
          request: async () => {
            requests++;
            return { data: { totalTokens: 1 } };
          },
        };
      if (['request-selector-unset', 'request-client-unset', 'request-new-constructor'].includes(name)) delete process.env.GEMINI_AUTH_HOME;
      if (name === 'request-selector-switch' && process.env.GEMINI_AUTH_HOME) process.env.GEMINI_AUTH_HOME = path.join(process.env.HOME, 'other-authority');
      if (name === 'request-logout') await fs.unlink(path.join(authority, 'oauth_creds.json'));
      if (name === 'request-new-constructor') assert.ok(await native.createContentGenerator({ authType: native.AuthType.USE_GEMINI, apiKey: competingKey }, config, 'synthetic-session'));
      else if (name === 'request-direct-url') await server.makeGetRequest('https://synthetic-endpoint.example.invalid/model');
      else if (name === 'request-stream-header') await server.requestStreamingPost('streamGenerateContent', {});
      else if (name === 'request-get-header') await server.makeGetRequest(endpoint);
      else await server.requestPost('countTokens', {});
      selected = 'accepted';
    }
  } catch (error) {
    if (!/^Gemini canonical (authentication|account storage) is unavailable or unsafe\.$/u.test(error.message)) throw error;
    selected = 'rejected';
  }
  process.send({ selected, requests });
  process.disconnect();
} else {
  const moduleFile = process.env.GEMINI_PROBE_MODULE;
  assert.ok(moduleFile, 'The exact inspected native Gemini package is required.');
  const metadata = JSON.parse(await fs.readFile(path.join(path.dirname(moduleFile), '..', 'package.json'), 'utf8'));
  assert.equal(metadata.version, '0.65.0');
  const source = await fs.readFile(moduleFile, 'utf8');
  assert.ok(['d7770e02fce0af146f78d6f509c83c53de8f0a5eb2933d6956707291ff3a8c9d', '8152d28141b69a2cb351d46faa3fdd3b111ac6bc4d012dafd432a828436a66ae', 'c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792', '6cb363864dca9a4756e66142b3e30244d59a0702a258c2e5279b87b07ff609b3', '3062c3291a9a49d62177b20b8ef450c50f96a507cd4bdc168969a9dc45764970', '4b4daad35a3af8de066e49d866d14f163502a51234acb10c7c2b76a32213af64', '463cf8af6e9a06f2a1ff7ae2a484fcfa5d8d53f77c604f3e51344e71f3b1ed61', '0c70897032c0ad76419b3149d783567280dfd972ef2c04e258cbebccc9575c42', 'ce32eec6ab27f4d9fbf1449a5bdc70ad9b06fde0aff84b560ac1540a9106a9fa', '236c3faf39cbe2a022409be5ee3ee3147ac1686d146336d0126f6e23f0b465b2', '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b'].includes(createHash('sha256').update(source).digest('hex')), 'Only exact inspected native manager stages may run.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-gemini-request-auth-'));
  const bundle = path.join(root, 'bundle');
  await fs.mkdir(bundle, { mode: 0o700 });
  for (const item of await fs.readdir(path.dirname(moduleFile))) if (item !== path.basename(moduleFile)) await fs.symlink(path.join(path.dirname(moduleFile), item), path.join(bundle, item));
  const instrumented = path.join(bundle, 'probe-manager.mjs');
  await fs.writeFile(instrumented, source + '\nexport { import_google_auth_library3 as __probeGoogleAuth };\n', { mode: 0o600 });
  const withoutSelector = process.argv.includes('--without-selector');
  const expectGaps = process.argv.includes('--expect-native-gaps');
  const trace = process.argv.includes('--trace');
  let safeCleanup = true;
  async function stopWorker(child, closed) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') {
        safeCleanup = false;
        throw new Error('Native request process-group cleanup failed; fixtures retained.', { cause: error });
      }
    }
    await closed;
  }
  try {
    const scenarios = ['config-api-key', 'config-vertex', 'config-adc', 'config-gateway', 'config-oauth-key', 'config-oauth-env', 'config-oauth-root', 'config-oauth-base', 'config-oauth-header', 'factory-env-key', 'factory-env-root', 'constructor-api-key', 'constructor-vertex', 'constructor-gateway', 'request-replacement', 'request-env-endpoint', 'request-env-version', 'request-env-header', 'request-env-api-key', 'request-header', 'request-stream-header', 'request-get-header', 'request-api-header', 'request-client', 'request-client-unset', 'request-selector-unset', 'request-selector-switch', 'request-new-constructor', 'request-logout', 'request-direct-url'];
    for (const name of scenarios.filter(item => !process.argv.some(arg => arg.startsWith('--scenario=')) || process.argv.includes(`--scenario=${item}`))) {
      const home = path.join(root, name);
      const authority = path.join(home, withoutSelector ? '.gemini' : 'authority');
      await fs.mkdir(path.join(home, '.gemini'), { recursive: true, mode: 0o700 });
      await fs.mkdir(authority, { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(authority, 'oauth_creds.json'), JSON.stringify(credential('G0')), { mode: 0o600 });
      const child = spawn('/usr/bin/prlimit', ['--data=2147483648', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=256', fileURLToPath(import.meta.url), '--worker', instrumented, name], {
        cwd: home,
        env: { PATH: process.env.PATH, HOME: home, GEMINI_CLI_HOME: home, GEMINI_CLI_NO_RELAUNCH: '1', ...(withoutSelector ? {} : { GEMINI_AUTH_HOME: authority }), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache') },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        detached: true,
      });
      const diagnostics = [];
      let bytes = 0;
      let timer;
      let result;
      const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
      try {
        await Promise.race([
          new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error('Finite native request probe deadline exceeded.')), 20000);
            child.once('error', () => reject(new Error('Native request probe could not start.')));
            child.once('message', value => {
              result = value;
            });
            child.once('close', () => {
              if (!result) reject(new Error('Native request probe exited before completion.'));
              else resolve();
            });
            for (const stream of [child.stdout, child.stderr])
              stream.on('data', chunk => {
                bytes += chunk.length;
                if (bytes <= 65536) diagnostics.push(chunk);
                else reject(new Error('Native request probe diagnostics exceeded their bound.'));
              });
          }),
        ]);
        const health = name === 'request-replacement';
        const existingRefusal = ['request-env-api-key', 'request-logout', 'request-selector-unset', 'request-selector-switch'].includes(name);
        const selected = health || withoutSelector || (expectGaps && !existingRefusal) ? 'accepted' : 'rejected';
        const expectedRequests = name.startsWith('config-') || name.startsWith('factory-') || name === 'constructor-vertex' || name === 'constructor-gateway' ? 0 : name === 'constructor-api-key' ? (selected === 'accepted' ? 1 : 0) : name === 'request-new-constructor' ? 1 : health || selected === 'accepted' ? 2 : 1;
        assert.deepEqual(result, { selected, requests: expectedRequests }, `${name}: actual native authority admission`);
        assert.deepEqual(await closed, { code: 0, signal: null });
        console.log(`PASS: native Gemini ${name}; selected=${selected}; requests=${result.requests}.`);
      } catch (error) {
        if (trace) console.error(Buffer.concat(diagnostics).toString('utf8'));
        throw error;
      } finally {
        clearTimeout(timer);
        await stopWorker(child, closed);
      }
    }
  } finally {
    if (safeCleanup) await fs.rm(root, { recursive: true, force: true });
  }
}
