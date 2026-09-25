/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2074. Required Codex plugins and skills must
 * be detected before `codex exec`, provisioned in repository-scoped persistent
 * state, and reported with an actionable error when unavailable.
 */

import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexCapabilityPreflightError, applyCodexCapabilityEnv, buildCodexCapabilityStatePath, buildPluginCachePath, detectRequiredCodexCapabilities, normalizePluginSelector, resolveRequiredPlugins, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';
import { getDockerIsolationAuthMounts } from '../src/isolation-runner.lib.mjs';

const issueText = `
This task requires superpowers:using-superpowers before implementation.
Install superpowers@openai-curated-remote if it is absent.
The superpowers:test-driven-development skill is mandatory.
An error example mentions optional@example-marketplace but does not require it.
The required \`pnpm\` command is a dependency, not an Agent Skill.
`;

assert.equal(normalizePluginSelector('superpowers@openai-curated-remote'), 'superpowers@openai-curated');
const detected = detectRequiredCodexCapabilities(issueText);
assert.deepEqual(detected.plugins, ['superpowers@openai-curated']);
assert.deepEqual(detected.skills, ['superpowers:test-driven-development', 'superpowers:using-superpowers']);

const baseHome = '/persistent/.codex';
const statePath = buildCodexCapabilityStatePath({ baseCodexHome: baseHome, owner: 'CEHR2005', repo: 'GCS-TS' });
assert.equal(statePath, '/persistent/.codex/hive-mind/repositories/CEHR2005/GCS-TS');
assert.deepEqual(applyCodexCapabilityEnv({ PATH: '/bin' }, { codexHome: statePath, baseCodexHome: baseHome }), { PATH: '/bin', CODEX_HOME: statePath, HIVE_MIND_PARENT_CODEX_HOME: baseHome }, 'direct codex execution receives the repository-scoped state');

// Issue #2190: a Docker-isolated task never inherits the operator's plugins,
// skills or repository-scoped capability state. Issue #2296: `.codex` itself is
// shared (so a refreshed auth.json reaches every task), with `hive-mind/`,
// `plugins/`, `skills/`, `.tmp/` and `config.toml` overlaid per task.
const mounts = getDockerIsolationAuthMounts({ tool: 'codex', homeDir: '/persistent', sessionId: 'task', existsSync: () => true });
assert.deepEqual(
  mounts.find(mount => mount.source === baseHome),
  { source: baseHome, target: '/home/box/.codex' }
);
assert(!mounts.some(mount => mount.source === '/persistent/.agents'), 'Docker isolation does not propagate the user Agent Skills folder (issue #2190)');
const stateOverlay = mounts.find(mount => mount.target === '/home/box/.codex/hive-mind');
assert(stateOverlay && stateOverlay.source.startsWith('/persistent/.hive-mind/docker-isolation/task/codex/'), 'repository-scoped capability state is overlaid by a per-task directory (issue #2190)');
assert(mounts.indexOf(stateOverlay) > mounts.findIndex(mount => mount.source === baseHome), 'the overlay is mounted after the shared directory it shadows');

const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-capability-preflight-'));
const pluginRoot = path.join(fixtureRoot, 'marketplace', 'plugins', 'superpowers');
await mkdir(path.join(pluginRoot, 'skills', 'using-superpowers'), { recursive: true });
await mkdir(path.join(pluginRoot, 'skills', 'test-driven-development'), { recursive: true });
await writeFile(path.join(pluginRoot, 'skills', 'using-superpowers', 'SKILL.md'), '---\nname: using-superpowers\n---\n');
await writeFile(path.join(pluginRoot, 'skills', 'test-driven-development', 'SKILL.md'), '---\nname: test-driven-development\n---\n');
await writeFile(path.join(pluginRoot, '.codex-plugin.json'), '{}');
const userSkillRoot = path.join(fixtureRoot, '.agents', 'skills');
await mkdir(path.join(userSkillRoot, 'operator-workflow'), { recursive: true });
await writeFile(path.join(userSkillRoot, 'operator-workflow', 'SKILL.md'), '---\nname: operator-workflow\n---\n');

const catalog = {
  installed: [],
  available: [
    {
      pluginId: 'superpowers@openai-curated',
      name: 'superpowers',
      source: { source: 'local', path: pluginRoot },
    },
  ],
};

assert.deepEqual(await resolveRequiredPlugins({ requirements: detectRequiredCodexCapabilities(issueText), catalog }), ['superpowers@openai-curated']);
assert.deepEqual(await resolveRequiredPlugins({ requirements: { plugins: [], skills: ['operator-workflow'] }, catalog, skillDirectories: [userSkillRoot] }), [], 'a standard Agent Skill satisfies the requirement without plugin installation');

const commandCalls = [];
let fakePluginInstalled = false;
const fakeRunCommand = async ({ command, args, env }) => {
  commandCalls.push({ command, args, env });
  if (command === 'gh' && args[2]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
  if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: issueText }), stderr: '', code: 0 };
  if (args[0] === 'plugin' && args[1] === 'list') {
    const response = fakePluginInstalled ? { ...catalog, installed: [{ ...catalog.available[0], installed: true, enabled: true }] } : catalog;
    return { stdout: JSON.stringify(response), stderr: '', code: 0 };
  }
  if (args[0] === 'plugin' && args[1] === 'add') {
    fakePluginInstalled = true;
    const cacheRoot = path.join(buildPluginCachePath({ codexHome: env.CODEX_HOME, pluginId: args[2] }), '1.0.0');
    await cp(path.join(pluginRoot, 'skills'), path.join(cacheRoot, 'skills'), { recursive: true });
    const configPath = path.join(env.CODEX_HOME, 'config.toml');
    const config = await readFile(configPath, 'utf8');
    await writeFile(configPath, `${config.trimEnd()}\n\n[plugins."${args[2]}"]\nenabled = true\n`);
    return { stdout: JSON.stringify({ pluginId: args[2] }), stderr: '', code: 0 };
  }
  // Issue #2084: the preflight confirms requirements against the skill catalog
  // Codex renders into the prompt, not against plugin enablement alone.
  if (args[0] === 'debug' && args[1] === 'prompt-input') {
    const systemSkill = path.join(env.CODEX_HOME, 'skills', '.system', 'imagegen', 'SKILL.md');
    await mkdir(path.dirname(systemSkill), { recursive: true });
    await writeFile(systemSkill, '---\nname: imagegen\n---\n');
    const scopedCache = path.join(buildPluginCachePath({ codexHome: env.CODEX_HOME, pluginId: 'superpowers@openai-curated' }), '1.0.0', 'skills');
    const rendered = fakePluginInstalled ? `- imagegen: Generate images. (file: ${systemSkill})\\n- superpowers:using-superpowers: Use superpowers. (file: ${path.join(scopedCache, 'using-superpowers', 'SKILL.md')})\\n- superpowers:test-driven-development: TDD. (file: ${path.join(scopedCache, 'test-driven-development', 'SKILL.md')})` : `- imagegen: Generate images. (file: ${systemSkill})`;
    return { stdout: JSON.stringify({ text: `<skills_instructions>\n### Available skills\n${rendered}\n</skills_instructions>` }), stderr: '', code: 0 };
  }
  throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
};

const scopedBaseHome = path.join(fixtureRoot, 'operator-codex-home');
await mkdir(path.join(scopedBaseHome, '.tmp', 'plugins'), { recursive: true });
await writeFile(path.join(scopedBaseHome, '.tmp', 'plugins.sha'), 'fixture-sha\n');
await writeFile(path.join(scopedBaseHome, 'config.toml'), '[features]\nmulti_agent = true\n');
await writeFile(path.join(scopedBaseHome, 'auth.json'), '{}\n');

const preflightLogs = [];
const preflight = await runCodexCapabilityPreflight({
  owner: 'CEHR2005',
  repo: 'GCS-TS',
  issueNumber: 1,
  baseCodexHome: scopedBaseHome,
  runCommand: fakeRunCommand,
  log: async (message, options) => preflightLogs.push({ message, options }),
});

assert.equal(preflight.required, true);
assert.deepEqual(preflight.plugins, ['superpowers@openai-curated']);
assert.equal(preflight.codexHome, path.join(scopedBaseHome, 'hive-mind', 'repositories', 'CEHR2005', 'GCS-TS'));
assert(
  commandCalls.some(call => call.args.join(' ') === 'plugin add superpowers@openai-curated --json'),
  'required plugin is installed before execution'
);
assert(
  preflightLogs.some(entry => entry.message.includes('Verified superpowers@openai-curated in the Codex plugin catalog') && entry.options?.verbose),
  'verbose diagnostics confirm that the selected plugin exists in the authoritative CLI catalog'
);
assert(
  commandCalls.filter(call => call.command === 'codex' && !call.args.includes('--available')).every(call => call.env.CODEX_HOME === preflight.codexHome),
  'installation and verification use repository-scoped state'
);

// A later invocation refreshes runtime settings and rebuilds exactly the
// selected repository plugin enablement.
await writeFile(path.join(preflight.codexHome, 'config.toml'), '[features]\nmulti_agent = true\n\n[plugins."superpowers@openai-curated"]\nenabled = true\n');
await writeFile(path.join(scopedBaseHome, 'config.toml'), 'model = "gpt-updated"\n');
await runCodexCapabilityPreflight({ owner: 'CEHR2005', repo: 'GCS-TS', issueNumber: 1, baseCodexHome: scopedBaseHome, runCommand: fakeRunCommand });
const refreshedConfig = await readFile(path.join(preflight.codexHome, 'config.toml'), 'utf8');
assert.match(refreshedConfig, /model = "gpt-updated"/u, 'operator runtime configuration is refreshed');
assert.match(refreshedConfig, /\[plugins\."superpowers@openai-curated"\]/u, 'selected repository plugin enablement is rebuilt');
assert.match(refreshedConfig, /enabled = true/u, 'selected repository plugin settings are rebuilt');

await assert.rejects(
  () =>
    resolveRequiredPlugins({
      requirements: { plugins: ['missing@openai-curated'], skills: ['missing:workflow'] },
      catalog,
    }),
  error => {
    assert(error instanceof CodexCapabilityPreflightError);
    assert.match(error.message, /missing@openai-curated/);
    assert.match(error.message, /codex plugin list --available/);
    assert.match(error.message, /repository-scoped/);
    return true;
  }
);

await rm(fixtureRoot, { recursive: true, force: true });
