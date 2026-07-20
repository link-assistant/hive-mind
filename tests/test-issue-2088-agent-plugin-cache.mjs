/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2088 — the CLI-agnostic half.
 *
 * Codex and Claude Code record plugin *enablement* separately from the
 * materialized payload that actually carries `skills/<skill>/SKILL.md`, and
 * neither `codex plugin list` nor `claude plugin list --json` notices when the
 * two disagree. Both are repaired by re-running the install command.
 *
 * Verified against the real CLIs in
 * experiments/issue-2088/reproduce-cache-repair.sh (Codex) and
 * experiments/issue-2088/reproduce-claude-cache-gap.sh (Claude Code); this test
 * pins the shared primitive so a future Claude provisioning path inherits the
 * repair instead of re-implementing it.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { CLAUDE_PLUGIN_CLI, CODEX_PLUGIN_CLI, buildPluginCachePath, buildPluginPayloadRepairs, inspectPluginPayloads, readMaterializedPluginSkills, repairPluginPayloads } from '../src/agent-plugin-cache.lib.mjs';

const PLUGIN_ID = 'demo@fixture';
const VERSION = '1.0.0';
const EXPECTED = new Map([[PLUGIN_ID, ['demo:demo-skill']]]);

const materialize = async agentHome => {
  const skill = path.join(buildPluginCachePath({ agentHome, pluginId: PLUGIN_ID }), VERSION, 'skills', 'demo-skill');
  await mkdir(skill, { recursive: true });
  await writeFile(path.join(skill, 'SKILL.md'), '---\nname: demo-skill\n---\n');
};

const root = await mkdtemp(path.join(os.tmpdir(), 'issue-2088-agent-cache-'));

// --- the cache layout is the same for both CLIs ------------------------------

assert.equal(buildPluginCachePath({ agentHome: '/home/box/.codex', pluginId: PLUGIN_ID }), '/home/box/.codex/plugins/cache/fixture/demo', 'the payload lives under plugins/cache/<marketplace>/<plugin>');
assert.equal(buildPluginCachePath({ agentHome: '/home/box/.claude', pluginId: 'DEMO@Fixture' }), '/home/box/.claude/plugins/cache/fixture/demo', 'plugin ids are matched case-insensitively');

// --- an unmaterialized payload is reported as unhealthy ----------------------

{
  const agentHome = path.join(root, 'inspect');
  await mkdir(agentHome, { recursive: true });

  const [missing] = await inspectPluginPayloads({ agentHome, plugins: [PLUGIN_ID], expectedSkills: EXPECTED });
  assert.equal(missing.healthy, false, 'a plugin with no payload at all is unhealthy');
  assert.deepEqual(missing.missing, ['demo:demo-skill']);

  // A version directory without skills/ is the production signature: the CLI
  // reports "installed, enabled" while the model sees nothing.
  await mkdir(path.join(buildPluginCachePath({ agentHome, pluginId: PLUGIN_ID }), VERSION), { recursive: true });
  const [stale] = await inspectPluginPayloads({ agentHome, plugins: [PLUGIN_ID], expectedSkills: EXPECTED });
  assert.equal(stale.healthy, false, 'a version directory without skills/ is unhealthy');
  assert.deepEqual(stale.versions, [VERSION], 'the stale version is still on disk, which is why `plugin list` is fooled');

  await materialize(agentHome);
  const [healthy] = await inspectPluginPayloads({ agentHome, plugins: [PLUGIN_ID], expectedSkills: EXPECTED });
  assert.equal(healthy.healthy, true, 'a materialized payload is healthy');
  assert.deepEqual(healthy.materialized, ['demo:demo-skill']);
}

// --- both CLIs repair through their own install verb -------------------------

for (const cli of [CODEX_PLUGIN_CLI, CLAUDE_PLUGIN_CLI]) {
  const agentHome = path.join(root, `repair-${cli.id}`);
  await mkdir(agentHome, { recursive: true });

  const calls = [];
  const runCommand = async ({ command, args }) => {
    calls.push([command, ...args].join(' '));
    if (args[1] === cli.install(PLUGIN_ID)[1]) await materialize(agentHome);
    return { stdout: '{}', stderr: '', code: 0 };
  };

  const repaired = await repairPluginPayloads({
    command: cli.id,
    env: {},
    runCommand,
    agentHome,
    plugins: [PLUGIN_ID],
    expectedSkills: EXPECTED,
    strategies: buildPluginPayloadRepairs({ cli }),
  });

  assert.deepEqual(repaired.unhealthy, [], `${cli.label}: the payload is materialized after repair`);
  assert.deepEqual(repaired.applied, [`install:${PLUGIN_ID}`], `${cli.label}: the cheapest repair that works is the one that runs`);
  assert.deepEqual(calls, [[cli.id, ...cli.install(PLUGIN_ID)].join(' ')], `${cli.label}: repair uses that CLI's own install verb`);

  // Idempotence: a healthy payload is left alone, which keeps provisioning
  // cheap and stable across container restarts.
  const repeat = await repairPluginPayloads({ command: cli.id, env: {}, runCommand, agentHome, plugins: [PLUGIN_ID], expectedSkills: EXPECTED, strategies: buildPluginPayloadRepairs({ cli }) });
  assert.deepEqual(repeat.applied, [], `${cli.label}: a healthy payload triggers no repair`);
}

// --- escalation: install fails, the operator payload is copied in ------------

{
  const agentHome = path.join(root, 'escalate', 'scoped');
  const copyFrom = path.join(root, 'escalate', 'operator');
  await mkdir(agentHome, { recursive: true });
  await materialize(copyFrom);

  const copied = [];
  const repaired = await repairPluginPayloads({
    command: 'codex',
    env: {},
    runCommand: async () => ({ stdout: '', stderr: 'marketplace unreachable', code: 1 }),
    agentHome,
    copyFrom,
    plugins: [PLUGIN_ID],
    expectedSkills: EXPECTED,
    strategies: buildPluginPayloadRepairs({ cli: CODEX_PLUGIN_CLI, onCopied: entry => copied.push(entry.pluginId) }),
  });

  assert.deepEqual(repaired.unhealthy, [], 'an unreachable marketplace still ends with a materialized payload');
  assert.deepEqual(repaired.applied, [`install:${PLUGIN_ID} (failed)`, `reinstall:${PLUGIN_ID} (failed)`, `copy-operator-payload:${PLUGIN_ID}`], 'repairs escalate cheapest-first and record every attempt for the diagnostic');
  assert.deepEqual(copied, [PLUGIN_ID], 'the copy hook runs so the CLI can re-declare enablement');
  const { skills } = await readMaterializedPluginSkills({ agentHome, pluginId: PLUGIN_ID });
  assert.deepEqual([...skills], ['demo:demo-skill']);

  // Without an operator payload to copy, every strategy fails and the caller is
  // told exactly which plugin could not be materialized.
  const hopeless = await repairPluginPayloads({
    command: 'codex',
    env: {},
    runCommand: async () => ({ stdout: '', stderr: 'marketplace unreachable', code: 1 }),
    agentHome: path.join(root, 'escalate', 'empty'),
    copyFrom: path.join(root, 'escalate', 'nothing'),
    plugins: [PLUGIN_ID],
    expectedSkills: EXPECTED,
    strategies: buildPluginPayloadRepairs({ cli: CODEX_PLUGIN_CLI }),
  });
  assert.deepEqual(
    hopeless.unhealthy.map(entry => entry.pluginId),
    [PLUGIN_ID],
    'an unrepairable payload is reported rather than silently accepted'
  );
}

await rm(root, { recursive: true, force: true });

console.log('✅ issue #2088: plugin payload inspection and repair work for both the Codex and Claude Code CLIs');
