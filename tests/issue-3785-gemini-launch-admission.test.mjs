/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

let commands;
const alternateAuthorities = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_ACCESS_TOKEN', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE'];
const dollar = (strings, ...values) => {
  if (!Array.isArray(strings)) return dollar;
  const command = strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '');
  commands.push(command);
  return { code: 0, stdout: command.includes('--version') ? '0.65.0' : '{"response":"SYNTHETIC-GEMINI-OK"}', stderr: '' };
};
globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: dollar };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};
process.env.HIVE_MIND_MODELS_HOT_LOAD = '0';
const { validateGeminiConnection, executeGemini, executeGeminiCommand } = await import('../src/gemini.lib.mjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-launch-admission-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'private');
  const auth = path.join(root, 'auth');
  const history = path.join(root, 'history');
  for (const directory of [home, auth, history]) fs.mkdirSync(directory, { mode: 0o700 });
  const configuration = path.join(home, '.gemini');
  fs.mkdirSync(configuration, { mode: 0o700 });
  fs.writeFileSync(path.join(auth, 'oauth_creds.json'), '{"access_token":"synthetic-gemini-token","refresh_token":"synthetic-gemini-refresh","token_type":"Bearer","expiry_date":4102444800000}', { mode: 0o600 });
  const command = path.join(root, 'unverified-gemini');
  fs.writeFileSync(command, '#!/bin/sh\necho 0.65.0\n', { mode: 0o700 });
  const identity = directory => {
    const info = fs.statSync(directory, { bigint: true });
    return `${info.dev}:${info.ino}`;
  };
  const env = { HOME: home, GEMINI_CLI_HOME: home, GEMINI_PATH: command, GEMINI_AUTH_HOME: auth, GEMINI_HISTORY_HOME: history, HIVE_MIND_GEMINI_AUTH_IDENTITY: identity(auth), HIVE_MIND_GEMINI_HISTORY_IDENTITY: identity(history), HIVE_MIND_USE_ROUTER: '0' };
  for (const key of alternateAuthorities) env[key] = undefined;
  for (const [key, value] of Object.entries(env)) {
    const before = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    t.after(() => {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    });
  }
  commands = [];
  return { root, home, auth, history, configuration };
}

for (const name of alternateAuthorities) {
  test(`selected OAuth Gemini refuses competing ${name} before any command`, { timeout: 10000 }, async t => {
    const f = fixture(t);
    process.env[name] = 'synthetic-alternate-authority';
    let refusal;
    try {
      await validateGeminiConnection('flash');
    } catch (error) {
      refusal = error;
    }
    assert.equal(commands.length, 0);
    assert.equal(refusal?.code, 'NATIVE_GEMINI_STORAGE_VIOLATION');
    assert.ok(!refusal.message.includes(f.root));
    assert.ok(!refusal.message.includes('synthetic-alternate-authority'));
  });
}

for (const scenario of ['unverified command', 'wrong auth identity', 'wrong history identity', 'missing auth selector', 'missing history selector', 'empty auth selector', 'empty history selector', 'public auth directory', 'public history directory', 'competing private credentials', 'malformed credentials', 'non-object credentials', 'incomplete credentials', 'empty configuration override', 'symlinked configuration']) {
  test(`selected Gemini ${scenario} refuses before version/provider execution`, { timeout: 10000 }, async t => {
    const f = fixture(t);
    if (scenario === 'wrong auth identity') process.env.HIVE_MIND_GEMINI_AUTH_IDENTITY = '0:0';
    if (scenario === 'wrong history identity') process.env.HIVE_MIND_GEMINI_HISTORY_IDENTITY = '0:0';
    if (scenario === 'missing auth selector') delete process.env.GEMINI_AUTH_HOME;
    if (scenario === 'missing history selector') delete process.env.GEMINI_HISTORY_HOME;
    if (scenario === 'empty auth selector') process.env.GEMINI_AUTH_HOME = '';
    if (scenario === 'empty history selector') process.env.GEMINI_HISTORY_HOME = '';
    if (scenario === 'public auth directory') fs.chmodSync(f.auth, 0o755);
    if (scenario === 'public history directory') fs.chmodSync(f.history, 0o755);
    if (scenario === 'competing private credentials') fs.copyFileSync(path.join(f.auth, 'oauth_creds.json'), path.join(f.configuration, 'oauth_creds.json'));
    if (scenario === 'malformed credentials') fs.writeFileSync(path.join(f.auth, 'oauth_creds.json'), '{', { mode: 0o600 });
    if (scenario === 'non-object credentials') fs.writeFileSync(path.join(f.auth, 'oauth_creds.json'), 'null', { mode: 0o600 });
    if (scenario === 'incomplete credentials') fs.writeFileSync(path.join(f.auth, 'oauth_creds.json'), '{"access_token":"synthetic-incomplete"}', { mode: 0o600 });
    if (scenario === 'empty configuration override') process.env.GEMINI_CLI_HOME = '';
    if (scenario === 'symlinked configuration') {
      fs.rmdirSync(f.configuration);
      fs.symlinkSync(f.auth, f.configuration);
    }
    let refusal;
    try {
      await validateGeminiConnection('gemini-3.1-pro');
    } catch (error) {
      refusal = error;
    }
    assert.equal(commands.length, 0, 'Selected storage must be admitted before any native version/provider command.');
    assert.equal(refusal?.code, 'NATIVE_GEMINI_STORAGE_VIOLATION');
  });
}

test('ordinary unselected Gemini keeps its version and connection probes', { timeout: 10000 }, async t => {
  fixture(t);
  for (const name of ['GEMINI_AUTH_HOME', 'GEMINI_HISTORY_HOME', 'HIVE_MIND_GEMINI_AUTH_IDENTITY', 'HIVE_MIND_GEMINI_HISTORY_IDENTITY']) delete process.env[name];
  assert.equal(await validateGeminiConnection('gemini-3.1-pro'), true);
  assert.equal(commands.length, 2);
});

test('explicit Gemini Router authentication refusal takes precedence over native admission', { timeout: 10000 }, async t => {
  fixture(t);
  await assert.rejects(validateGeminiConnection('flash', { useRouter: true }), { code: 'ROUTER_AUTH_VIOLATION' });
  assert.equal(commands.length, 0);
});

for (const [name, execute] of [
  ['task entrypoint', executeGemini],
  ['direct command entrypoint', executeGeminiCommand],
]) {
  test(`selected unverified Gemini ${name} refuses before execution preparation`, { timeout: 10000 }, async t => {
    fixture(t);
    let preparationCalls = 0;
    const prepare = () => {
      preparationCalls++;
      throw new Error('Synthetic preparation must not run for unadmitted selected storage.');
    };
    let refusal;
    try {
      await execute({ geminiPath: process.env.GEMINI_PATH, argv: { model: 'flash' }, log: prepare, getResourceSnapshot: prepare, formatAligned: prepare, $: dollar });
    } catch (error) {
      refusal = error;
    }
    assert.equal(preparationCalls, 0, 'Selected native command admission must precede preparation.');
    assert.equal(commands.length, 0);
    assert.equal(refusal?.code, 'NATIVE_GEMINI_STORAGE_VIOLATION');
  });
}
