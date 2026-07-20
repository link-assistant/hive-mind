/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2088.
 *
 * The failing run against CEHR2005/GCS-TS#4 detected the mandatory
 * `superpowers@openai-curated` plugin and `superpowers:*` skills, found them in
 * the marketplace, saw `codex plugin list` report them as "installed, enabled"
 * in the repository-scoped CODEX_HOME — and then handed the model a prompt with
 * no `superpowers:*` skills, because the payload under
 * `CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills` was never
 * materialized. The preflight logged the miss and continued "with the operator
 * Codex capabilities", so the solver burned a full run on a task it could not
 * complete.
 *
 * The fake CLI below reproduces that split faithfully: `plugin list` reads
 * `config.toml` (enablement), while `debug prompt-input` renders whatever is
 * actually materialized in the scoped cache (exposure). Verified against a real
 * Codex CLI in experiments/issue-2088/reproduce-cache-repair.sh.
 */

import assert from 'node:assert/strict';
import { access, cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CodexCapabilityPreflightError, buildPluginCachePath, detectRequiredCodexCapabilities, isExplicitRequirement, readMaterializedPluginSkills, runCodexCapabilityPreflight } from '../src/codex-capability-preflight.lib.mjs';

const PLUGIN_ID = 'superpowers@openai-curated';
const VERSION = '5.1.3';
const SKILLS = ['using-superpowers', 'test-driven-development'];

// The issue text names the plugin by its `-remote` alias and the skills by
// their `plugin:skill` form: both are explicit declarations that must fail
// closed when they cannot be repaired.
const issueText = `
Before writing code you must install superpowers@openai-curated-remote.
Then invoke superpowers:using-superpowers.
The workflow requires superpowers:test-driven-development.
`;

const exists = async target =>
  access(target).then(
    () => true,
    () => false
  );

const makeFixture = async label => {
  const root = await mkdtemp(path.join(os.tmpdir(), `issue-2088-${label}-`));
  const marketplace = path.join(root, 'marketplace', 'plugins', 'superpowers');
  for (const skill of SKILLS) {
    await mkdir(path.join(marketplace, 'skills', skill), { recursive: true });
    await writeFile(path.join(marketplace, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n`);
  }

  const baseCodexHome = path.join(root, 'operator-codex-home');
  await mkdir(path.join(baseCodexHome, '.tmp', 'plugins'), { recursive: true });
  await writeFile(path.join(baseCodexHome, '.tmp', 'plugins.sha'), 'fixture-sha\n');
  await writeFile(path.join(baseCodexHome, 'config.toml'), '[features]\nmulti_agent = true\n');

  return { root, marketplace, baseCodexHome, entry: { pluginId: PLUGIN_ID, name: 'superpowers', source: { source: 'local', path: marketplace } } };
};

const scopedHomeFor = ({ baseCodexHome, owner = 'CEHR2005', repo = 'GCS-TS' }) => path.join(baseCodexHome, 'hive-mind', 'repositories', owner, repo);

// `installable: false` models a scoped home whose marketplace source cannot be
// reached — the case the operator-payload fallback exists for.
const makeCodex = ({ fixture, installable = true }) => {
  const calls = [];
  const runCommand = async ({ command, args, env }) => {
    calls.push({ command, args, env });
    if (command === 'gh' && args[2]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
    if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: issueText }), stderr: '', code: 0 };
    if (command !== 'codex') throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);

    const codexHome = env.CODEX_HOME;
    const cacheRoot = buildPluginCachePath({ codexHome, pluginId: PLUGIN_ID });

    if (args[0] === 'plugin' && args[1] === 'add') {
      if (!installable) return { stdout: '', stderr: 'error: failed to fetch plugin source', code: 1 };
      await cp(path.join(fixture.marketplace, 'skills'), path.join(cacheRoot, VERSION, 'skills'), { recursive: true });
      await writeFile(path.join(codexHome, 'config.toml'), `[features]\nmulti_agent = true\n\n[plugins."${PLUGIN_ID}"]\nenabled = true\n`);
      return { stdout: JSON.stringify({ pluginId: args[2] }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'remove') {
      await rm(cacheRoot, { recursive: true, force: true });
      await writeFile(path.join(codexHome, 'config.toml'), '[features]\nmulti_agent = true\n');
      return { stdout: JSON.stringify({ removed: args[2] }), stderr: '', code: 0 };
    }
    if (args[0] === 'plugin' && args[1] === 'list') {
      // The #2088 signature: enablement is read from config.toml and stays true
      // even when the payload that carries the skills is gone.
      const enabled = await exists(path.join(codexHome, 'config.toml')).then(async present => (present ? (await import('node:fs/promises')).readFile(path.join(codexHome, 'config.toml'), 'utf8') : ''));
      const installed = String(enabled).includes(`[plugins."${PLUGIN_ID}"]`);
      const payload = { installed: installed ? [{ ...fixture.entry, installed: true, enabled: true, version: VERSION }] : [], available: [fixture.entry] };
      return { stdout: JSON.stringify(payload), stderr: '', code: 0 };
    }
    if (args[0] === 'debug' && args[1] === 'prompt-input') {
      // Exposure follows the materialized payload, exactly like the real CLI.
      const { skills } = await readMaterializedPluginSkills({ codexHome, pluginId: PLUGIN_ID });
      const rendered = ['- imagegen: Generate images. (file: /system/SKILL.md)', ...[...skills].sort().map(skill => `- ${skill}: Skill. (file: ${cacheRoot}/SKILL.md)`)].join('\\n');
      return { stdout: JSON.stringify({ text: `<skills_instructions>\n### Available skills\n${rendered}\n</skills_instructions>` }), stderr: '', code: 0 };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  return { calls, runCommand };
};

const preflight = async ({ fixture, codex, owner = 'CEHR2005', repo = 'GCS-TS', issueNumber = 4, env = {} }) => {
  const logs = [];
  const result = await runCodexCapabilityPreflight({
    owner,
    repo,
    issueNumber,
    baseCodexHome: fixture.baseCodexHome,
    codexPath: 'codex',
    env,
    runCommand: codex.runCommand,
    log: async (message, options) => logs.push({ message: String(message), options }),
  });
  return { result, logs };
};

// --- 0. the declarations that must fail closed -------------------------------

const requirements = detectRequiredCodexCapabilities(issueText);
assert.deepEqual(requirements.plugins, [PLUGIN_ID], 'the `-remote` alias normalizes to the marketplace Codex actually uses');
assert.deepEqual(requirements.skills, ['superpowers:test-driven-development', 'superpowers:using-superpowers']);
for (const capability of [PLUGIN_ID, 'superpowers:using-superpowers']) {
  assert.equal(isExplicitRequirement(requirements, capability), true, `${capability} is declared explicitly, not guessed from prose`);
}
assert.equal(isExplicitRequirement(detectRequiredCodexCapabilities('Use the `formatting` skill.'), 'formatting'), false, 'a bare prose token stays advisory (issue #2077)');

// --- 1. missing cache: enabled in config, no payload -------------------------

{
  const fixture = await makeFixture('missing-cache');
  const scoped = scopedHomeFor(fixture);
  await mkdir(scoped, { recursive: true });
  await writeFile(path.join(scoped, 'config.toml'), `[features]\nmulti_agent = true\n\n[plugins."${PLUGIN_ID}"]\nenabled = true\n`);

  const codex = makeCodex({ fixture });
  const { result, logs } = await preflight({ fixture, codex });

  assert.equal(result.required, true, 'the preflight completes instead of degrading');
  assert.equal(result.degraded, undefined);
  assert.equal(result.codexHome, scoped, 'plugin state stays scoped to this repository');
  assert(
    codex.calls.some(call => call.args.join(' ') === `plugin add ${PLUGIN_ID} --json` && call.env.CODEX_HOME === scoped),
    'the payload is materialized even though `plugin list` already reported installed+enabled'
  );
  assert.deepEqual(result.repairs, [`install:${PLUGIN_ID}`], 'the cheapest repair that works is the one that runs');

  const { skills } = await readMaterializedPluginSkills({ codexHome: scoped, pluginId: PLUGIN_ID });
  assert.deepEqual([...skills].sort(), ['superpowers:test-driven-development', 'superpowers:using-superpowers'], 'the scoped cache carries the required skills after repair');
  assert(
    logs.some(entry => entry.message.includes('Verified 2 required skill(s) are visible to the model')),
    'verification is reported against the prompt the model receives'
  );

  // 1b. repeated execution is idempotent: no repair, no reinstall, same state.
  const second = makeCodex({ fixture });
  const repeat = await preflight({ fixture, codex: second });
  assert.deepEqual(repeat.result.repairs, [], 'a healthy scoped payload is left alone');
  assert(!second.calls.some(call => call.args?.[1] === 'add' || call.args?.[1] === 'remove'), 'provisioning does not churn state it already provisioned');
  assert.equal(repeat.result.codexHome, scoped, 'the scoped home is stable across runs, so it survives a container restart');

  await rm(fixture.root, { recursive: true, force: true });
}

// --- 2. stale cache: a version directory with no skills ----------------------

{
  const fixture = await makeFixture('stale-cache');
  const scoped = scopedHomeFor(fixture);
  await mkdir(path.join(buildPluginCachePath({ codexHome: scoped, pluginId: PLUGIN_ID }), '4.0.0'), { recursive: true });
  await writeFile(path.join(scoped, 'config.toml'), `[features]\nmulti_agent = true\n\n[plugins."${PLUGIN_ID}"]\nenabled = true\n`);

  const codex = makeCodex({ fixture });
  const { result } = await preflight({ fixture, codex });

  assert.equal(result.required, true, 'a stale payload is repaired rather than trusted');
  assert(result.repairs.length > 0, 'the stale payload triggered a repair');
  const { skills } = await readMaterializedPluginSkills({ codexHome: scoped, pluginId: PLUGIN_ID });
  assert(skills.has('superpowers:using-superpowers'), 'the required skill is materialized after the stale payload is refreshed');

  await rm(fixture.root, { recursive: true, force: true });
}

// --- 3. unreachable marketplace: fall back to the operator payload -----------

{
  const fixture = await makeFixture('operator-fallback');
  const operatorCache = path.join(buildPluginCachePath({ codexHome: fixture.baseCodexHome, pluginId: PLUGIN_ID }), VERSION, 'skills');
  await cp(path.join(fixture.marketplace, 'skills'), operatorCache, { recursive: true });

  const codex = makeCodex({ fixture, installable: false });
  const { result } = await preflight({ fixture, codex });

  assert.equal(result.required, true, 'a scoped home that cannot reach its marketplace is repaired from the operator payload');
  assert(
    result.repairs.some(step => step.startsWith('copy-operator-payload')),
    'the fallback strategy is recorded for the operator'
  );
  const { skills } = await readMaterializedPluginSkills({ codexHome: scopedHomeFor(fixture), pluginId: PLUGIN_ID });
  assert(skills.has('superpowers:using-superpowers'));

  await rm(fixture.root, { recursive: true, force: true });
}

// --- 4. unrepairable explicit requirement fails closed before `codex exec` ----

{
  const fixture = await makeFixture('repair-failure');
  const codex = makeCodex({ fixture, installable: false });
  const logs = [];
  const failure = await runCodexCapabilityPreflight({
    owner: 'CEHR2005',
    repo: 'GCS-TS',
    issueNumber: 4,
    baseCodexHome: fixture.baseCodexHome,
    env: {},
    runCommand: codex.runCommand,
    log: async message => logs.push(String(message)),
  }).then(
    () => null,
    error => error
  );

  assert(failure instanceof CodexCapabilityPreflightError, 'an unrepairable explicit requirement stops the run');
  assert.equal(failure.details.failClosed, true);
  assert.match(failure.message, /superpowers:/u, 'the diagnostic names the capability that could not be provisioned');
  assert.match(failure.message, /plugins\/cache/u, 'the diagnostic points at the directory that carries plugin skills');
  assert.match(failure.message, /Attempted repairs:/u, 'the diagnostic reports what repair already tried');
  assert(!logs.some(message => message.includes('Continuing with the operator Codex capabilities')), 'the run is not allowed to continue degraded');
  assert(!codex.calls.some(call => call.args?.[0] === 'exec'), 'codex exec is never reached');

  // The operator can still opt out of failing closed.
  const advisoryCodex = makeCodex({ fixture, installable: false });
  const advisory = await preflight({ fixture, codex: advisoryCodex, env: { HIVE_MIND_CODEX_CAPABILITY_ADVISORY: '1' } });
  assert.equal(advisory.result.degraded, true, 'HIVE_MIND_CODEX_CAPABILITY_ADVISORY=1 restores the advisory behaviour');

  await rm(fixture.root, { recursive: true, force: true });
}

// --- 5. a heuristic requirement still degrades safely (issue #2077) ----------

{
  const fixture = await makeFixture('heuristic');
  const logs = [];
  const result = await runCodexCapabilityPreflight({
    owner: 'suenot',
    repo: 'marketmaker-images',
    issueNumber: 81,
    baseCodexHome: fixture.baseCodexHome,
    env: {},
    runCommand: async ({ command, args }) => {
      if (command === 'gh' && args[2]?.endsWith('/comments')) return { stdout: '[]', stderr: '', code: 0 };
      if (command === 'gh') return { stdout: JSON.stringify({ title: 'Task', body: 'The required `renderer` skill must produce 16:9 images.' }), stderr: '', code: 0 };
      if (args[0] === 'plugin') return { stdout: JSON.stringify({ installed: [], available: [fixture.entry] }), stderr: '', code: 0 };
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    },
    log: async message => logs.push(String(message)),
  });

  assert.equal(result.degraded, true, 'a capability guessed from prose never blocks a run');
  assert(logs.some(message => message.includes('Codex capability preflight skipped')));

  await rm(fixture.root, { recursive: true, force: true });
}

// --- 6. repository isolation --------------------------------------------------

{
  const fixture = await makeFixture('isolation');
  const codex = makeCodex({ fixture });
  const first = await preflight({ fixture, codex, owner: 'CEHR2005', repo: 'GCS-TS' });
  const second = await preflight({ fixture, codex, owner: 'link-assistant', repo: 'hive-mind', issueNumber: 2088 });

  assert.notEqual(first.result.codexHome, second.result.codexHome, 'each repository gets its own scoped Codex home');
  for (const home of [first.result.codexHome, second.result.codexHome]) {
    const { skills } = await readMaterializedPluginSkills({ codexHome: home, pluginId: PLUGIN_ID });
    assert(skills.has('superpowers:using-superpowers'), `${home} carries its own payload`);
  }

  // Breaking one repository's cache must not disturb the other's.
  await rm(buildPluginCachePath({ codexHome: first.result.codexHome, pluginId: PLUGIN_ID }), { recursive: true, force: true });
  const repaired = await preflight({ fixture, codex, owner: 'CEHR2005', repo: 'GCS-TS' });
  assert.deepEqual(repaired.result.repairs, [`install:${PLUGIN_ID}`], 'the damaged repository repairs itself');
  const untouched = await readMaterializedPluginSkills({ codexHome: second.result.codexHome, pluginId: PLUGIN_ID });
  assert(untouched.skills.has('superpowers:using-superpowers'), 'the other repository was never touched');

  // Nothing was written into the operator home itself.
  const operatorEntries = await readdir(fixture.baseCodexHome);
  assert(!operatorEntries.includes('plugins'), 'provisioning never installs plugins into the operator Codex home');

  await rm(fixture.root, { recursive: true, force: true });
}

console.log('✅ issue #2088: the repository-scoped Codex plugin cache is repaired and verified before codex exec');
