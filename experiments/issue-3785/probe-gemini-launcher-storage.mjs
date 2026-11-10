#!/usr/bin/env node
// Exercise real installed launcher/admission bytes with a bounded synthetic command tag.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [moduleFile, executable] = process.argv.slice(2);
assert.ok(moduleFile && executable);
let commands;
let onVersion;
let transient;
const commandTag =
  options =>
  (strings, ...values) => {
    const command = strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '');
    commands.push({ command, env: options?.env });
    if (command.includes('--version')) onVersion?.();
    return {
      code: 0,
      stdout: command.includes('--version') ? '0.65.0' : '{"response":"SYNTHETIC-GEMINI-OK"}',
      stderr: '',
      stream: async function* () {
        yield { type: 'stdout', data: transient ? '503 Service Unavailable' : '{"type":"result","response":"SYNTHETIC-GEMINI-OK"}\n' };
        yield { type: 'exit', code: transient ? 1 : 0 };
      },
    };
  };
const dollar = (strings, ...values) => (Array.isArray(strings) ? commandTag()(strings, ...values) : commandTag(strings));
globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: dollar };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  // Resolve like the tested package does: this probe lives outside it and has
  // no node_modules of its own (e.g. `links-notation` via lenv-reader).
  return import(pathToFileURL(createRequire(path.resolve(moduleFile)).resolve(packageName)).href);
};
process.env.HIVE_MIND_MODELS_HOT_LOAD = '0';
const { validateGeminiConnection, executeGeminiCommand } = await import(pathToFileURL(path.resolve(moduleFile)));
const command = fs.realpathSync(executable);
const refusal = { code: 'NATIVE_GEMINI_STORAGE_VIOLATION' };
const identity = directory => {
  const info = fs.statSync(directory, { bigint: true });
  return `${info.dev}:${info.ino}`;
};
async function fixture(check, marked = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-launcher-storage-'));
  const home = path.join(root, 'private');
  const auth = path.join(root, 'auth');
  const history = path.join(root, 'history');
  for (const directory of [home, auth, history]) fs.mkdirSync(directory, { mode: 0o700 });
  const credentials = path.join(auth, 'oauth_creds.json');
  fs.writeFileSync(credentials, '{"access_token":"synthetic-launcher-token","refresh_token":"synthetic-launcher-refresh","token_type":"Bearer","expiry_date":4102444800000}', { mode: 0o600 });
  const env = { HOME: home, GEMINI_CLI_HOME: home, GEMINI_PATH: executable, GEMINI_AUTH_HOME: auth, GEMINI_HISTORY_HOME: history, HIVE_MIND_USE_ROUTER: '0', HIVE_MIND_GEMINI_AUTH_IDENTITY: marked ? identity(auth) : undefined, HIVE_MIND_GEMINI_HISTORY_IDENTITY: marked ? identity(history) : undefined };
  for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_ACCESS_TOKEN', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_GENAI_USE_GCA', 'GEMINI_FORCE_ENCRYPTED_FILE_STORAGE']) env[name] = undefined;
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const assign = values => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  commands = [];
  onVersion = null;
  transient = false;
  assign(env);
  try {
    await check({ root, home, auth, history, credentials });
  } finally {
    assign(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function assertForwarded(auth, history) {
  for (const invocation of commands) {
    assert.ok(invocation.command.includes(command));
    assert.equal(invocation.env.HIVE_MIND_GEMINI_AUTH_IDENTITY, identity(auth));
    assert.equal(invocation.env.HIVE_MIND_GEMINI_HISTORY_IDENTITY, identity(history));
  }
}
for (const marked of [false, true]) {
  await fixture(async ({ auth, history }) => {
    assert.equal(await validateGeminiConnection('flash'), true);
    assert.equal(commands.length, 2);
    assertForwarded(auth, history);
    if (!marked) assert.equal(process.env.HIVE_MIND_GEMINI_AUTH_IDENTITY, undefined, 'Derived child identities must not alter the parent environment.');
  }, marked);
  console.log(`PASS: actual launcher forwards ${marked ? 'inherited' : 'derived'} storage identities to both admitted connection commands.`);
}
await fixture(async f => {
  for (const name of ['GEMINI_AUTH_HOME', 'GEMINI_HISTORY_HOME']) delete process.env[name];
  onVersion = () => {
    process.env.GEMINI_AUTH_HOME = f.auth;
  };
  await assert.rejects(validateGeminiConnection('flash'), refusal);
  assert.equal(commands.length, 1);
});
console.log('PASS: ordinary connection authority cannot switch to selected native storage after the version probe.');
await fixture(async () => {
  onVersion = () => {
    delete process.env.HIVE_MIND_GEMINI_AUTH_IDENTITY;
  };
  await assert.rejects(validateGeminiConnection('flash'), refusal);
  assert.equal(commands.length, 1);
}, true);
console.log('PASS: inherited auth identity removal between connection commands preserves a typed refusal.');
for (const scenario of ['auth replacement', 'history replacement', 'logout', 'selector removal', 'native helper replacement']) {
  await fixture(async f => {
    const helper = path.join(path.dirname(command), 'hive-gemini-storage-identity.mjs');
    const original = fs.readFileSync(helper);
    onVersion = () => {
      if (scenario.endsWith(' replacement') && scenario !== 'native helper replacement') {
        const directory = scenario.startsWith('auth') ? f.auth : f.history;
        fs.renameSync(directory, directory + '-retired');
        fs.mkdirSync(directory, { mode: 0o700 });
        if (directory === f.auth) fs.copyFileSync(path.join(directory + '-retired', 'oauth_creds.json'), f.credentials);
      } else if (scenario === 'logout') fs.unlinkSync(f.credentials);
      else if (scenario === 'selector removal') delete process.env.GEMINI_HISTORY_HOME;
      else fs.appendFileSync(helper, '\n// synthetic launcher mutation\n');
    };
    try {
      await assert.rejects(validateGeminiConnection('flash'), refusal);
      assert.equal(commands.length, 1, 'Unsafe post-version state must refuse the provider command.');
    } finally {
      fs.writeFileSync(helper, original);
    }
  });
  console.log(`PASS: actual launcher refuses ${scenario} between version and paid connection probes.`);
}
const execute = (f, overrides = {}) => executeGeminiCommand({ tempDir: f.home, branchName: 'synthetic', prompt: 'SYNTHETIC', systemPrompt: '', argv: { model: 'flash' }, log: async () => {}, formatAligned: (...parts) => parts.join(' '), getResourceSnapshot: async () => ({ memory: 'synthetic\nsynthetic', load: '0' }), geminiPath: executable, $: dollar, ...overrides });
await fixture(async f => {
  assert.equal((await execute(f)).success, true);
  assert.equal(commands.length, 1);
  assertForwarded(f.auth, f.history);
});
console.log('PASS: actual execution launcher admits the installed command and forwards both derived identities.');
await fixture(async f => {
  await assert.rejects(
    execute(f, {
      getResourceSnapshot: async () => {
        delete process.env.GEMINI_HISTORY_HOME;
        return { memory: 'synthetic\nsynthetic', load: '0' };
      },
    }),
    refusal
  );
  assert.equal(commands.length, 0);
});
console.log('PASS: actual execution launcher refuses selection removal during preparation before command execution.');
for (const prepareOnly of [false, true]) {
  await fixture(async f => {
    await assert.rejects(
      execute(f, {
        argv: { model: 'flash', prepareOnly },
        log: async message => {
          if (String(message).includes('Raw command:')) delete process.env.GEMINI_HISTORY_HOME;
        },
      }),
      refusal
    );
    assert.equal(commands.length, 0);
  });
  console.log(`PASS: ${prepareOnly ? 'prepare-only' : 'actual'} execution refuses selection removal during final command logging.`);
}
for (const replace of [false, true]) {
  await fixture(async f => {
    transient = true;
    let retries = 0;
    const invoke = execute(f, {
      waitForRetryDelay: async () => {
        assert.equal(++retries, 1, 'The fixture permits exactly one retry.');
        transient = false;
        if (replace) {
          fs.renameSync(f.history, f.history + '-retired');
          fs.mkdirSync(f.history, { mode: 0o700 });
        }
      },
    });
    if (replace) {
      await assert.rejects(invoke, refusal);
      assert.equal(commands.length, 1);
    } else {
      assert.equal((await invoke).success, true);
      assert.equal(commands.length, 2);
      assertForwarded(f.auth, f.history);
    }
    assert.equal(retries, 1);
  });
  console.log(`PASS: actual execution retry ${replace ? 'refuses a replaced history directory before a second command' : 'retains initially unmarked canonical authority and completes'}.`);
}
