/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

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
const { validateClaudeConnection } = await import('../src/claude.connection.lib.mjs');
const { validateCodexConnection } = await import('../src/codex.lib.mjs');
const { createUncaughtExceptionHandler, createUnhandledRejectionHandler, handleMainExecutionError } = await import('../src/solve.error-handlers.lib.mjs');

for (const [name, invoke] of [
  ['uncaught exception', (error, options) => createUncaughtExceptionHandler(options)(error)],
  ['unhandled rejection', (error, options) => createUnhandledRejectionHandler(options)(error)],
  ['main execution', (error, options) => handleMainExecutionError({ ...options, error })],
]) {
  test(`Router admission retains security exit 77 through ${name}`, { timeout: 10_000 }, async () => {
    const exits = [];
    const messages = [];
    const error = Object.assign(new Error('synthetic Router admission refusal'), { routerAuthViolation: { tool: 'claude', violations: [{ path: '(router task environment)', reason: 'missing router task token' }] } });
    await invoke(error, {
      log: async message => messages.push(message),
      safeExit: async (...args) => exits.push(args),
      cleanErrorMessage: () => assert.fail('a security violation must not enter ordinary failure recovery'),
    });
    assert.equal(exits.length, 1);
    assert.equal(exits[0][0], 77);
    assert.equal(exits[0][2].skipPreExit, true);
    assert.match(messages.join('\n'), /Security violation/u);
  });
}

for (const tool of ['claude', 'codex']) {
  for (const scenario of ['vendor credentials', 'missing token', 'argv Router selection', 'after version', 'clean']) {
    test(`Router ${tool} connection admission: ${scenario}`, { timeout: 10_000 }, async t => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'router-connection-'));
      t.after(() => fs.rmSync(home, { recursive: true, force: true }));
      const configuration = path.join(home, `.${tool}`);
      fs.mkdirSync(configuration);
      fs.writeFileSync(path.join(configuration, 'config.toml'), 'model_provider = "hive-mind-router"\n[model_providers.hive-mind-router]\nbase_url = "https://router.invalid/v1"\nenv_key = "OPENAI_API_KEY"\n');
      const selected = { HOME: home, CODEX_HOME: configuration, CLAUDE_CONFIG_DIR: configuration, HIVE_MIND_USE_ROUTER: scenario === 'argv Router selection' ? '0' : '1', HIVE_MIND_ROUTER_TOKEN: scenario === 'missing token' ? '' : 'synthetic-router-task', HIVE_MIND_ROUTER_AUTH_GUARD: '0', OPENAI_BASE_URL: 'https://router.invalid/v1', HIVE_MIND_MODELS_HOT_LOAD: '0', HIVE_MIND_STATE_DIR: path.join(home, 'state') };
      for (const [key, value] of Object.entries(selected)) {
        const before = process.env[key];
        process.env[key] = value;
        t.after(() => {
          if (before === undefined) delete process.env[key];
          else process.env[key] = before;
        });
      }
      const contaminate = () => fs.writeFileSync(path.join(configuration, tool === 'claude' ? '.credentials.json' : 'auth.json'), tool === 'claude' ? '{}' : '{"OPENAI_API_KEY":"synthetic-vendor-key"}');
      if (scenario === 'vendor credentials' || scenario === 'argv Router selection') contaminate();
      const commands = [];
      nativeCommand = command => {
        commands.push(command);
        if (scenario === 'after version') contaminate();
        return { code: 0, stdout: 'synthetic-native-ok', stderr: '' };
      };
      const validate = () => (tool === 'claude' ? validateClaudeConnection('claude-opus-4-8', { useRouter: scenario === 'argv Router selection' }) : validateCodexConnection('gpt-5.4', false, { useRouter: scenario === 'argv Router selection' }));
      if (scenario === 'clean') {
        assert.equal(await validate(), true);
        assert.equal(commands.length, 2);
      } else {
        await assert.rejects(validate(), error => error.code === 'ROUTER_AUTH_VIOLATION' && error.routerAuthViolation?.tool === tool);
        assert.equal(commands.length, scenario === 'after version' ? 1 : 0, 'a security stop must not launch a request or fall back');
      }
    });
  }
}

test('Claude connection fallback rechecks Router credentials after a pipe failure', { timeout: 10_000 }, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'router-connection-fallback-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const configuration = path.join(home, '.claude');
  fs.mkdirSync(configuration);
  for (const [key, value] of Object.entries({ HOME: home, CLAUDE_CONFIG_DIR: configuration, HIVE_MIND_USE_ROUTER: '1', HIVE_MIND_ROUTER_TOKEN: 'synthetic-router-task' })) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    });
  }
  const commands = [];
  nativeCommand = command => {
    commands.push(command);
    if (commands.length === 2) {
      fs.writeFileSync(path.join(configuration, '.credentials.json'), '{}');
      throw Object.assign(new Error('synthetic pipe failure'), { code: 'EPIPE' });
    }
    return { code: 0, stdout: 'synthetic-native-ok', stderr: '' };
  };
  await assert.rejects(validateClaudeConnection('claude-opus-4-8'), { code: 'ROUTER_AUTH_VIOLATION' });
  assert.equal(commands.length, 2, 'the timeout fallback must not be created');
});
