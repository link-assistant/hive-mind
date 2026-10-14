#!/usr/bin/env node
/**
 * Issue #3248 items 4 and 7: Formal AI's own state is not user work.
 *
 * Formal AI 0.353.1 writes `data/cache/derivations/answer_*.lino` into the
 * directory its server runs in (link-assistant/formal-ai#1208). Critical-error
 * recovery then pushed ten `recovery/issue-…` branches holding nothing else,
 * and `--auto-restart-on-uncommitted-changes` restarted the model five times
 * over the same files.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ensureAiToolScratchIgnored, filterAiToolScratchFromStatus, isAiToolScratchPath } from '../src/ai-tool-scratch.lib.mjs';
import { classifyUntrackedFiles, describePreservedWork } from '../src/critical-error-commit.lib.mjs';
import { prepareFormalAiRuntime, resetFormalAiRuntimeCache } from '../src/formal-ai-runtime.lib.mjs';

test('Formal AI derivations are tool state for the uncommitted-changes check', () => {
  assert.equal(isAiToolScratchPath('?? data/cache/derivations/'), true);
  assert.equal(isAiToolScratchPath('?? data/cache/derivations/answer_1.lino'), true);
  assert.equal(isAiToolScratchPath('?? .formal-ai/plan.lino'), true);
  assert.equal(isAiToolScratchPath('?? data/cache/other.json'), false, 'only the directory Formal AI owns is excluded');
  assert.equal(isAiToolScratchPath(' M data/case-studies/x.md'), false, 'a repository that tracks data/ keeps its changes');
  assert.equal(filterAiToolScratchFromStatus('?? data/cache/derivations/\n?? e.g\n'), '?? e.g');
});

test('the clone ignores derivations, so git itself stops reporting them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-3248-scratch-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    await ensureAiToolScratchIgnored(dir);
    const exclude = await readFile(join(dir, '.git', 'info', 'exclude'), 'utf8');
    assert.match(exclude, /^data\/cache\/derivations\/$/m);
    await mkdir(join(dir, 'data', 'cache', 'derivations'), { recursive: true });
    await writeFile(join(dir, 'data', 'cache', 'derivations', 'answer_1.lino'), 'x\n');
    await writeFile(join(dir, 'e.g'), 'garbage\n');
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    assert.equal(status.trim(), '?? e.g', 'only the file the model wrote is reported');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('critical-error preservation skips tool state the way it skips build output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hive-3248-preserve-'));
  try {
    await mkdir(join(dir, 'data', 'cache', 'derivations'), { recursive: true });
    await mkdir(join(dir, '.formal-ai'), { recursive: true });
    await writeFile(join(dir, 'data', 'cache', 'derivations', 'answer_1.lino'), 'x\n');
    await writeFile(join(dir, '.formal-ai', 'plan.lino'), 'x\n');
    await writeFile(join(dir, 'fix.js'), 'export {};\n');
    const { keep, skipped } = await classifyUntrackedFiles(dir, ['data/cache/derivations/answer_1.lino', '.formal-ai/plan.lino', 'fix.js']);
    assert.deepEqual(keep, ['fix.js']);
    assert.deepEqual(skipped, ['data/cache/derivations/answer_1.lino', '.formal-ai/plan.lino']);
    assert.match(describePreservedWork({ committed: false, skipped }), /AI tool state/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the task-owned formal-ai serve keeps its cache in the session home, not in the repository', async () => {
  resetFormalAiRuntimeCache();
  const home = await mkdtemp(join(tmpdir(), 'hive-3248-home-'));
  const started = [];
  const runtime = await prepareFormalAiRuntime({
    tool: 'agent',
    workdir: '/tmp/workspace',
    env: {},
    formalAiPath: '/opt/formal-ai',
    deps: {
      readVersionImpl: async () => '0.353.1',
      mkdtempImpl: async () => home,
      startServerImpl: async options => {
        started.push(options);
        return { baseUrl: 'http://127.0.0.1:41235', port: 41235, pid: 1, stop: async () => {} };
      },
      probeBackendImpl: async () => ({ ok: true, kind: 'ok', status: 200, version: '0.353.1', memory: { compatible: true }, health: { version: '0.353.1' }, error: null }),
      loadRegistryImpl: async () => [{ tool: 'agent', env: {} }],
      seedImpl: async () => [],
      configureImpl: async () => {},
      ghAuthImpl: async () => ({}),
    },
  }).catch(error => ({ error }));
  try {
    assert.equal(started.length, 1, runtime?.error?.message);
    assert.equal(started[0].env.FORMAL_AI_CACHE_DIR, join(home, 'cache'));
    assert.equal(started[0].cwd, '/tmp/workspace', 'tool-call paths are absolutized against the server cwd, so it stays the clone');
  } finally {
    await runtime?.stop?.();
    resetFormalAiRuntimeCache();
    await rm(home, { recursive: true, force: true });
  }
});

test('an operator-set FORMAL_AI_CACHE_DIR is kept', async () => {
  resetFormalAiRuntimeCache();
  const home = await mkdtemp(join(tmpdir(), 'hive-3248-home-'));
  const started = [];
  const runtime = await prepareFormalAiRuntime({
    tool: 'agent',
    workdir: '/tmp/workspace',
    env: { FORMAL_AI_CACHE_DIR: '/srv/formal-ai-cache' },
    formalAiPath: '/opt/formal-ai',
    deps: {
      readVersionImpl: async () => '0.353.1',
      mkdtempImpl: async () => home,
      startServerImpl: async options => {
        started.push(options);
        return { baseUrl: 'http://127.0.0.1:41235', port: 41235, pid: 1, stop: async () => {} };
      },
      probeBackendImpl: async () => ({ ok: true, kind: 'ok', status: 200, version: '0.353.1', memory: { compatible: true }, health: { version: '0.353.1' }, error: null }),
      loadRegistryImpl: async () => [{ tool: 'agent', env: {} }],
      seedImpl: async () => [],
      configureImpl: async () => {},
      ghAuthImpl: async () => ({}),
    },
  }).catch(error => ({ error }));
  try {
    assert.equal(started[0]?.env?.FORMAL_AI_CACHE_DIR, '/srv/formal-ai-cache', runtime?.error?.message);
  } finally {
    await runtime?.stop?.();
    resetFormalAiRuntimeCache();
    await rm(home, { recursive: true, force: true });
  }
});
