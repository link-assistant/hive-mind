/**
 * Agent CLI plugin payload inspection and repair (issue #2088).
 *
 * Codex and Claude Code both install marketplace plugins into
 *
 *   <agent home>/plugins/cache/<marketplace>/<plugin>/<version>/
 *
 * and both expose a plugin's Agent Skills to the model only while that payload
 * carries `skills/<skill>/SKILL.md`. Enablement is recorded separately — Codex
 * in `config.toml`, Claude in its config — and neither CLI reconciles the two:
 *
 *   $ rm -rf "$HOME/plugins/cache/<marketplace>/<plugin>/<version>"
 *   $ codex  plugin list --json   # installed: true, enabled: true
 *   $ claude plugin list --json   # enabled: true, installPath: <deleted path>
 *
 * In both cases the model then receives a prompt with none of that plugin's
 * skills. Any provisioning step that trusts `plugin list` therefore skips the
 * one action that would fix it. Both CLIs re-materialize the payload when the
 * install command is run again, and doing so is idempotent.
 *
 * Reproduced against the real CLIs in
 * experiments/issue-2088/reproduce-cache-repair.sh (Codex) and
 * experiments/issue-2088/reproduce-claude-cache-gap.sh (Claude Code).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// The install/remove verbs are the only part of the repair that is CLI
// specific; the cache layout and the failure mode are identical.
export const CODEX_PLUGIN_CLI = {
  id: 'codex',
  label: 'Codex',
  install: pluginId => ['plugin', 'add', pluginId, '--json'],
  remove: pluginId => ['plugin', 'remove', pluginId, '--json'],
};

export const CLAUDE_PLUGIN_CLI = {
  id: 'claude',
  label: 'Claude Code',
  install: pluginId => ['plugin', 'install', pluginId],
  remove: pluginId => ['plugin', 'uninstall', pluginId],
};

export const pluginIdParts = pluginId => {
  const value = String(pluginId || '')
    .trim()
    .toLowerCase();
  const separator = value.indexOf('@');
  return separator === -1 ? { name: value, marketplace: '' } : { name: value.slice(0, separator), marketplace: value.slice(separator + 1) };
};

export const buildPluginCachePath = ({ agentHome, pluginId }) => {
  const { name, marketplace } = pluginIdParts(pluginId);
  return path.join(agentHome, 'plugins', 'cache', marketplace, name);
};

const listDirectoryNames = async directory => {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() || entry.isSymbolicLink()).map(entry => entry.name);
  } catch {
    return [];
  }
};

/** The skills a plugin's materialized payload would actually expose, as `<plugin>:<skill>`. */
export const readMaterializedPluginSkills = async ({ agentHome, pluginId }) => {
  const root = buildPluginCachePath({ agentHome, pluginId });
  const { name } = pluginIdParts(pluginId);
  const skills = new Set();
  const versions = await listDirectoryNames(root);
  for (const version of versions) {
    for (const skill of await listDirectoryNames(path.join(root, version, 'skills'))) {
      try {
        await fs.access(path.join(root, version, 'skills', skill, 'SKILL.md'));
        skills.add(`${name}:${skill}`.toLowerCase());
      } catch {
        // A directory without SKILL.md is not a skill the CLI would render.
      }
    }
  }
  return { root, versions, skills };
};

/** `expectedSkills` maps a plugin id to the `<plugin>:<skill>` names that must be materialized. */
export const inspectPluginPayloads = async ({ agentHome, plugins, expectedSkills = new Map() }) => {
  const report = [];
  for (const pluginId of plugins) {
    const expected = expectedSkills.get(pluginId) || [];
    const { root, versions, skills } = await readMaterializedPluginSkills({ agentHome, pluginId });
    const missing = expected.filter(skill => !skills.has(skill));
    report.push({ pluginId, root, versions, materialized: [...skills].sort(), missing, healthy: versions.length > 0 && missing.length === 0 });
  }
  return report;
};

/**
 * Repair strategies, cheapest first: the first one that materializes the
 * payload wins. `copyFrom` (the operator's own agent home) is the last resort
 * for a scoped home that can no longer reach its marketplace source.
 */
export const buildPluginPayloadRepairs = ({ cli, onInstalled = async () => {}, onCopied = async () => {} }) => {
  const install = async ({ command, env, runCommand, pluginId }) => {
    const result = await runCommand({ command, args: cli.install(pluginId), env });
    if (result?.code !== 0) throw new Error(`${command} ${cli.install(pluginId).join(' ')} exited with code ${result?.code}: ${String(result?.stderr || result?.stdout || '').trim()}`);
    await onInstalled({ result, pluginId });
    return result;
  };

  return [
    { name: 'install', apply: install },
    {
      name: 'reinstall',
      apply: async ({ command, env, runCommand, pluginId, agentHome }) => {
        // Removal clears the enablement record together with the cache and is a
        // no-op when the plugin is not installed.
        await runCommand({ command, args: cli.remove(pluginId), env });
        await fs.rm(buildPluginCachePath({ agentHome, pluginId }), { recursive: true, force: true });
        await install({ command, env, runCommand, pluginId });
      },
    },
    {
      name: 'copy-operator-payload',
      apply: async ({ pluginId, agentHome, copyFrom }) => {
        if (!copyFrom) throw new Error(`No operator ${cli.label} home is available to copy ${pluginId} from.`);
        const source = buildPluginCachePath({ agentHome: copyFrom, pluginId });
        const operator = await readMaterializedPluginSkills({ agentHome: copyFrom, pluginId });
        if (operator.versions.length === 0) throw new Error(`The operator ${cli.label} home has no materialized payload for ${pluginId} at ${source}.`);
        const target = buildPluginCachePath({ agentHome, pluginId });
        await fs.rm(target, { recursive: true, force: true });
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.cp(source, target, { recursive: true, dereference: true, force: true });
        await onCopied({ pluginId, agentHome });
      },
    },
  ];
};

/**
 * Inspect, repair, re-inspect. `force: true` applies the first strategy even to
 * a payload that looks healthy — used when a stronger signal (the rendered
 * prompt) says the skills are still not reaching the model.
 */
export const repairPluginPayloads = async ({ command, env, runCommand, log = async () => {}, agentHome, copyFrom, plugins, expectedSkills, strategies, label = 'agent', force = false }) => {
  const applied = [];
  let report = await inspectPluginPayloads({ agentHome, plugins, expectedSkills });
  for (const entry of report) {
    await log(`   🔎 Scoped payload for ${entry.pluginId}: ${entry.versions.length} version(s), skills: ${entry.materialized.join(', ') || 'none'}`, { verbose: true });
  }

  for (const strategy of strategies) {
    const unhealthy = report.filter(entry => force || !entry.healthy);
    if (unhealthy.length === 0) break;
    for (const entry of unhealthy) {
      const reason = entry.versions.length === 0 ? 'payload not materialized' : entry.missing.length > 0 ? `payload missing ${entry.missing.join(', ')}` : 'model cannot see the required skills';
      await log(`   🛠️  Repairing ${entry.pluginId} in ${label} state (${strategy.name}; ${reason})`);
      try {
        await strategy.apply({ command, env, runCommand, pluginId: entry.pluginId, agentHome, copyFrom });
        applied.push(`${strategy.name}:${entry.pluginId}`);
      } catch (error) {
        await log(`   ⚠️  Repair step '${strategy.name}' failed for ${entry.pluginId}: ${error.message}`, { verbose: true });
        applied.push(`${strategy.name}:${entry.pluginId} (failed)`);
      }
    }
    force = false;
    report = await inspectPluginPayloads({ agentHome, plugins, expectedSkills });
    for (const entry of report) {
      if (entry.healthy) await log(`   ✅ Materialized ${entry.pluginId} payload: ${entry.materialized.join(', ') || 'no skills'}`, { verbose: true });
    }
  }

  return { report, applied, unhealthy: report.filter(entry => !entry.healthy) };
};

export default { CLAUDE_PLUGIN_CLI, CODEX_PLUGIN_CLI, buildPluginCachePath, buildPluginPayloadRepairs, inspectPluginPayloads, readMaterializedPluginSkills, repairPluginPayloads };
