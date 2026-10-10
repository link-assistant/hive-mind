#!/usr/bin/env node

/**
 * Regression test for issue #2314: `gh` was unauthenticated inside the Formal AI
 * agent session.
 *
 * Scala run (2026-09-27, `--tool agent --model formal-ai`): the tool env set
 * `XDG_CONFIG_HOME=<task home>/.config` so the Agent CLI would read the generated
 * `opencode.json`. `gh` resolves `$XDG_CONFIG_HOME/gh/hosts.yml`, so the first
 * `gh issue view` printed "To get started with GitHub CLI, please run: gh auth
 * login" and the model returned `planned_not_executed`.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2314
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildFormalAiEnvExports } from '../src/formal-ai.lib.mjs';
import { buildFormalAiClientEnv, prepareFormalAiRuntime, resetFormalAiRuntimeCache } from '../src/formal-ai-runtime.lib.mjs';
import { assertGhAuthenticatedInToolEnv, prepareToolGhAuth, resolveGhAuthEnv, resolveGhConfigDir } from '../src/tool-env-gh-auth.lib.mjs';

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

const operatorEnv = { HOME: '/home/box', PATH: '/usr/bin' };
const TOKEN = 'gho_example_token_value';

/**
 * A fake `gh` that authenticates exactly like the real one: from `GH_TOKEN`, or
 * from `hosts.yml` in the directory `resolveGhConfigDir` names, which only the
 * operator's `/home/box/.config/gh` has.
 */
const createFakeGh = () => {
  const calls = [];
  const authenticated = env => !!env.GH_TOKEN || resolveGhConfigDir(env, '/nonexistent') === '/home/box/.config/gh';
  const run = async (file, args, { env }) => {
    calls.push({ file, args, env });
    const command = args.join(' ');
    if (!authenticated(env)) {
      throw Object.assign(new Error('exit 1'), { stderr: 'To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.' });
    }
    if (command === 'auth token') return { stdout: env.GH_TOKEN || `${TOKEN}\n` };
    if (command === 'auth status' || command === 'api user') return { stdout: 'Logged in to github.com account konard' };
    throw new Error(`unexpected gh ${command}`);
  };
  return { run, calls };
};

const agentClient = { id: 'agent', global_configs: [{ format: 'json', path: '.config/link-assistant-agent/opencode.json' }] };

console.log('Issue #2314: the Formal AI tool env keeps gh authenticated\n');

await test('buildFormalAiClientEnv for the agent client does not change where gh looks for its config', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hive-2314-'));
  try {
    const { env, notes } = await buildFormalAiClientEnv({ client: agentClient, home, apiKey: 'k' });
    const toolEnv = { ...operatorEnv, ...env };
    assert.equal(resolveGhConfigDir(toolEnv), resolveGhConfigDir(operatorEnv));
    assert.equal(env.LINK_ASSISTANT_AGENT_CONFIG_DIR, join(home, '.config', 'link-assistant-agent'));
    assert.ok(!notes.some(note => note.startsWith('XDG_CONFIG_HOME')));
    // `gh api user` with that env succeeds.
    const gh = createFakeGh();
    await gh.run('gh', ['api', 'user'], { env: toolEnv });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

await test('the Scala env (XDG_CONFIG_HOME relocated) is unauthenticated without the fix, authenticated with it', async () => {
  const gh = createFakeGh();
  const scalaEnv = { ...operatorEnv, XDG_CONFIG_HOME: '/tmp/formal-ai-home/agent-x/.config' };
  await assert.rejects(gh.run('gh', ['issue', 'view'], { env: scalaEnv }), error => /gh auth login/.test(error.stderr));
  const ghEnv = await resolveGhAuthEnv({ env: operatorEnv, run: gh.run });
  assert.deepEqual(ghEnv, { GH_CONFIG_DIR: '/home/box/.config/gh', GH_TOKEN: TOKEN });
  await gh.run('gh', ['api', 'user'], { env: { ...scalaEnv, ...ghEnv } });
});

await test('an existing GH_TOKEN is kept, and GH_CONFIG_DIR wins over XDG_CONFIG_HOME', async () => {
  const gh = createFakeGh();
  const ghEnv = await resolveGhAuthEnv({ env: { ...operatorEnv, GH_TOKEN: 'ghp_router', GH_CONFIG_DIR: '/etc/gh' }, run: gh.run });
  assert.deepEqual(ghEnv, { GH_CONFIG_DIR: '/etc/gh', GH_TOKEN: 'ghp_router' });
  assert.equal(gh.calls.length, 0, 'no gh auth token call when a token is already exported');
  assert.equal(resolveGhConfigDir({ HOME: '/h', XDG_CONFIG_HOME: '/x' }), '/x/gh');
});

await test('the preflight runs gh auth status with the exact tool env and fails fast with a clear message', async () => {
  const gh = createFakeGh();
  const toolEnv = { ...operatorEnv, XDG_CONFIG_HOME: '/tmp/relocated' };
  await assert.rejects(assertGhAuthenticatedInToolEnv({ toolEnv, tool: 'agent', run: gh.run }), error => {
    assert.match(error.message, /gh is not authenticated in the environment agent will run with/);
    assert.match(error.message, /gh auth login/);
    return true;
  });
  assert.deepEqual(gh.calls.at(-1).args, ['auth', 'status']);
  // Only presence is reported; the values themselves never reach the message.
  const rejectingGh = async () => {
    throw Object.assign(new Error('Command failed: gh auth status'), { stderr: 'The token in GH_TOKEN is invalid.' });
  };
  await assert.rejects(assertGhAuthenticatedInToolEnv({ toolEnv: { ...operatorEnv, GH_CONFIG_DIR: '/srv/operator/gh', GH_TOKEN: TOKEN }, tool: 'agent', run: rejectingGh }), error => {
    assert.match(error.message, /GH_CONFIG_DIR set, GH_TOKEN set/);
    assert.doesNotMatch(error.message, /\/srv\/operator\/gh|gho_example_token_value/);
    return true;
  });
  assert.equal(gh.calls.at(-1).env, toolEnv);

  const ghEnv = await prepareToolGhAuth({ env: operatorEnv, toolEnv, tool: 'agent', run: gh.run });
  const status = gh.calls.at(-1);
  assert.deepEqual(status.args, ['auth', 'status']);
  assert.deepEqual(status.env, { ...operatorEnv, ...toolEnv, ...ghEnv }, 'checked with the env the tool gets');
});

await test('prepareFormalAiRuntime merges the gh variables into the tool env, or rejects it before the session', async () => {
  const home = await mkdtemp(join(tmpdir(), 'hive-2314-runtime-'));
  const gh = createFakeGh();
  const deps = {
    readVersionImpl: async () => '0.336.0',
    mkdtempImpl: async () => home,
    startServerImpl: async () => ({ baseUrl: 'http://127.0.0.1:41235', port: 41235, pid: 1, stop: async () => {} }),
    probeBackendImpl: async () => ({ ok: true, kind: 'ok', status: 200, version: '0.336.0', memory: { compatible: true }, health: { version: '0.336.0' }, error: null }),
    loadRegistryImpl: async () => [agentClient],
    seedImpl: async () => [],
    configureImpl: async () => {},
  };
  try {
    resetFormalAiRuntimeCache();
    const runtime = await prepareFormalAiRuntime({ tool: 'agent', workdir: '/tmp/workspace', env: operatorEnv, formalAiPath: '/opt/formal-ai', deps: { ...deps, ghAuthImpl: params => prepareToolGhAuth({ ...params, run: gh.run }) } });
    assert.equal(runtime.env.GH_TOKEN, TOKEN);
    assert.equal(runtime.env.GH_CONFIG_DIR, '/home/box/.config/gh');
    assert.ok(!('XDG_CONFIG_HOME' in runtime.env));
    await runtime.stop();

    resetFormalAiRuntimeCache();
    const unauthenticated = async () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'You are not logged into any GitHub hosts.' });
    };
    await assert.rejects(prepareFormalAiRuntime({ tool: 'agent', workdir: '/tmp/workspace', env: operatorEnv, formalAiPath: '/opt/formal-ai', deps: { ...deps, mkdtempImpl: () => mkdtemp(join(tmpdir(), 'hive-2314-runtime-')), ghAuthImpl: params => prepareToolGhAuth({ ...params, run: unauthenticated }) } }), /gh is not authenticated in the environment agent will run with/);
  } finally {
    resetFormalAiRuntimeCache();
    await rm(home, { recursive: true, force: true });
  }
});

await test('the token never reaches the logged command line (codex/qwen env exports)', () => {
  const exports = buildFormalAiEnvExports({ CODEX_HOME: '/tmp/h/.codex', GH_CONFIG_DIR: '/home/box/.config/gh', GH_TOKEN: TOKEN, GITHUB_TOKEN: TOKEN });
  assert.doesNotMatch(exports, new RegExp(TOKEN));
  assert.match(exports, /export CODEX_HOME=/);
  assert.match(exports, /export GH_CONFIG_DIR=/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
