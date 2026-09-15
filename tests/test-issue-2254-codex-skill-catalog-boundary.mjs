/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2254. Codex may render skills from stale or
 * remotely rehydrated plugin caches even though `plugin list` does not report
 * those providers as installed. The capability preflight must therefore treat
 * the complete rendered catalog, including every skill's provenance path, as a
 * fail-closed allowlist boundary before `codex exec`.
 */

import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexCapabilityPreflightError, applyCodexCapabilityEnv, buildCodexCapabilityStatePath, buildPluginCachePath, runCodexCapabilityPreflight, verifyCodexCapabilityExecutionCatalog } from '../src/codex-capability-preflight.lib.mjs';

const SYSTEM_VERSION = 'system-fixture-v1';
const PLUGIN_VERSION = '1.2.3';
const OWNER = 'link-assistant';
const REPO = 'catalog-boundary-fixture';

const exists = target =>
  access(target).then(
    () => true,
    () => false
  );

const writeSkill = async file => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `---\nname: ${path.basename(path.dirname(file))}\n---\n`);
  return file;
};

const systemSkill = async (codexHome, name = 'imagegen') => {
  const systemRoot = path.join(codexHome, 'skills', '.system');
  await mkdir(systemRoot, { recursive: true });
  await writeFile(path.join(systemRoot, '.codex-system-skills.marker'), `${SYSTEM_VERSION}\n`);
  return writeSkill(path.join(systemRoot, name, 'SKILL.md'));
};

const pluginSkill = ({ codexHome, plugin = 'superpowers', marketplace = 'openai-curated-remote', version = '6.3.0', skill = 'using-superpowers' }) => writeSkill(path.join(codexHome, 'plugins', 'cache', marketplace, plugin, version, 'skills', skill, 'SKILL.md'));

const promptCatalog = ({ entries, roots = [] }) => {
  const rootLines = roots.length > 0 ? ['### Skill roots', ...roots.map(({ alias, directory }) => `- \`${alias}\` = \`${directory}\``)] : [];
  const skillLines = entries.map(({ name, file }) => `- ${name}: Fixture skill. (file: ${file})`);
  return JSON.stringify({ text: ['<skills_instructions>', '## Skills', ...rootLines, '### Available skills', ...skillLines, '</skills_instructions>'].join('\n') });
};

const makeFixture = async label => {
  const root = await mkdtemp(path.join(os.tmpdir(), `issue-2254-${label}-`));
  const baseCodexHome = path.join(root, 'operator-codex-home');
  const projectDir = path.join(root, 'checkout');
  await mkdir(path.join(baseCodexHome, '.tmp', 'plugins'), { recursive: true });
  await mkdir(projectDir, { recursive: true });
  await writeFile(path.join(baseCodexHome, '.tmp', 'plugins.sha'), 'fixture-sha\n');
  await writeFile(path.join(baseCodexHome, 'config.toml'), 'model = "gpt-5"\n');
  await writeFile(path.join(baseCodexHome, 'auth.json'), '{}\n');
  return {
    root,
    baseCodexHome,
    projectDir,
    scopedHome: buildCodexCapabilityStatePath({ baseCodexHome, owner: OWNER, repo: REPO }),
  };
};

const makeRunCommand = ({ issueBody = 'Routine maintenance task.', available = [], debugPrompt, installPlugin }) => {
  const calls = [];
  const installed = new Map();
  const runCommand = async invocation => {
    calls.push(invocation);
    const { command, args, env } = invocation;
    if (command === 'gh' && args[2]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
    if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: issueBody }), stderr: '', code: 0 };
    if (command !== 'codex') throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    if (args[0] === 'plugin' && args[1] === 'list' && args.includes('--available')) return { stdout: JSON.stringify({ installed: [], available }), stderr: '', code: 0 };
    if (args[0] === 'plugin' && args[1] === 'add') {
      const entry = available.find(candidate => candidate.pluginId === args[2]);
      if (!entry) return { stdout: '', stderr: `unknown plugin ${args[2]}`, code: 1 };
      await installPlugin?.({ entry, env });
      installed.set(args[2], { ...entry, installed: true, enabled: true, version: PLUGIN_VERSION });
      return { stdout: JSON.stringify({ pluginId: args[2] }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'remove') {
      installed.delete(args[2]);
      await rm(buildPluginCachePath({ codexHome: env.CODEX_HOME, pluginId: args[2] }), { recursive: true, force: true });
      return { stdout: JSON.stringify({ removed: args[2] }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'list') return { stdout: JSON.stringify({ installed: [...installed.values()], available }), stderr: '', code: 0 };
    if (args[0] === 'debug' && args[1] === 'prompt-input') return debugPrompt({ env, invocation, installed });
    throw new Error(`Unexpected Codex command: ${args.join(' ')}`);
  };
  return { calls, runCommand };
};

const preflight = ({ fixture, codex, issueNumber = 2254, env = {} }) =>
  runCodexCapabilityPreflight({
    owner: OWNER,
    repo: REPO,
    issueNumber,
    projectDir: fixture.projectDir,
    baseCodexHome: fixture.baseCodexHome,
    env,
    runCommand: codex.runCommand,
  });

const expectBoundaryFailure = async promise => {
  const failure = await promise.then(
    () => null,
    error => error
  );
  assert(failure instanceof CodexCapabilityPreflightError, 'the catalog boundary stops Codex before execution');
  assert.equal(failure.details.failClosed, true, 'catalog boundary failures cannot degrade to the operator environment');
  assert.equal(failure.details.securityBoundary, true, 'the error is identified as a security/control failure');
  return failure;
};

// 1. No requirements does not mean no preflight: an uninstalled cache entry is
// still model-visible input and must stop the solve.
{
  const fixture = await makeFixture('zero-requirements-cached-plugin');
  const injected = await pluginSkill({ codexHome: fixture.baseCodexHome });
  const codex = makeRunCommand({
    debugPrompt: async ({ env }) => {
      const core = await systemSkill(env.CODEX_HOME);
      return {
        stdout: promptCatalog({
          entries: [
            { name: 'imagegen', file: core },
            { name: 'superpowers:using-superpowers', file: injected },
          ],
        }),
        stderr: '',
        code: 0,
      };
    },
  });
  const failure = await expectBoundaryFailure(preflight({ fixture, codex }));
  assert.match(failure.message, /superpowers:using-superpowers/u);
  assert(
    codex.calls.some(call => call.args?.[0] === 'debug'),
    'the visibility probe runs even with zero declared requirements'
  );
  await rm(fixture.root, { recursive: true, force: true });
}

// Shared explicitly selected provider fixture for scenarios 2, 5, and 8.
const makeSelectedPluginFixture = async label => {
  const fixture = await makeFixture(label);
  const source = path.join(fixture.root, 'marketplace', 'plugins', 'approved');
  await writeSkill(path.join(source, 'skills', 'workflow', 'SKILL.md'));
  const pluginId = 'approved@personal';
  const entry = { pluginId, name: 'approved', source: { source: 'local', path: source } };
  const installPlugin = async ({ env }) => {
    const destination = path.join(buildPluginCachePath({ codexHome: env.CODEX_HOME, pluginId }), PLUGIN_VERSION, 'skills');
    await cp(path.join(source, 'skills'), destination, { recursive: true });
    await writeFile(path.join(env.CODEX_HOME, 'config.toml'), `[plugins."${pluginId}"]\nenabled = true\n`);
  };
  return { fixture, source, pluginId, entry, installPlugin };
};

// 2. Satisfying a required skill never excuses a second, unrequested skill.
{
  const selected = await makeSelectedPluginFixture('required-plus-unexpected');
  const injected = await pluginSkill({ codexHome: selected.fixture.baseCodexHome, plugin: 'surplus', marketplace: 'stale', skill: 'review' });
  const codex = makeRunCommand({
    issueBody: 'You must use the approved@personal plugin and invoke approved:workflow.',
    available: [selected.entry],
    installPlugin: selected.installPlugin,
    debugPrompt: async ({ env }) => {
      const core = await systemSkill(env.CODEX_HOME);
      const approved = path.join(buildPluginCachePath({ codexHome: env.CODEX_HOME, pluginId: selected.pluginId }), PLUGIN_VERSION, 'skills', 'workflow', 'SKILL.md');
      return {
        stdout: promptCatalog({
          entries: [
            { name: 'imagegen', file: core },
            { name: 'approved:workflow', file: approved },
            { name: 'surplus:review', file: injected },
          ],
        }),
        stderr: '',
        code: 0,
      };
    },
  });
  const failure = await expectBoundaryFailure(preflight({ fixture: selected.fixture, codex }));
  assert.match(failure.message, /surplus:review/u);
  await rm(selected.fixture.root, { recursive: true, force: true });
}

// 3. A disabled/uninstalled provider remaining on disk is never accepted.
{
  const fixture = await makeFixture('disabled-provider');
  await writeFile(path.join(fixture.baseCodexHome, 'config.toml'), '[plugins."disabled@remote"]\nenabled = false\n');
  const disabled = await pluginSkill({ codexHome: fixture.baseCodexHome, plugin: 'disabled', marketplace: 'remote', version: '0.9.0', skill: 'workflow' });
  const codex = makeRunCommand({
    debugPrompt: async ({ env }) => {
      const core = await systemSkill(env.CODEX_HOME);
      return {
        stdout: promptCatalog({
          entries: [
            { name: 'imagegen', file: core },
            { name: 'disabled:workflow', file: disabled },
          ],
        }),
        stderr: '',
        code: 0,
      };
    },
  });
  const failure = await expectBoundaryFailure(preflight({ fixture, codex }));
  assert.match(failure.message, /disabled:workflow/u);
  await rm(fixture.root, { recursive: true, force: true });
}

// 4. Stale repository-scoped cache and legacy marketplace residue are cleaned;
// an unrelated operator checkout is never mounted into the task home.
{
  const fixture = await makeFixture('stale-marketplace');
  await pluginSkill({ codexHome: fixture.scopedHome, plugin: 'leftover', marketplace: 'legacy', skill: 'workflow' });
  await writeSkill(path.join(fixture.scopedHome, '.tmp', 'plugins', '.agents', 'skills', 'leftover', 'SKILL.md'));
  await writeFile(path.join(fixture.scopedHome, 'config.toml'), '[plugins."leftover@legacy"]\nenabled = true\n');
  await writeSkill(path.join(fixture.baseCodexHome, '.tmp', 'plugins', '.agents', 'skills', 'host-leftover', 'SKILL.md'));
  const codex = makeRunCommand({
    debugPrompt: async ({ env }) => {
      const core = await systemSkill(env.CODEX_HOME);
      return { stdout: promptCatalog({ entries: [{ name: 'imagegen', file: 'r0/imagegen/SKILL.md' }], roots: [{ alias: 'r0', directory: path.dirname(path.dirname(core)) }] }), stderr: '', code: 0 };
    },
  });
  const result = await preflight({ fixture, codex });
  assert.equal(result.codexHome, fixture.scopedHome);
  assert.equal(await exists(path.join(fixture.scopedHome, 'plugins')), false, 'stale plugin cache is removed before probing');
  assert.equal(await exists(path.join(fixture.scopedHome, '.tmp', 'plugins')), false, 'legacy marketplace checkout is not retained or mounted');
  assert.doesNotMatch(await readFile(path.join(fixture.scopedHome, 'config.toml'), 'utf8'), /\[plugins\./u, 'stale plugin enablement is removed');
  await rm(fixture.root, { recursive: true, force: true });
}

// 5 and 6. An explicitly selected scoped plugin succeeds, as does a catalog
// containing only version-independent, trusted system skills.
let healthySelected;
{
  const selected = await makeSelectedPluginFixture('selected-provider');
  const codex = makeRunCommand({
    issueBody: 'You must use the approved@personal plugin and invoke approved:workflow.',
    available: [selected.entry],
    installPlugin: selected.installPlugin,
    debugPrompt: async ({ env }) => {
      const core = await systemSkill(env.CODEX_HOME, 'future-system-skill');
      const approved = path.join(buildPluginCachePath({ codexHome: env.CODEX_HOME, pluginId: selected.pluginId }), PLUGIN_VERSION, 'skills', 'workflow', 'SKILL.md');
      return {
        stdout: promptCatalog({
          entries: [
            { name: 'future-system-skill', file: 'r0/future-system-skill/SKILL.md' },
            { name: 'approved:workflow', file: approved },
          ],
          roots: [{ alias: 'r0', directory: path.dirname(path.dirname(core)) }],
        }),
        stderr: '',
        code: 0,
      };
    },
  });
  healthySelected = { selected, codex, result: await preflight({ fixture: selected.fixture, codex }) };
  assert.equal(healthySelected.result.degraded, undefined);
  assert.deepEqual(healthySelected.result.plugins, [selected.pluginId]);
  assert.deepEqual(
    healthySelected.result.skillCatalog.map(entry => [entry.name, entry.providerId, entry.version]),
    [
      ['approved:workflow', selected.pluginId, PLUGIN_VERSION],
      ['future-system-skill', 'codex-system', SYSTEM_VERSION],
    ],
    'the complete allowlisted catalog retains provider identities and versions'
  );
}

{
  const fixture = await makeFixture('system-only');
  const codex = makeRunCommand({
    debugPrompt: async ({ env }) => {
      const core = await systemSkill(env.CODEX_HOME, 'new-core-skill');
      return { stdout: promptCatalog({ entries: [{ name: 'new-core-skill', file: core }] }), stderr: '', code: 0 };
    },
  });
  const result = await preflight({ fixture, codex });
  assert.deepEqual(
    result.skillCatalog.map(entry => entry.name),
    ['new-core-skill'],
    'system provenance is trusted without a version-specific name allowlist'
  );
  await rm(fixture.root, { recursive: true, force: true });
}

// 7. A supported probe that fails or returns an unparsable prompt is uncertain
// security state and therefore fails closed.
for (const [label, debugPrompt, diagnostic] of [
  ['unavailable', async () => ({ stdout: '', stderr: 'permission denied while assembling prompt', code: 1 }), /permission denied/u],
  ['unparsable', async () => ({ stdout: JSON.stringify({ text: 'prompt without a skill catalog' }), stderr: '', code: 0 }), /skills_instructions/u],
]) {
  const fixture = await makeFixture(`probe-${label}`);
  const codex = makeRunCommand({ debugPrompt });
  const failure = await expectBoundaryFailure(preflight({ fixture, codex, env: { HIVE_MIND_CODEX_CAPABILITY_ADVISORY: '1' } }));
  assert.match(failure.message, diagnostic, `${label} probe has an explicit diagnostic`);
  await rm(fixture.root, { recursive: true, force: true });
}

// 8. The one catalog/environment snapshot is the contract inherited by the
// parent execution and all child agents spawned by that Codex process.
{
  const { selected, codex, result } = healthySelected;
  const executionEnv = applyCodexCapabilityEnv({ TRACE: 'same-for-parent-and-children' }, result);
  const finalCatalog = await verifyCodexCapabilityExecutionCatalog({ capabilityPreflight: result, projectDir: selected.fixture.projectDir, env: executionEnv, runCommand: codex.runCommand });
  const promptCalls = codex.calls.filter(call => call.args?.[0] === 'debug' && call.args?.[1] === 'prompt-input');
  assert(promptCalls.length >= 2, 'the inherited catalog is rechecked immediately before execution');
  for (const promptCall of promptCalls) {
    assert.equal(promptCall.env.CODEX_HOME, executionEnv.CODEX_HOME);
    assert.equal(promptCall.env.HIVE_MIND_PARENT_CODEX_HOME, executionEnv.HIVE_MIND_PARENT_CODEX_HOME);
  }
  assert.equal(finalCatalog.skillCatalogFingerprint, result.skillCatalogFingerprint, 'parent and child-agent execution inherits the exact probed identities and versions');
  assert.equal(result.skillCatalogFingerprint.length, 64, 'a stable fingerprint identifies the exact inherited catalog');
  await rm(selected.fixture.root, { recursive: true, force: true });
}

console.log('✅ issue #2254: the full Codex skill catalog is provenance-checked before every solve');
