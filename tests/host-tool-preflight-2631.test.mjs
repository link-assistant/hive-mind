/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { getHostAuthenticationBlock, parseHostToolOptions, preflightHostTool } from '../src/host-tool-preflight.lib.mjs';
import { executeWithIsolation } from '../src/isolation-runner.lib.mjs';
import { resolveRuntimeCodexReasoningEffort } from '../src/codex.reasoning.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';

test('authentication preflight rejects before start-command or Docker is consulted', { timeout: 10000 }, async () => {
  const originalPath = process.env.PATH;
  process.env.PATH = '/nonexistent';
  try {
    const result = await executeWithIsolation('solve', ['https://github.com/o/r/issues/1'], { backend: 'docker', hostPreflight: async () => ({ success: false, failureKind: 'auth', error: 'operator re-login required' }) });
    assert.equal(result.error, 'operator re-login required');
    assert.equal(result.failureKind, 'auth');
  } finally {
    process.env.PATH = originalPath;
  }
});

test('expired host OAuth is retried once, then pauses only its tool until credentials change', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-host-2631-'));
  const path = join(root, 'auth.json');
  try {
    await writeFile(path, '{}');
    let probes = 0;
    let refreshes = 0;
    const result = await preflightHostTool(
      ['--tool=codex', '--model', 'gpt-6.1-sol'],
      { env: { CODEX_HOME: root } },
      {
        resolveReasoning: async () => ({ reasoningEffort: 'low' }),
        fetchLimits: async () => {
          probes++;
          return { success: false, failureKind: 'auth' };
        },
        refresh: async () => {
          refreshes++;
        },
      }
    );
    assert.equal(result.success, false);
    assert.equal(probes, 2);
    assert.equal(refreshes, 1);
    assert.match(await getHostAuthenticationBlock('codex'), /queue is paused/);
    assert.equal(await getHostAuthenticationBlock('claude'), null);
    const queue = new SolveQueue({ autoStart: false, getRunningProcesses: () => assert.fail('blocked tasks must not start resource or launch probes') });
    for (let index = 0; index < 3; index++) assert.equal((await queue.canStartCommand({ tool: 'codex' })).canStart, false);
    await writeFile(path, '{"auth_mode":"chatgpt"}');
    assert.equal(await getHostAuthenticationBlock('codex'), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('credentials refreshed by another worker are accepted on the second host read', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-host-refresh-2631-'));
  try {
    await mkdir(join(root, '.claude'));
    await writeFile(join(root, '.claude', '.credentials.json'), '{}');
    let probes = 0;
    const result = await preflightHostTool([], { env: {}, homeDir: root }, { fetchLimits: async () => ({ success: ++probes === 2, failureKind: probes === 1 ? 'auth' : null }), refresh: async () => {} });
    assert.equal(result.success, true);
    assert.equal(probes, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('router, Formal AI and API-key tasks bypass the subscription usage probe', async () => {
  const dependencies = { fetchLimits: () => assert.fail('must not contact a vendor subscription endpoint'), resolveReasoning: async () => ({ reasoningEffort: 'low' }) };
  for (const [args, env] of [
    [['--use-router'], {}],
    [['--model=formal-ai'], {}],
    [['--tool=codex'], { OPENAI_API_KEY: 'placeholder' }],
  ])
    assert.equal((await preflightHostTool(args, { env }, dependencies)).success, true);
  assert.equal(parseHostToolOptions(['--model=gpt-6.1-sol', '--think', 'off', '--tool', 'codex']).think, 'off');
});

test('host reasoning uses supported GPT-6.1 effort before inspecting credentials', async () => {
  let validated = false;
  const dependencies = {
    resolveReasoning: async parsed => {
      const result = await resolveRuntimeCodexReasoningEffort(parsed, { getCatalogue: async () => null });
      assert.equal(result.reasoningEffort, 'low');
      validated = true;
      return result;
    },
  };
  assert.equal((await preflightHostTool(['--tool', 'codex', '--model', 'gpt-6.1-sol', '--think=off'], { env: { OPENAI_API_KEY: 'placeholder' } }, dependencies)).success, true);
  assert.equal(validated, true);
  const incompatible = await preflightHostTool(
    ['--tool', 'codex'],
    { env: {} },
    {
      resolveReasoning: async () => {
        throw new Error('unsupported effort');
      },
      readFile: () => assert.fail('configuration must fail before credentials'),
    }
  );
  assert.equal(incompatible.failureKind, 'model_configuration');
});

test('concurrent probes share one request and an outage does not pause the tool', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'hive-host-outage-2631-'));
  try {
    await writeFile(join(root, 'auth.json'), '{}');
    let probes = 0;
    let release;
    const ready = new Promise(resolve => {
      release = resolve;
    });
    const dependencies = {
      resolveReasoning: async () => ({}),
      readFile: async () => '{}',
      fetchLimits: async () => {
        probes++;
        await ready;
        throw new Error('usage endpoint unavailable');
      },
    };
    const checks = Array.from({ length: 3 }, () => preflightHostTool(['--tool=codex'], { env: { CODEX_HOME: root } }, dependencies));
    // Resolved reads let every caller join while the shared probe is held.
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    release();
    const results = await Promise.all(checks);
    assert.equal(probes, 1);
    assert.ok(results.every(result => result.success && result.advisory === 'usage endpoint unavailable'));
    assert.equal(await getHostAuthenticationBlock('codex'), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
