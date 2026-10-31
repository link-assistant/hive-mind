#!/usr/bin/env node
// Exercise production adapters with mocked commands; never execute a native CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { buildRouterTaskEnv } from '../../src/router-isolation.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';
import { inspectRouterTaskEnvironment } from '../../src/router-task-auth.lib.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'router-extra-native-'));
const inherited = { ...process.env };
fs.mkdirSync(path.join(root, 'tmp'));
Object.assign(process.env, { HOME: root, TMPDIR: path.join(root, 'tmp'), XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache'), HIVE_MIND_STATE_DIR: path.join(root, 'state'), HIVE_MIND_MODELS_HOT_LOAD: '0', HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES: '0' });
after(() => {
  for (const key of Object.keys(process.env)) if (!(key in inherited)) delete process.env[key];
  Object.assign(process.env, inherited);
  fs.rmSync(root, { recursive: true, force: true });
});

let nativeCommand;
const dollar = (strings, ...values) => {
  if (!Array.isArray(strings)) return dollar;
  return nativeCommand(strings.reduce((text, part, index) => text + part + (values[index] ?? ''), ''));
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

const adapters = {};
const { validateToolConnection } = await import('../../src/tool-connection-validation.lib.mjs');
const { runStartupChecks } = await import('../../src/hive.startup-checks.lib.mjs');
for (const [tool, suffix, model] of [
  ['agent', 'Agent', 'sonnet'],
  ['opencode', 'OpenCode', 'sonnet'],
  ['gemini', 'Gemini', 'gemini-2.5-pro'],
  ['qwen', 'Qwen', 'qwen3-coder-plus'],
]) {
  const module = await import(`../../src/${tool}.lib.mjs`);
  adapters[tool] = { execute: module[`execute${suffix}Command`], validate: module[`validate${suffix}Connection`], model };
}

function fixture(t, tool, scenario, argvSelection) {
  const home = fs.mkdtempSync(path.join(root, `${tool}-`));
  const cwd = path.join(home, 'workspace');
  fs.mkdirSync(cwd);
  const env = { ...buildRouterTaskEnv({ tool, baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir: home, dialect: ROUTER_ROUTE_DIALECTS.canonical }), HOME: home, XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'), HIVE_MIND_STATE_DIR: path.join(home, 'state'), HIVE_MIND_USE_ROUTER: argvSelection ? '0' : '1', HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS: '100' };
  const key = ['claude', 'agent'].includes(tool) ? 'ANTHROPIC_API_KEY' : tool === 'gemini' ? 'GEMINI_API_KEY' : 'OPENAI_API_KEY';
  const endpoint = ['claude', 'agent'].includes(tool) ? 'ANTHROPIC_BASE_URL' : tool === 'gemini' ? 'GOOGLE_GEMINI_BASE_URL' : 'OPENAI_BASE_URL';
  if (scenario === 'changed key') env[key] = 'SYNTHETIC-UNRELATED-VENDOR-KEY';
  if (scenario === 'missing key') env[key] = '';
  if (scenario === 'changed endpoint') env[endpoint] = 'https://vendor.invalid';
  if (scenario === 'missing token') env.HIVE_MIND_ROUTER_TOKEN = '';
  assert.equal(inspectRouterTaskEnvironment({ tool, env }).length > 0, !(['clean', 'key changed after version'].includes(scenario) || scenario.startsWith('runtime file')), 'the factory fixture itself must select a valid route and token');
  for (const [name, value] of Object.entries(env)) {
    const before = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (before === undefined) delete process.env[name];
      else process.env[name] = before;
    });
  }
  return { cwd, key };
}

async function assertSecurityStop(invoke, calls, expectedCalls = 0) {
  let violation;
  try {
    violation = (await invoke())?.routerAuthViolation;
  } catch (error) {
    assert.equal(error.code, 'ROUTER_AUTH_VIOLATION');
    violation = error.routerAuthViolation;
  }
  assert.equal(calls.length, expectedCalls, 'Router refusal must precede command creation and ordinary retry');
  assert.ok(violation, 'retain the typed security violation for exit 77');
}

for (const [tool, adapter] of Object.entries(adapters)) {
  for (const resume of [false, true])
    for (const argvSelection of [false, true])
      for (const scenario of ['clean', 'changed key', 'missing key', 'changed endpoint', 'missing token', 'runtime file', 'runtime file with stream failure', 'runtime file with consumer failure', ...(!resume && !argvSelection ? ['runtime file waiting'] : [])]) {
        test(`Router direct ${tool} ${resume ? 'resume' : 'new'} ${argvSelection ? 'argv' : 'env'}: ${scenario}`, { timeout: 10_000 }, async t => {
          const { cwd } = fixture(t, tool, scenario, argvSelection);
          const calls = [];
          let runtimeFileWritten = false;
          const fakeDollar =
            options =>
            (strings, ...values) => {
              calls.push({ options, command: strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '') });
              assert.equal(calls.length, 1, 'one bounded native launch');
              const start = tool === 'agent' || tool === 'opencode' ? { type: 'init', sessionID: 'synthetic-session' } : tool === 'gemini' ? { type: 'init', session_id: 'synthetic-session' } : { type: 'system', subtype: 'init', session_id: 'synthetic-session' };
              const done = tool === 'agent' || tool === 'opencode' ? { type: 'step_finish', part: { reason: 'stop' } } : tool === 'gemini' ? { type: 'result', status: 'success' } : { type: 'result', subtype: 'success', is_error: false, result: 'Done.', num_turns: 2 };
              let stop;
              const stopped = new Promise(resolve => {
                stop = resolve;
              });
              return {
                result: { code: 0 },
                kill() {
                  stop();
                },
                async *stream() {
                  yield { type: 'stdout', data: Buffer.from(JSON.stringify(start) + '\n') };
                  if (scenario.startsWith('runtime file')) {
                    fs.writeFileSync(path.join(path.dirname(cwd), '.git-credentials'), 'synthetic forbidden credential');
                    runtimeFileWritten = true;
                  }
                  if (scenario === 'runtime file with stream failure') throw new Error('synthetic stream failure');
                  if (scenario === 'runtime file waiting') {
                    let timer;
                    try {
                      await Promise.race([
                        stopped,
                        new Promise((_, reject) => {
                          timer = setTimeout(() => reject(new Error('finite mocked native stop deadline exceeded')), 1000);
                        }),
                      ]);
                    } finally {
                      clearTimeout(timer);
                    }
                  }
                  yield { type: 'stdout', data: Buffer.from(JSON.stringify(done) + '\n') };
                  yield { type: 'exit', code: 0 };
                },
              };
            };
          const invoke = () =>
            adapter.execute({
              tempDir: cwd,
              branchName: 'issue-3785-test',
              prompt: 'Synthetic request.',
              systemPrompt: 'Synthetic system.',
              argv: { tool, model: adapter.model, attribution: 'none', agentMemoryDisabled: false, auxiliaryModelCallsDisabled: false, useRouter: argvSelection, ...(resume ? { resume: 'synthetic-session' } : {}) },
              log: async (_text, options) => {
                if (scenario === 'runtime file with consumer failure' && runtimeFileWritten && options?.stream === 'stdout') throw new Error('synthetic consumer failure');
              },
              formatAligned: (_icon, label, value = '') => `${label} ${value}`,
              getResourceSnapshot: async () => ({ memory: 'Mem:\n available', load: '0.00' }),
              [`${tool}Path`]: tool,
              $: fakeDollar,
              calculatePricing: async () => ({ totalCostUSD: null }),
              waitForRetryDelay: async () => assert.fail('a security violation must not retry'),
            });
          if (scenario === 'clean') {
            assert.equal((await invoke()).success, true);
            assert.equal(calls.length, 1);
            if (tool === 'qwen') assert.match(calls[0].command, /^sh -c /, 'Router cannot load a login profile that replaces its credential');
          } else await assertSecurityStop(invoke, calls, scenario.startsWith('runtime file') ? 1 : 0);
        });
      }

  for (const argvSelection of [false, true])
    for (const scenario of ['clean', 'changed key', 'missing key', 'changed endpoint', 'missing token', 'key changed after version']) {
      test(`Router direct ${tool} connection ${argvSelection ? 'argv' : 'env'}: ${scenario}`, { timeout: 10_000 }, async t => {
        const { key } = fixture(t, tool, scenario, argvSelection);
        const calls = [];
        nativeCommand = command => {
          calls.push(command);
          assert.ok(calls.length <= 2, 'no unexpected fallback or retry');
          if (scenario === 'key changed after version') process.env[key] = 'SYNTHETIC-UNRELATED-VENDOR-KEY';
          return { code: 0, stdout: command.includes('--version') ? '99.0.0' : '', stderr: '' };
        };
        const options = { useRouter: argvSelection };
        const invoke = () => (tool === 'qwen' ? adapter.validate(adapter.model, 'qwen', options) : adapter.validate(adapter.model, options));
        if (scenario === 'clean') {
          assert.equal(await invoke(), true);
          assert.equal(calls.length, 2);
        } else await assertSecurityStop(invoke, calls, scenario === 'key changed after version' ? 1 : 0);
      });
    }

  test(`Router ${tool} shared connection dispatch retains argv selection`, { timeout: 10_000 }, async t => {
    fixture(t, tool, 'changed key', true);
    const calls = [];
    nativeCommand = command => {
      calls.push(command);
      assert.ok(calls.length <= 2);
      return { code: 0, stdout: command.includes('--version') ? '99.0.0' : '', stderr: '' };
    };
    await assertSecurityStop(() => validateToolConnection({ tool, model: adapter.model, useRouter: true, log: async () => {} }), calls);
  });
}

test('Hive startup forwards explicit Router selection to connection admission', { timeout: 10_000 }, async () => {
  let selection;
  await runStartupChecks({
    argv: { tool: 'agent', model: 'sonnet', useRouter: true },
    log: async () => {},
    safeExit: async () => assert.fail('healthy startup must proceed'),
    ensureDiskSpaceForWorker: async () => ({ ok: true }),
    checkSystem: async () => ({ success: true }),
    validateToolConnection: async options => {
      selection = options.useRouter;
      return true;
    },
  });
  assert.equal(selection, true);
});

test('Hive startup preserves security exit 77 without ordinary failure recovery', { timeout: 10_000 }, async () => {
  const exits = [];
  const error = Object.assign(new Error('synthetic refused task'), { code: 'ROUTER_AUTH_VIOLATION', routerAuthViolation: { violations: [{ path: '(router task environment)', reason: 'synthetic task refusal' }] } });
  const result = await runStartupChecks({
    argv: { tool: 'agent', model: 'sonnet', useRouter: true },
    log: async () => {},
    safeExit: async (...args) => exits.push(args),
    ensureDiskSpaceForWorker: async () => ({ ok: true }),
    checkSystem: async () => ({ success: true }),
    validateToolConnection: async () => {
      throw error;
    },
  });
  assert.equal(result.stopped, 'router_auth_violation');
  assert.equal(exits.length, 1);
  assert.equal(exits[0][0], 77);
  assert.equal(exits[0][2].skipPreExit, true);
});

for (const tool of ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen']) {
  test(`Router ${tool} Formal AI availability dispatch still checks task admission`, { timeout: 10_000 }, async t => {
    fixture(t, tool, 'changed key', true);
    const calls = [];
    await assertSecurityStop(
      () =>
        validateToolConnection({
          tool,
          model: 'formal-ai',
          useRouter: true,
          log: async () => {},
          validateFormalAiToolConnection: async () => {
            calls.push('formal registry');
            return { valid: true };
          },
        }),
      calls
    );
  });
}

for (const tool of ['claude', 'codex']) {
  test(`Router ${tool} shared connection dispatch retains argv selection`, { timeout: 10_000 }, async t => {
    fixture(t, tool, 'changed key', true);
    const calls = [];
    nativeCommand = command => {
      calls.push(command);
      assert.ok(calls.length <= 2);
      return { code: 0, stdout: '', stderr: '' };
    };
    await assertSecurityStop(() => validateToolConnection({ tool, model: 'sonnet', useRouter: true, log: async () => {} }), calls);
  });
}
