/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildAgentCommanderToolOptions } from '../src/agent-commander.lib.mjs';
import { buildClaudeQuietEnv } from '../src/claude-quiet-config.lib.mjs';
import { getClaudeEnv } from '../src/config.lib.mjs';
import { runConfigureClaude, verifyConfigureClaude } from '../src/configure-claude.lib.mjs';
import { buildDockerIsolationStartArgs } from '../src/isolation-runner.lib.mjs';
import { buildOrganizationInvocation } from '../src/organize.ai.lib.mjs';
import { buildStartAgentArgs } from '../src/task.agent-command.lib.mjs';

const mainTtl = 'CLAUDE_CODE_PROMPT_CACHE_TTL';
const subagentTtl = 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL';
const forceFiveMinutes = 'FORCE_PROMPT_CACHING_5M';
const cacheKeys = [mainTtl, subagentTtl, forceFiveMinutes];

function selectCacheEnv(env = {}) {
  return Object.fromEntries(cacheKeys.filter(key => key in env).map(key => [key, env[key]]));
}

function taskCacheEnv(tool) {
  const args = buildStartAgentArgs({ tool, workingDirectory: '/tmp', prompt: 'Ping', systemPrompt: '', model: 'default', isolation: 'process' });
  const env = Object.fromEntries(args.filter((_, index) => args[index - 1] === '--tool-env').map(pair => pair.split('=', 2)));
  return selectCacheEnv(env);
}

function organizationCacheEnv(tool, baseEnv) {
  return selectCacheEnv(buildOrganizationInvocation({ tool, model: 'default', tempDir: '/tmp', baseEnv }).env);
}

test('both cache buckets default to one hour in managed Claude launches', t => {
  for (const key of cacheKeys) {
    const previous = process.env[key];
    delete process.env[key];
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }

  const defaults = { [mainTtl]: '1h', [subagentTtl]: '1h' };
  assert.deepEqual(selectCacheEnv(getClaudeEnv()), defaults);
  assert.deepEqual(selectCacheEnv(buildAgentCommanderToolOptions({}, 'claude').extraEnv), defaults);
  assert.deepEqual(taskCacheEnv('claude'), defaults);
  assert.deepEqual(organizationCacheEnv('claude', {}), defaults);

  process.env[mainTtl] = '5m';
  process.env[forceFiveMinutes] = '1';
  const overrides = { ...defaults, [mainTtl]: '5m' };
  assert.deepEqual(selectCacheEnv(getClaudeEnv()), { ...overrides, [forceFiveMinutes]: '1' });
  assert.deepEqual(selectCacheEnv(buildAgentCommanderToolOptions({}, 'claude').extraEnv), { ...overrides, [forceFiveMinutes]: '1' });
  assert.deepEqual(taskCacheEnv('claude'), { ...overrides, [forceFiveMinutes]: '1' });
  assert.deepEqual(organizationCacheEnv('claude', { [subagentTtl]: '5m' }), { ...defaults, [subagentTtl]: '5m' });
  assert.deepEqual(selectCacheEnv(buildClaudeQuietEnv({ [mainTtl]: 'invalid', [subagentTtl]: '' })), defaults);
  for (const tool of ['codex', 'gemini', 'qwen', 'opencode', 'agent']) {
    assert.deepEqual(selectCacheEnv(buildAgentCommanderToolOptions({}, tool).extraEnv), {});
    assert.deepEqual(taskCacheEnv(tool), {});
    assert.deepEqual(organizationCacheEnv(tool, {}), {});
  }
});

test('configure-claude seeds both buckets and keeps valid native overrides', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-prompt-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const settingsPath = join(directory, 'settings.json');
  const options = { settingsPath, log: async () => {} };
  const readSettings = async () => JSON.parse(await readFile(settingsPath, 'utf8'));

  await runConfigureClaude(options);
  const settings = await readSettings();
  assert.equal(settings.promptCacheTtl, '1h');
  assert.equal(settings.subagentPromptCacheTtl, '1h');
  assert.equal((await verifyConfigureClaude(options)).ok, true);

  await writeFile(settingsPath, JSON.stringify({ ...settings, promptCacheTtl: '5m', subagentPromptCacheTtl: 'invalid', model: 'haiku' }));
  assert.deepEqual((await verifyConfigureClaude(options)).missing.settings, ['subagentPromptCacheTtl']);
  await runConfigureClaude(options);
  const repaired = await readSettings();
  assert.equal(repaired.promptCacheTtl, '5m');
  assert.equal(repaired.subagentPromptCacheTtl, '1h');
  assert.equal(repaired.model, 'haiku');
  assert.equal((await verifyConfigureClaude(options)).ok, true);
  assert.equal((await runConfigureClaude(options)).quietResult.changed, false);
});

test('stock Docker variants pass both defaults to direct Claude invocations', async () => {
  for (const filename of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) {
    const content = await readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    assert.ok(new RegExp(`\\b${mainTtl}=1h\\s`).test(content), `${filename} must set ${mainTtl}`);
    assert.ok(new RegExp(`\\b${subagentTtl}=1h\\s`).test(content), `${filename} must set ${subagentTtl}`);
  }
});

test('isolated Docker tasks pass the selected Claude cache controls', async () => {
  const env = { [mainTtl]: '5m', [forceFiveMinutes]: '1' };
  for (const [tool, expected] of [
    ['claude', { ...env, [subagentTtl]: '1h' }],
    ['codex', {}],
  ]) {
    const args = await buildDockerIsolationStartArgs('solve', [], { tool, env, homeDir: '/synthetic/operator', existsSync: () => true });
    const dockerEnv = Object.fromEntries(args.filter((_, index) => args[index - 1] === '-e').map(pair => pair.split('=', 2)));
    assert.deepEqual(selectCacheEnv(dockerEnv), expected);
  }
});
