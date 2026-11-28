/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { prepareClaudeTaskHome } from '../src/claude-task-home.lib.mjs';
import { buildDockerIsolationStartArgs, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { resolveClaudeSessionToolFlags } from '../src/useless-tools.lib.mjs';

async function fixture(t) {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-4173-tool-data-'));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  return homeDir;
}

test('Claude task homes persist conversations with independent settings, skills and MCP registrations', async t => {
  const homeDir = await fixture(t);
  const root = path.join(homeDir, '.claude');
  await fs.mkdir(path.join(root, 'skills', 'root-only'), { recursive: true });
  const rootPreferences = { language: 'English', promptCacheTtl: '5m' };
  const rootSettings = { ...rootPreferences, enabledPlugins: { 'example@root-only': true }, hooks: { Stop: [] } };
  await fs.writeFile(path.join(root, 'settings.json'), JSON.stringify(rootSettings));
  const first = await prepareClaudeTaskHome({ homeDir, env: {}, tempDir: homeDir });
  const second = await prepareClaudeTaskHome({ homeDir, env: {}, tempDir: homeDir, enablePlaywright: false });
  assert.equal(first.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, root);
  assert.equal(second.env.CLAUDE_SECURESTORAGE_CONFIG_DIR, root);
  assert.notEqual(first.env.CLAUDE_CONFIG_DIR, second.env.CLAUDE_CONFIG_DIR);
  assert.deepEqual(JSON.parse(await fs.readFile(first.settingsPath, 'utf8')), rootPreferences);
  await fs.mkdir(path.join(first.env.CLAUDE_CONFIG_DIR, 'skills', 'task-only'), { recursive: true });
  await fs.writeFile(first.settingsPath, '{"custom":true}');
  await fs.writeFile(path.join(first.env.CLAUDE_CONFIG_DIR, 'projects', 'conversation.jsonl'), 'persisted');
  await assert.rejects(fs.access(path.join(first.env.CLAUDE_CONFIG_DIR, 'skills', 'root-only')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(second.env.CLAUDE_CONFIG_DIR, 'skills')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, 'skills', 'task-only')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await fs.readFile(second.settingsPath, 'utf8')), rootPreferences);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'settings.json'), 'utf8')), rootSettings);

  for (const [scope, argv, expected] of [
    [first, { uselessToolsDisabled: false }, ['playwright']],
    [second, { uselessToolsDisabled: false, playwrightMcp: false }, []],
  ]) {
    const flags = await resolveClaudeSessionToolFlags({ argv, mcpStatePath: scope.mcpStatePath });
    const { mcpServers } = JSON.parse(await fs.readFile(flags.mcpConfigPath, 'utf8'));
    assert.deepEqual(Object.keys(mcpServers), expected);
  }
  await first.dispose();
  assert.equal(await fs.readFile(path.join(second.env.CLAUDE_CONFIG_DIR, 'projects', 'conversation.jsonl'), 'utf8'), 'persisted');
  assert.equal(await fs.readFile(path.join(root, 'projects', 'conversation.jsonl'), 'utf8'), 'persisted');
});

test('Gemini Docker preparation selects host-backed history without a configuration or credential mount', async t => {
  const homeDir = await fixture(t);
  const options = { tool: 'gemini', homeDir, env: {}, sessionId: 'gemini-history' };
  const prepared = await prepareDockerIsolationHostPaths(options);
  const source = path.join(homeDir, '.hive-mind/canonical/gemini-history');
  const target = '/home/box/.hive-mind/canonical/gemini-history';
  assert.deepEqual(prepared.created, [source]);
  assert.deepEqual(options.env, {});
  const args = await buildDockerIsolationStartArgs('solve', [], { ...options, env: prepared.storageEnv, nativeAuthIdentity: prepared.nativeAuthIdentity });
  assert.ok(args.includes(`${source}:${target}`));
  assert.ok(args.includes(`GEMINI_HISTORY_HOME=${target}`));
  assert.ok(args.some(arg => arg.startsWith('HIVE_MIND_GEMINI_HISTORY_IDENTITY=')));
  assert.equal(args.filter(arg => arg === '--volume').length, 1);
});

test('Qwen Docker launches persist runtime output without loading another launch’s generated workflows', async t => {
  const homeDir = await fixture(t);
  const options = { tool: 'qwen', homeDir, env: {}, sessionId: 'reused-task-name' };
  const first = await prepareDockerIsolationHostPaths(options);
  const second = await prepareDockerIsolationHostPaths(options);
  const { source, target } = first.taskData.mount;
  assert.notEqual(source, second.taskData.mount.source);
  assert.equal(target, second.taskData.mount.target);
  await fs.mkdir(path.join(source, 'projects', 'example', 'workflows', 'generated'), { recursive: true });
  await fs.writeFile(path.join(source, 'projects', 'example', 'workflows', 'generated', 'first.js'), 'first task artifact');
  await assert.rejects(fs.access(path.join(second.taskData.mount.source, 'projects')), { code: 'ENOENT' });
  const args = await buildDockerIsolationStartArgs('solve', [], { ...options, taskData: first.taskData });
  assert.ok(args.includes(`${source}:${target}`));
  assert.ok(args.includes(`QWEN_RUNTIME_DIR=${target}`));
  assert.equal(args.filter(arg => arg === '--volume').length, 1);
});
