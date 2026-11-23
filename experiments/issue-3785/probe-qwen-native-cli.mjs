// Disposable, bounded real Qwen CLI requests against a loopback model endpoint.
// OAuth sunset refusal is preserved; unsupported alternative authorities must
// not silently bypass a selected canonical OAuth authority.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[2] === '--factory-worker') {
  const { createContentGenerator } = await import(pathToFileURL(path.join(process.argv[3], 'chunks/chunk-IZBWWW2B.js')).href);
  const authority = process.env.QWEN_AUTH_HOME;
  const refused = /Canonical Qwen authentication does not support this provider authority/u;
  const configurations = ['openai', 'openai-responses', 'anthropic', 'gemini', 'vertex-ai'].map(authType => ({ authType, apiKey: 'synthetic-independent-key', model: 'synthetic-model', baseUrl: 'http://127.0.0.1:1' }));
  for (const configuration of configurations) {
    await assert.rejects(() => createContentGenerator(configuration, {}, false), refused);
    console.log(`PASS: actual native provider factory refuses selected ${configuration.authType} authority before loading its provider.`);
  }
  for (const field of ['apiKey', 'apiKeyEnvKey', 'baseUrl', 'proxy', 'customHeaders', 'reasoningRouteBaseUrl']) {
    await assert.rejects(() => createContentGenerator({ authType: 'qwen-oauth', [field]: 'synthetic-override' }, {}, false), refused);
    console.log(`PASS: actual native OAuth provider factory refuses independent ${field}.`);
  }
  delete process.env.QWEN_AUTH_HOME;
  const retained = [];
  for (const configuration of configurations) retained.push(await createContentGenerator(configuration, {}, false));
  process.env.QWEN_AUTH_HOME = authority;
  for (const generator of retained) {
    for (const method of ['generateContent', 'generateContentStream', 'embedContent']) await assert.rejects(() => generator[method]({}, 'synthetic-prompt'), refused);
  }
  console.log('PASS: all five retained native provider handles refuse content, stream and embedding use after canonical selection changes.');
  process.exit(0);
}

const packageRoot = path.resolve(process.env.QWEN_PROBE_PACKAGE || 'experiments/issue-3785/native-qwen/stock-cli/node_modules/@qwen-code/qwen-code');
assert.equal(JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version, '0.26.1');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-3785-qwen-cli-'));
let child;
let closed;
let timer;
let server;
try {
  const home = path.join(root, 'home');
  const config = path.join(root, 'config');
  const authority = path.join(root, 'authority');
  for (const directory of [home, config, authority]) await fs.mkdir(directory, { mode: 0o700 });
  const help = process.argv.includes('--help');
  const sunset = process.argv.includes('--oauth-sunset');
  const legacy = process.argv.includes('--without-selector');
  const negative = process.argv.includes('--expect-provider-bypass');
  const factory = process.argv.includes('--factory-controls');
  const requests = [];
  let refuse;
  const protocolFailure = new Promise((_, reject) => {
    refuse = reject;
  });
  let originalCredentials;
  if (!help && !factory) {
    server = http.createServer((request, response) => {
      if (requests.length >= 8) {
        refuse(new Error('Native CLI exceeded the finite model-request bound.'));
        response.writeHead(503).end();
        return;
      }
      requests.push({ method: request.method, url: request.url, generation: request.headers.authorization === 'Bearer synthetic-access-G2' ? 'G2' : 'unexpected' });
      let bytes = 0;
      request.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 131072) {
          refuse(new Error('Native CLI model request exceeded its finite body bound.'));
          request.destroy();
        }
      });
      request.resume();
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const value of [
        { id: 'synthetic-completion', object: 'chat.completion.chunk', created: 1, model: 'qwen3-coder-plus', choices: [{ index: 0, delta: { role: 'assistant', content: 'Synthetic response.' }, finish_reason: null }] },
        { id: 'synthetic-completion', object: 'chat.completion.chunk', created: 1, model: 'qwen3-coder-plus', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      ])
        response.write(`data: ${JSON.stringify(value)}\n\n`);
      response.end('data: [DONE]\n\n');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    originalCredentials = JSON.stringify({ access_token: 'synthetic-access-G0', refresh_token: 'synthetic-refresh-G0', token_type: 'Bearer', expiry_date: Date.now() + 3600000, resource_url: `http://127.0.0.1:${server.address().port}` });
    await fs.writeFile(path.join(authority, 'oauth_creds.json'), originalCredentials, { mode: 0o600 });
    await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify({ general: { enableAutoUpdate: false }, telemetry: { enabled: false }, privacy: { usageStatisticsEnabled: false } }), { mode: 0o600 });
  }
  const selection = sunset ? ['--auth-type', 'qwen-oauth', '--model', 'coder-model'] : ['--auth-type', 'openai', '--model', 'synthetic-model', '--openai-api-key', 'synthetic-access-G2', '--openai-base-url', `http://127.0.0.1:${server?.address().port}/v1`];
  const args = factory ? [fileURLToPath(import.meta.url), '--factory-worker', packageRoot] : [path.join(packageRoot, 'cli-entry.js'), ...(help ? ['--help'] : ['--bare', '--safe-mode', ...selection, '--max-session-turns', '1', '--max-wall-time', '15s', '--max-tool-calls', '0', '--output-format', 'json', '--prompt', 'Return a synthetic response without using tools.'])];
  child = spawn('/usr/bin/prlimit', ['--data=2147483648', '--stack=16777216', '--core=0', '--', process.execPath, '--max-old-space-size=256', ...args], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: home, QWEN_HOME: config, ...(legacy ? {} : { QWEN_AUTH_HOME: authority }), QWEN_RUNTIME_DIR: path.join(root, 'runtime'), XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'), XDG_CACHE_HOME: path.join(home, '.cache'), CI: 'true', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let output = '';
  const overflow = new Promise((_, reject) => {
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', chunk => {
        output += chunk.toString('utf8');
        if (output.length > 131072) reject(new Error('Native CLI output exceeded its finite bound.'));
      });
  });
  const result = await Promise.race([
    closed,
    overflow,
    protocolFailure,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Finite native CLI deadline exceeded.')), 30000);
    }),
  ]);
  if (originalCredentials) {
    assert.equal(await fs.readFile(path.join(authority, 'oauth_creds.json'), 'utf8'), originalCredentials, 'The synthetic canonical authority must remain unchanged.');
    await assert.rejects(fs.lstat(path.join(config, 'oauth_creds.json')), { code: 'ENOENT' });
  }
  if (process.env.QWEN_PROBE_DIAGNOSTIC_FILE) await fs.writeFile(process.env.QWEN_PROBE_DIAGNOSTIC_FILE, JSON.stringify({ result, requests, output }), { mode: 0o600 });
  if (help || factory) {
    assert.match(output, factory ? /all five retained native provider handles/u : /--prompt/u);
    assert.deepEqual(result, { code: 0, signal: null });
    console.log(output);
  } else if (sunset) {
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.deepEqual(requests, []);
    assert.match(output, /Qwen OAuth free tier was discontinued on 2026-04-15/u);
    console.log('CONTROL: actual native Qwen CLI preserves its OAuth sunset refusal and sends no model request. Native OAuth-method controls cannot establish CLI OAuth usability.');
  } else if (legacy || negative) {
    assert.deepEqual(result, { code: 0, signal: null });
    assert.deepEqual(requests, [{ method: 'POST', url: '/v1/chat/completions', generation: 'G2' }]);
    console.log(legacy ? 'CONTROL: without a canonical selector, the actual native Qwen CLI uses its explicit synthetic API key and loopback model endpoint.' : 'REPRODUCED: the actual native Qwen CLI ignores selected canonical OAuth authority and sends a model request with an independent API key.');
  } else {
    assert.deepEqual(requests, [], 'Selected canonical Qwen authority must refuse independent provider credentials before model execution.');
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(output, /Canonical Qwen authentication does not support this provider authority/u);
    console.log('PASS: actual native Qwen CLI refuses unsupported independent provider authority before model execution.');
  }
} finally {
  clearTimeout(timer);
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  if (closed) await closed;
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
