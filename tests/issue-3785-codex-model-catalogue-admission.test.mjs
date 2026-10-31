// @hive-mind-test-suite default
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fetchCodexCliCatalogue } from '../src/model-catalogue-fetch.lib.mjs';
import { buildDefaultCatalogueFetchers, loadModelCatalogue } from '../src/model-catalogue.lib.mjs';
import { resolveRuntimeCodexReasoningEffort } from '../src/codex.reasoning.lib.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-catalogue-admission-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const marker = path.join(root, 'unverified-executed');
  const binary = path.join(root, 'codex');
  await fs.writeFile(binary, `#!/bin/sh\n: > '${marker}'\nprintf '%s' "$CATALOGUE_FIXTURE"\n`, { mode: 0o700 });
  const payload = { models: [{ slug: 'fixture-model', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }] };
  const env = { HOME: root, PATH: '/usr/bin:/bin', CATALOGUE_FIXTURE: JSON.stringify(payload), HIVE_MIND_STATE_DIR: path.join(root, 'state'), HIVE_MIND_MODELS_ROUTER: '0' };
  return { root, marker, binary, payload, env };
}

test('selected model metadata refuses an unverified executable before execution', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const result = await fetchCodexCliCatalogue({ binary: f.binary, env: { ...f.env, CODEX_AUTH_HOME: path.join(f.root, 'canonical') } });
  assert.equal(result.status, 'error');
  assert.match(result.error, /installed native Codex command could not be verified/u);
  await assert.rejects(fs.lstat(f.marker), { code: 'ENOENT' });
});

test('the CLI catalogue reader passes its explicit environment to the child', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  let invocation;
  const result = await fetchCodexCliCatalogue({
    binary: f.binary,
    env: f.env,
    run: async (...args) => {
      invocation = args;
      return { stdout: JSON.stringify(f.payload) };
    },
  });
  assert.equal(result.status, 'ok');
  assert.equal(invocation[0], f.binary);
  assert.deepEqual(invocation[1], ['debug', 'models', '--bundled']);
  assert.equal(invocation[2].env, f.env);
});

test('default catalogue fetchers retain their caller environment and binary', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  let invocation;
  const fetchers = buildDefaultCatalogueFetchers({
    run: async (...args) => {
      invocation = args;
      return { stdout: JSON.stringify(f.payload) };
    },
  });
  await fetchers['codex-cli']({ env: f.env, codexBinary: f.binary });
  assert.equal(invocation[0], f.binary);
  assert.equal(invocation[2].env, f.env);
});

test('catalogue orchestration runs the binary recorded in its cache provenance', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  let invocation;
  const catalogue = await loadModelCatalogue({
    tool: 'codex',
    sourceIds: ['codex-cli'],
    codexBinary: f.binary,
    env: f.env,
    run: async (...args) => {
      invocation = args;
      return { stdout: JSON.stringify(f.payload) };
    },
  });
  assert.equal(catalogue.sources[0].status, 'ok');
  assert.equal(catalogue.sources[0].meta.binary, f.binary);
  assert.equal(invocation[0], f.binary);
  assert.equal(invocation[2].env, f.env);
});

test('runtime effort discovery passes task environment to its actual metadata child', { timeout: 10000 }, async t => {
  const f = await fixture(t);
  const result = await resolveRuntimeCodexReasoningEffort(
    { model: 'fixture-model', think: 'off', codexPath: f.binary },
    {
      env: f.env,
      getCatalogue: async ({ fetchers }) => ({ sources: [{ ...(await fetchers['codex-cli']()), id: 'codex-cli' }] }),
    }
  );
  assert.equal(result.reasoningEffort, 'low');
  assert.equal((await fs.stat(f.marker)).isFile(), true);
});

test('native execution resolves effort metadata inside its capability scope', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const privateHome = path.join(f.root, 'private');
  await fs.mkdir(privateHome, { mode: 0o700 });
  const captured = path.join(f.root, 'metadata-home');
  await fs.writeFile(f.binary, `#!/bin/sh\nprintf '%s' "$CODEX_HOME" > '${captured}'\nprintf '%s' "$CATALOGUE_FIXTURE"\n`);
  const changes = { HIVE_MIND_STATE_DIR: path.join(f.root, 'operator-state'), HIVE_MIND_MODELS_HOT_LOAD: '1', CODEX_HOME: path.join(f.root, 'operator'), CATALOGUE_FIXTURE: JSON.stringify(f.payload) };
  for (const [key, value] of Object.entries(changes)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    });
  }
  const { executeCodexCommand } = await import('../src/codex.lib.mjs');
  const commands = [];
  const dollar =
    options =>
    (strings, ...values) => {
      commands.push({ options, command: strings.reduce((result, part, index) => result + part + (values[index] ?? ''), '') });
      return {
        async *stream() {
          yield { type: 'stdout', data: Buffer.from('{"type":"thread.started","thread_id":"fixture"}\n{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n') };
          yield { type: 'exit', code: 0 };
        },
      };
    };
  const result = await executeCodexCommand({
    tempDir: f.root,
    branchName: 'fixture',
    prompt: 'test',
    systemPrompt: '',
    argv: { model: 'fixture-model', think: 'off', baseBranch: '' },
    log: async () => {},
    formatAligned: () => '',
    getResourceSnapshot: async () => ({ memory: 'Mem:\n available', load: '0.00' }),
    feedbackLines: [],
    codexPath: f.binary,
    $: dollar,
    capabilityPreflight: { codexHome: privateHome, baseCodexHome: f.root, codexBaseEnv: f.env },
    verifyCapabilityExecutionCatalog: async () => ({}),
    calculatePricing: async () => null,
  });
  assert.equal(result.success, true);
  assert.equal(commands.length, 1);
  assert.equal(await fs.readFile(captured, 'utf8'), privateHome);
  assert.equal(commands[0].options.env.CODEX_HOME, privateHome);
  assert.match(commands[0].command, /model_reasoning_effort=low/u);
});
