/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2094.
 *
 * Codex 0.144.6 treats a ChatGPT-authenticated `remote_plugin` catalog as the
 * authority for `openai-curated`. During prompt assembly it removes every
 * locally configured `*@openai-curated` plugin before merging remote installs.
 * `codex plugin list`, the scoped config, and the materialized cache can all be
 * healthy while the model still sees none of those plugin's skills.
 */

import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyCodexCapabilityEnv, buildPluginCachePath, readMaterializedPluginSkills, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';
import { executeCodexCommand } from '../src/codex.lib.mjs';
import { getDockerIsolationAuthMounts } from '../src/isolation-runner.lib.mjs';

const VERSION = '5.1.3';
const SKILLS = ['brainstorming', 'dispatching-parallel-agents', 'executing-plans', 'finishing-a-development-branch', 'receiving-code-review', 'requesting-code-review', 'subagent-driven-development', 'systematic-debugging', 'test-driven-development', 'using-git-worktrees', 'using-superpowers', 'verification-before-completion', 'writing-plans', 'writing-skills'];
const CODEX_BASE_ENV = { PATH: '/bin', RUST_LOG: 'codex_core_plugins=trace,codex_core_skills=trace' };

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const makeFixture = async ({ label, marketplace, operatorConfig = '[features]\nremote_plugin = true\nmulti_agent = true\n' }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), `issue-2094-${label}-`));
  const pluginId = `superpowers@${marketplace}`;
  const source = path.join(root, 'marketplace', 'plugins', 'superpowers');
  for (const skill of SKILLS) {
    await mkdir(path.join(source, 'skills', skill), { recursive: true });
    await writeFile(path.join(source, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`);
  }

  const baseCodexHome = path.join(root, '.codex');
  const projectDir = path.join(root, 'target-checkout');
  await mkdir(path.join(baseCodexHome, '.tmp', 'plugins'), { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(baseCodexHome, '.tmp', 'plugins.sha'), 'fixture-sha\n');
  await writeFile(path.join(baseCodexHome, 'config.toml'), operatorConfig);
  await writeFile(path.join(baseCodexHome, 'auth.json'), '{"auth_mode":"chatgpt"}\n');

  return {
    root,
    source,
    pluginId,
    baseCodexHome,
    projectDir,
    entry: { pluginId, name: 'superpowers', source: { source: 'local', path: source } },
  };
};

const issueText = pluginId => `
Before writing code you must install ${pluginId}.
Then invoke superpowers:using-superpowers.
The workflow requires superpowers:test-driven-development.
`;

const removePluginBlock = (config, pluginId) => config.replace(new RegExp(`^\\[plugins\\."${escapeRegExp(pluginId)}"\\][^\\n]*(?:\\n(?!\\[)[^\\n]*)*`, 'gmu'), '').trimEnd();

// This models codex-rs/core-plugins/src/loader.rs at v0.144.6: the plugin CLI
// sees local enablement, but the prompt loader filters the reserved marketplace
// whenever ChatGPT auth activates the remote global catalog.
const makeCodex = fixture => {
  const calls = [];
  const runCommand = async ({ command, args, env, cwd }) => {
    calls.push({ command, args, env, cwd });
    if (command === 'gh' && args[2]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
    if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: issueText(fixture.pluginId) }), stderr: '', code: 0 };
    if (command !== 'codex') throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);

    const codexHome = env.CODEX_HOME;
    const configPath = path.join(codexHome, 'config.toml');
    const cacheRoot = buildPluginCachePath({ codexHome, pluginId: fixture.pluginId });

    if (args[0] === 'plugin' && args[1] === 'add') {
      await cp(path.join(fixture.source, 'skills'), path.join(cacheRoot, VERSION, 'skills'), { recursive: true });
      const config = await readFile(configPath, 'utf8');
      if (!config.includes(`[plugins."${fixture.pluginId}"]`)) {
        await writeFile(configPath, `${config.trimEnd()}\n\n[plugins."${fixture.pluginId}"]\nenabled = true\n`);
      }
      return { stdout: JSON.stringify({ pluginId: fixture.pluginId }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'remove') {
      await rm(cacheRoot, { recursive: true, force: true });
      const config = await readFile(configPath, 'utf8');
      await writeFile(configPath, `${removePluginBlock(config, fixture.pluginId)}\n`);
      return { stdout: JSON.stringify({ removed: fixture.pluginId }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'list') {
      const config = await readFile(configPath, 'utf8');
      const installed = config.includes(`[plugins."${fixture.pluginId}"]`);
      return {
        stdout: JSON.stringify({
          installed: installed ? [{ ...fixture.entry, installed: true, enabled: true, version: VERSION }] : [],
          available: [fixture.entry],
        }),
        stderr: '',
        code: 0,
      };
    }
    if (args[0] === 'debug' && args[1] === 'prompt-input') {
      const config = await readFile(configPath, 'utf8');
      const auth = JSON.parse(await readFile(path.join(codexHome, 'auth.json'), 'utf8'));
      const remoteCatalogActive = auth.auth_mode === 'chatgpt' && !/^remote_plugin\s*=\s*false\s*$/mu.test(config);
      const reservedPluginFiltered = fixture.pluginId.endsWith('@openai-curated') && remoteCatalogActive;
      const { skills } = await readMaterializedPluginSkills({ codexHome, pluginId: fixture.pluginId });
      const exposed = reservedPluginFiltered ? [] : [...skills].sort();
      const rendered = ['- imagegen: Generate images. (file: /system/SKILL.md)', ...exposed.map(skill => `- ${skill}: Skill. (file: ${cacheRoot}/SKILL.md)`)].join('\n');
      return { stdout: JSON.stringify({ text: `<skills_instructions>\n### Available skills\n${rendered}\n</skills_instructions>` }), stderr: '', code: 0 };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { calls, runCommand };
};

const preflight = async ({ fixture, codex }) =>
  runCodexCapabilityPreflight({
    owner: 'CEHR2005',
    repo: 'GCS-TS',
    issueNumber: 3,
    projectDir: fixture.projectDir,
    baseCodexHome: fixture.baseCodexHome,
    runCommand: codex.runCommand,
    env: CODEX_BASE_ENV,
  });

// Reserved marketplace + ChatGPT auth: Hive must make the locally provisioned
// catalog authoritative inside the repository scope before probing the prompt.
{
  const fixture = await makeFixture({ label: 'reserved', marketplace: 'openai-curated' });
  const operatorConfigBefore = await readFile(path.join(fixture.baseCodexHome, 'config.toml'), 'utf8');
  const firstCodex = makeCodex(fixture);
  const first = await preflight({ fixture, codex: firstCodex });
  const scopedConfig = await readFile(path.join(first.codexHome, 'config.toml'), 'utf8');

  assert.match(scopedConfig, /^remote_plugin\s*=\s*false\s*$/mu, 'the scoped home disables the conflicting remote catalog');
  assert.match(scopedConfig, /multi_agent\s*=\s*true/u, 'unrelated feature settings survive the scoped override');
  assert.match(scopedConfig, /\[plugins\."superpowers@openai-curated"\]/u, 'the local curated plugin remains enabled');
  assert.equal((await readMaterializedPluginSkills({ codexHome: first.codexHome, pluginId: fixture.pluginId })).skills.size, 14, 'the regression carries the same complete 14-skill payload as production');
  assert.equal(await readFile(path.join(fixture.baseCodexHome, 'config.toml'), 'utf8'), operatorConfigBefore, 'the operator config is never mutated');
  assert(
    firstCodex.calls.filter(call => call.command === 'codex' && !call.args.includes('--available')).every(call => call.env.CODEX_HOME === first.codexHome),
    'install, verification, and prompt probing use the same scoped home'
  );
  assert(
    firstCodex.calls.filter(call => call.command === 'codex').every(call => call.env.RUST_LOG === 'codex_core_plugins=trace,codex_core_skills=trace'),
    'loader diagnostics use the same sanitized environment as execution'
  );
  assert.deepEqual([...new Set(firstCodex.calls.filter(call => call.command === 'codex').map(call => call.cwd))], [fixture.projectDir], 'catalog lookup, installation, and prompt probing use the solver checkout cwd');
  const intendedExecEnv = applyCodexCapabilityEnv(CODEX_BASE_ENV, first);
  const promptProbeEnv = firstCodex.calls.find(call => call.args[0] === 'debug' && call.args[1] === 'prompt-input').env;
  assert.deepEqual(intendedExecEnv, promptProbeEnv, 'the actual codex exec receives the exact environment verified by prompt-input');
  let actualExecOptions;
  const fakeDollar = options => {
    actualExecOptions = options;
    return () => ({
      async *stream() {
        yield { type: 'stdout', data: Buffer.from(['{"type":"thread.started","thread_id":"issue-2094-env"}', '{"type":"turn.started"}', '{"type":"item.completed","item":{"id":"message","type":"agent_message","text":"Capability environment verified."}}', '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'].join('\n')) };
        yield { type: 'exit', code: 0 };
      },
    });
  };
  const execution = await executeCodexCommand({
    tempDir: fixture.projectDir,
    branchName: 'issue-2094-regression',
    prompt: 'Verify the capability environment.',
    systemPrompt: '',
    argv: { model: 'gpt-5.5', verbose: false },
    log: async () => {},
    formatAligned: (icon, label, value = '') => `${icon} ${label} ${value}`,
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    codexPath: 'codex',
    $: fakeDollar,
    owner: null,
    repo: null,
    prNumber: null,
    capabilityPreflight: { ...first, codexBaseEnv: CODEX_BASE_ENV },
    calculatePricing: async () => null,
  });
  assert.equal(execution.success, true);
  assert.equal(actualExecOptions.cwd, fixture.projectDir, 'codex exec uses the same target checkout as preflight');
  assert.deepEqual(actualExecOptions.env, promptProbeEnv, 'executeCodexCommand receives exactly the environment verified by prompt-input');
  assert.deepEqual(getDockerIsolationAuthMounts({ tool: 'codex', homeDir: fixture.root, existsSync: candidate => candidate === fixture.baseCodexHome }), [{ source: fixture.baseCodexHome, target: '/home/box/.codex' }], 'Docker execution mounts the operator home that contains the repaired repository scope');
  assert.equal(path.relative(fixture.baseCodexHome, first.codexHome), path.join('hive-mind', 'repositories', 'CEHR2005', 'GCS-TS'), 'the scoped state keeps the same relative path inside that Docker mount');

  // A continued/restarted run refreshes operator settings but retains the
  // scoped boundary override and does not churn an already healthy payload.
  const secondCodex = makeCodex(fixture);
  const second = await preflight({ fixture, codex: secondCodex });
  assert.equal(second.codexHome, first.codexHome);
  assert.deepEqual(second.repairs, [], 'a fresh process reuses healthy scoped state');
  assert(!secondCodex.calls.some(call => call.args[1] === 'add' || call.args[1] === 'remove'), 'continued execution does not reinstall the plugin');
  assert.match(await readFile(path.join(second.codexHome, 'config.toml'), 'utf8'), /^remote_plugin\s*=\s*false\s*$/mu);

  await rm(fixture.root, { recursive: true, force: true });
}

// `remote_plugin` is enabled by default in this Codex family, so an operator
// config without a [features] table needs an explicit scoped table too.
{
  const fixture = await makeFixture({ label: 'default-feature', marketplace: 'openai-curated', operatorConfig: 'model = "gpt-5"\n' });
  const codex = makeCodex(fixture);
  const result = await preflight({ fixture, codex });
  const scopedConfig = await readFile(path.join(result.codexHome, 'config.toml'), 'utf8');

  assert.match(scopedConfig, /\[features\]\nremote_plugin = false/u, 'the scoped override is explicit when the stable feature was implicit');
  assert.match(scopedConfig, /^model = "gpt-5"$/mu, 'top-level operator settings survive insertion of the feature table');

  await rm(fixture.root, { recursive: true, force: true });
}

// A renamed/personal marketplace is not filtered by Codex and must not cause
// Hive to turn off the remote catalog unnecessarily.
{
  const fixture = await makeFixture({ label: 'personal', marketplace: 'personal' });
  const codex = makeCodex(fixture);
  const result = await preflight({ fixture, codex });
  const scopedConfig = await readFile(path.join(result.codexHome, 'config.toml'), 'utf8');

  assert.match(scopedConfig, /^remote_plugin\s*=\s*true\s*$/mu, 'non-reserved marketplaces preserve the operator remote catalog setting');
  assert.match(scopedConfig, /\[plugins\."superpowers@personal"\]/u);

  await rm(fixture.root, { recursive: true, force: true });
}

console.log('✅ issue #2094: curated local plugins cross the authenticated remote-catalog loader boundary');
