/**
 * Global Claude / Codex configuration audit and auto-repair (issue #2190).
 *
 * Hive-mind's default agent configuration must be minimalistic: no globally
 * installed plugins, marketplaces, skills, hooks or global instructions, and no MCP servers beyond the
 * Playwright server the Docker image ships with. Anything else that shows up in
 * the *global* configuration (`~/.claude`, `~/.claude.json`, `~/.codex`,
 * `~/.agents`) was not put there by hive-mind and is treated as drift:
 *
 *   - Codex 0.15x syncs the "openai-curated-remote" plugin catalog into
 *     `~/.codex/plugins/cache/` on every start unless `features.remote_plugin`
 *     is false. In issue #2190 that pulled in the Superpowers plugin whose
 *     `using-superpowers` / `brainstorming` skills force an approval gate, so
 *     autonomous tasks ended with a question instead of a pull request, at
 *     roughly nine million input tokens per run.
 *   - Claude Code auto-installs the official plugin marketplace on first start
 *     unless `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL=1`.
 *
 * Repository-local skills (`<repo>/.claude/skills`, `<repo>/.agents/skills`,
 * `<repo>/.codex/skills`) are intentionally out of scope: a repository that
 * ships a skill wants it, and hive-mind only ever activates skills that the
 * repository itself contains.
 *
 * The audit is pure with respect to its inputs (an injectable `fs`, `homeDir`,
 * and explicit `env` path selectors). Production callers supply process.env;
 * fixture callers do not inherit operator directories. Repair is opt-out via
 * `--no-agent-config-auto-repair` (or `HIVE_MIND_AGENT_CONFIG_AUTO_REPAIR=0` for
 * processes that have no argv, such as the Telegram bot's Docker launcher).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { stringify as stringifyToml } from 'smol-toml';
import { parseAgentConfigToml, validateAgentConfigAuditInputs } from './agent-config-audit-inputs.lib.mjs';
import { assertApprovedPlaywrightRegistration } from './agent-mcp-baseline.lib.mjs';
import { agentConfigAuditScopes } from './agent-config-audit-paths.lib.mjs';

/** MCP servers that belong to the minimal hive-mind configuration. */
export const MINIMAL_MCP_SERVERS = Object.freeze(['playwright']);

/** Tools the audit knows how to inspect. */
export const AUDITABLE_TOOLS = Object.freeze(['claude', 'codex']);

/** Environment variable that mirrors `--no-agent-config-auto-repair` for argv-less callers. */
export const AGENT_CONFIG_AUTO_REPAIR_ENV = 'HIVE_MIND_AGENT_CONFIG_AUTO_REPAIR';

/**
 * Environment that keeps the global configuration minimal between audits.
 *
 * `CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL` stops Claude Code from
 * re-adding the official marketplace the audit just removed.
 */
export const AGENT_CONFIG_MINIMAL_ENV = Object.freeze({
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
});

/** Codex `-c` overrides that keep the remote plugin catalog from re-syncing. */
export const CODEX_REMOTE_PLUGIN_DISABLE_ARGS = Object.freeze(['-c', 'features.remote_plugin=false']);

const LOG_PREFIX = 'agent-config-audit';

const isTruthyFlag = value => value === '1' || value === 'true' || value === 'yes' || value === 'on';
const isFalsyFlag = value => value === '0' || value === 'false' || value === 'no' || value === 'off';

/**
 * Resolve whether auto-repair is enabled.
 *
 * argv (`--agent-config-auto-repair`, default true) wins over the environment
 * variable; the environment variable exists for callers that have no argv.
 *
 * @param {{ argv?: object, env?: NodeJS.ProcessEnv, args?: string[] }} [options]
 * @returns {boolean}
 */
export const isAgentConfigAutoRepairEnabled = ({ argv, env = process.env, args = [] } = {}) => {
  if (argv && typeof argv.agentConfigAutoRepair === 'boolean') return argv.agentConfigAutoRepair;
  if (Array.isArray(args) && args.includes('--no-agent-config-auto-repair')) return false;
  if (Array.isArray(args) && args.includes('--agent-config-auto-repair')) return true;
  const raw = env?.[AGENT_CONFIG_AUTO_REPAIR_ENV];
  if (typeof raw === 'string' && isFalsyFlag(raw.trim().toLowerCase())) return false;
  if (typeof raw === 'string' && isTruthyFlag(raw.trim().toLowerCase())) return true;
  return true;
};

const safeReadDir = (fsImpl, dir, { includeHidden = false, strict = false } = {}) => {
  try {
    return fsImpl.readdirSync(dir, { withFileTypes: true }).filter(entry => includeHidden || !entry.name.startsWith('.'));
  } catch (error) {
    if (strict) throw error;
    return [];
  }
};

const safeReadJson = (fsImpl, file) => {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const safeReadText = (fsImpl, file) => {
  try {
    return fsImpl.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

const makeFinding = ({ tool, kind, name, location, detail, repair }) => ({ tool, kind, name, location, detail, repair });

/**
 * Strip a TOML table (its header line and every line up to the next header)
 * from a config string. Handles `[a.b]`, `[a."quoted.b"]`, and array tables.
 *
 * @param {string} config
 * @param {string} table - Exact table path as written between the brackets.
 * @returns {string}
 */
export const removeTomlTable = (config, table) => {
  const lines = config.split('\n');
  const out = [];
  let skipping = false;
  const isHeader = line => /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/u.test(line);
  const headerName = line =>
    line
      .trim()
      .replace(/^\[\[?/u, '')
      .replace(/\]\]?\s*(?:#.*)?$/u, '')
      .trim();
  for (const line of lines) {
    if (isHeader(line)) {
      skipping = headerName(line) === table;
      if (skipping) continue;
    }
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/gu, '\n\n');
};

const configTable = (config, key) => {
  const value = config[key];
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) throw new Error('Global agent configuration contains an invalid table; no repair is permitted.');
  return value;
};

// Global instruction/command files need explicit removal or quarantine. Never
// read their contents or run installed code to decide whether a home is clean.
const auditGlobalInstructions = ({ tool, root, fsImpl, files = [], directories = [] }) => {
  const findings = [];
  const report = (name, location) => findings.push(makeFinding({ tool, kind: 'global-instructions', name, location, detail: 'global instructions or commands require explicit removal or quarantine', repair: null }));
  for (const entry of safeReadDir(fsImpl, root, { includeHidden: true })) {
    if (files.includes(entry.name)) report(entry.name, path.join(root, entry.name));
  }
  for (const directory of directories) {
    for (const entry of safeReadDir(fsImpl, path.join(root, directory), { includeHidden: true })) report(`${directory}/${entry.name}`, path.join(root, directory, entry.name));
  }
  return findings;
};

const auditClaude = ({ homeDir, configDir: claudeDir, fsImpl, allowedMcpServers }) => {
  const findings = [];
  const pluginsDir = path.join(claudeDir, 'plugins');
  findings.push(...auditGlobalInstructions({ tool: 'claude', root: claudeDir, fsImpl, files: ['CLAUDE.md'], directories: ['rules'] }));

  for (const marketplace of safeReadDir(fsImpl, path.join(pluginsDir, 'marketplaces'))) {
    const location = path.join(pluginsDir, 'marketplaces', marketplace.name);
    findings.push(makeFinding({ tool: 'claude', kind: 'marketplace', name: marketplace.name, location, detail: 'plugin marketplace checked out globally', repair: { type: 'remove-path', target: location } }));
  }
  for (const marketplace of safeReadDir(fsImpl, path.join(pluginsDir, 'cache'))) {
    const marketplaceDir = path.join(pluginsDir, 'cache', marketplace.name);
    const plugins = safeReadDir(fsImpl, marketplaceDir);
    if (plugins.length === 0) {
      findings.push(makeFinding({ tool: 'claude', kind: 'plugin', name: marketplace.name, location: marketplaceDir, detail: 'empty plugin cache entry', repair: { type: 'remove-path', target: marketplaceDir } }));
      continue;
    }
    for (const plugin of plugins) {
      const location = path.join(marketplaceDir, plugin.name);
      findings.push(makeFinding({ tool: 'claude', kind: 'plugin', name: `${marketplace.name}/${plugin.name}`, location, detail: 'plugin cached globally', repair: { type: 'remove-path', target: location, pruneEmptyParent: true } }));
    }
  }
  for (const owner of safeReadDir(fsImpl, path.join(pluginsDir, 'repos'))) {
    const location = path.join(pluginsDir, 'repos', owner.name);
    findings.push(makeFinding({ tool: 'claude', kind: 'plugin', name: owner.name, location, detail: 'plugin repository cloned globally', repair: { type: 'remove-path', target: location } }));
  }
  for (const stateFile of ['installed_plugins.json', 'known_marketplaces.json']) {
    const location = path.join(pluginsDir, stateFile);
    const state = safeReadJson(fsImpl, location);
    if (!state) continue;
    const entries = stateFile === 'installed_plugins.json' ? Object.keys(state.plugins ?? {}) : Object.keys(state).filter(key => key !== 'version');
    if (entries.length === 0) continue;
    findings.push(makeFinding({ tool: 'claude', kind: 'plugin-state', name: stateFile, location, detail: `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}: ${entries.join(', ')}`, repair: { type: 'remove-path', target: location } }));
  }
  for (const skill of safeReadDir(fsImpl, path.join(claudeDir, 'skills'))) {
    const location = path.join(claudeDir, 'skills', skill.name);
    findings.push(makeFinding({ tool: 'claude', kind: 'skill', name: skill.name, location, detail: 'skill installed globally', repair: { type: 'remove-path', target: location, pruneEmptyParent: true } }));
  }
  for (const warnOnlyDir of ['agents', 'commands']) {
    for (const entry of safeReadDir(fsImpl, path.join(claudeDir, warnOnlyDir))) {
      const location = path.join(claudeDir, warnOnlyDir, entry.name);
      findings.push(makeFinding({ tool: 'claude', kind: warnOnlyDir === 'agents' ? 'custom-agent' : 'custom-command', name: entry.name, location, detail: `global ${warnOnlyDir} entry (left in place)`, repair: null }));
    }
  }

  const settingsPath = path.join(claudeDir, 'settings.json');
  const settings = safeReadJson(fsImpl, settingsPath);
  if (settings) {
    if (Object.keys(configTable(settings, 'hooks')).length) {
      findings.push(makeFinding({ tool: 'claude', kind: 'global-hooks', name: 'hooks', location: settingsPath, detail: 'inline global hooks in settings.json', repair: { type: 'delete-json-key', target: settingsPath, keyPath: ['hooks'] } }));
    }
    for (const key of ['enabledPlugins', 'extraKnownMarketplaces']) {
      const value = settings[key];
      if (!value || typeof value !== 'object') continue;
      for (const name of Object.keys(value)) {
        findings.push(makeFinding({ tool: 'claude', kind: key === 'enabledPlugins' ? 'plugin-enable' : 'marketplace', name, location: settingsPath, detail: `${key}.${name} in settings.json`, repair: { type: 'delete-json-key', target: settingsPath, keyPath: [key, name] } }));
      }
    }
  }

  // CLAUDE_CONFIG_DIR=$HOME/.claude relocates the native user-state file into
  // that directory. Check both conventional locations, including restored state.
  for (const claudeJsonPath of [path.join(homeDir, '.claude.json'), path.join(claudeDir, '.claude.json')]) {
    const claudeJson = safeReadJson(fsImpl, claudeJsonPath);
    if (claudeJson?.mcpServers !== undefined) {
      for (const name of Object.keys(configTable(claudeJson, 'mcpServers'))) {
        if (allowedMcpServers.includes(name)) {
          if (name === 'playwright') assertApprovedPlaywrightRegistration(claudeJson.mcpServers[name], 'claude');
          continue;
        }
        findings.push(makeFinding({ tool: 'claude', kind: 'mcp-server', name, location: claudeJsonPath, detail: 'user-scope MCP server outside the minimal set', repair: { type: 'delete-json-key', target: claudeJsonPath, keyPath: ['mcpServers', name] } }));
      }
    }
  }
  return findings;
};

const auditCodex = ({ homeDir, configDir: codexDir, fsImpl, allowedMcpServers }) => {
  const findings = [];
  findings.push(...auditGlobalInstructions({ tool: 'codex', root: codexDir, fsImpl, files: ['AGENTS.md', 'AGENTS.override.md'], directories: ['prompts'] }));
  const hooksPath = path.join(codexDir, 'hooks.json');
  const hooks = safeReadJson(fsImpl, hooksPath);
  if (hooks && Object.keys(configTable(hooks, 'hooks')).length) findings.push(makeFinding({ tool: 'codex', kind: 'global-hooks', name: 'hooks.json', location: hooksPath, detail: 'global hook manifest requires explicit removal or quarantine', repair: null }));
  const cacheDir = path.join(codexDir, 'plugins', 'cache');
  for (const marketplace of safeReadDir(fsImpl, cacheDir)) {
    const marketplaceDir = path.join(cacheDir, marketplace.name);
    const plugins = safeReadDir(fsImpl, marketplaceDir);
    if (plugins.length === 0) {
      findings.push(makeFinding({ tool: 'codex', kind: 'plugin', name: marketplace.name, location: marketplaceDir, detail: 'empty plugin cache entry', repair: { type: 'remove-path', target: marketplaceDir } }));
      continue;
    }
    for (const plugin of plugins) {
      const location = path.join(marketplaceDir, plugin.name);
      findings.push(makeFinding({ tool: 'codex', kind: 'plugin', name: `${marketplace.name}/${plugin.name}`, location, detail: 'plugin cached globally', repair: { type: 'remove-path', target: location, pruneEmptyParent: true } }));
    }
  }
  for (const marketplace of safeReadDir(fsImpl, path.join(codexDir, 'plugins', 'marketplaces'))) {
    const location = path.join(codexDir, 'plugins', 'marketplaces', marketplace.name);
    findings.push(makeFinding({ tool: 'codex', kind: 'marketplace', name: marketplace.name, location, detail: 'plugin marketplace checked out globally', repair: { type: 'remove-path', target: location } }));
  }
  for (const [label, dir] of [
    ['codex', path.join(codexDir, 'skills')],
    ['agents', path.join(homeDir, '.agents', 'skills')],
  ]) {
    for (const skill of safeReadDir(fsImpl, dir)) {
      const location = path.join(dir, skill.name);
      findings.push(makeFinding({ tool: 'codex', kind: 'skill', name: skill.name, location, detail: `skill installed globally (${label})`, repair: { type: 'remove-path', target: location, pruneEmptyParent: true } }));
    }
  }

  const configPath = path.join(codexDir, 'config.toml');
  const config = safeReadText(fsImpl, configPath);
  if (config !== null) {
    const parsed = parseAgentConfigToml(config);
    const profiles = configTable(parsed, 'profiles');
    const scopes = [[parsed, []], ...Object.keys(profiles).map(name => [configTable(profiles, name), ['profiles', name]])];
    for (const [scope, prefix] of scopes) {
      // TOML table, dotted-key and inline-table encodings have identical meaning.
      // Profiles must not hide global additions from the baseline check.
      const remove = (kind, name, keyPath) => findings.push(makeFinding({ tool: 'codex', kind, name, location: configPath, detail: 'global configuration registration in config.toml', repair: { type: 'delete-toml-key', target: configPath, keyPath: [...prefix, ...keyPath] } }));
      for (const [table, kind] of [
        ['plugins', 'plugin-enable'],
        ['mcp_servers', 'mcp-server'],
      ]) {
        for (const name of Object.keys(configTable(scope, table))) {
          if (table === 'mcp_servers' && allowedMcpServers.includes(name)) {
            if (name === 'playwright') assertApprovedPlaywrightRegistration(scope[table][name], 'codex');
            continue;
          }
          remove(kind, name, [table, name]);
        }
      }
      for (const key of ['notify', 'developer_instructions', 'model_instructions_file']) {
        if (scope[key] !== undefined) remove(key === 'notify' ? 'global-hooks' : 'global-instructions', key, [key]);
      }
      if (Object.keys(configTable(scope, 'hooks')).length) remove('global-hooks', 'hooks', ['hooks']);
      for (const [name, value] of Object.entries(configTable(scope, 'agents'))) {
        if (value && typeof value === 'object') remove('custom-agent', name, ['agents', name]);
      }
      const remotePlugin = configTable(scope, 'features').remote_plugin;
      if (remotePlugin !== false && (prefix.length === 0 || remotePlugin !== undefined)) {
        findings.push(makeFinding({ tool: 'codex', kind: 'remote-plugin-sync', name: 'features.remote_plugin', location: configPath, detail: remotePlugin === undefined ? 'not pinned (Codex syncs the remote plugin catalog on start)' : 'explicitly enabled', repair: { type: 'set-toml-boolean', target: configPath, table: 'features', tablePath: [...prefix, 'features'], key: 'remote_plugin', value: false } }));
      }
    }
  } else {
    findings.push(makeFinding({ tool: 'codex', kind: 'remote-plugin-sync', name: 'features.remote_plugin', location: configPath, detail: 'config.toml missing (Codex syncs the remote plugin catalog on start)', repair: { type: 'set-toml-boolean', target: configPath, table: 'features', key: 'remote_plugin', value: false } }));
  }
  return findings;
};

/**
 * Inspect the global configuration of one or both tools.
 *
 * @param {{ tool?: 'claude'|'codex'|'all', homeDir?: string, env?: object, fsImpl?: typeof fs, allowedMcpServers?: string[] }} [options]
 * @returns {{ findings: object[], repairable: object[], warnOnly: object[] }}
 */
export const auditAgentConfig = ({ tool = 'all', homeDir = os.homedir(), env = {}, fsImpl = fs, allowedMcpServers = MINIMAL_MCP_SERVERS } = {}) => {
  const findings = [];
  for (const scope of agentConfigAuditScopes({ tool, homeDir, env })) {
    if (scope.tool === 'claude') findings.push(...auditClaude({ ...scope, homeDir, fsImpl, allowedMcpServers }));
    if (scope.tool === 'codex') findings.push(...auditCodex({ ...scope, homeDir, fsImpl, allowedMcpServers }));
  }
  // Conventional account state and .agents are shared discovery surfaces;
  // an effective-root override must not schedule their repair twice.
  const unique = [...new Map(findings.map(finding => [JSON.stringify(finding), finding])).values()];
  return { findings: unique, repairable: unique.filter(f => f.repair), warnOnly: unique.filter(f => !f.repair) };
};

const applyRepair = (repair, fsImpl) => {
  switch (repair.type) {
    case 'remove-path': {
      fsImpl.rmSync(repair.target, { recursive: true, force: true });
      if (repair.pruneEmptyParent) {
        const parent = path.dirname(repair.target);
        // Account for hidden runtime files, and let the kernel reject pruning
        // if another writer adds an entry after the check.
        if (safeReadDir(fsImpl, parent, { includeHidden: true, strict: true }).length === 0) fsImpl.rmdirSync(parent);
      }
      return;
    }
    case 'delete-json-key': {
      const data = safeReadJson(fsImpl, repair.target);
      if (!data) return;
      let cursor = data;
      for (const key of repair.keyPath.slice(0, -1)) {
        if (!cursor || typeof cursor !== 'object') return;
        cursor = cursor[key];
      }
      if (cursor && typeof cursor === 'object') delete cursor[repair.keyPath.at(-1)];
      fsImpl.writeFileSync(repair.target, `${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    case 'remove-toml-table': {
      const config = safeReadText(fsImpl, repair.target);
      if (config === null) return;
      fsImpl.writeFileSync(repair.target, removeTomlTable(config, repair.table));
      return;
    }
    case 'delete-toml-key':
    case 'set-toml-boolean': {
      const config = safeReadText(fsImpl, repair.target);
      if (config === null && repair.type === 'delete-toml-key') throw new Error('Global agent configuration is unreadable; no repair is permitted.');
      const data = parseAgentConfigToml(config ?? '');
      if (repair.type === 'delete-toml-key') {
        let parent = data;
        for (const key of repair.keyPath.slice(0, -1)) parent = configTable(parent, key);
        delete parent[repair.keyPath.at(-1)];
      } else {
        let table = data;
        for (const key of repair.tablePath || [repair.table]) {
          const child = configTable(table, key);
          table[key] = child;
          table = child;
        }
        table[repair.key] = repair.value;
        fsImpl.mkdirSync(path.dirname(repair.target), { recursive: true });
      }
      fsImpl.writeFileSync(repair.target, stringifyToml(data));
      return;
    }
    default:
      throw new Error(`Unknown repair type: ${repair.type}`);
  }
};

/**
 * Apply the repairs attached to findings. Never throws: each failure is reported.
 *
 * @param {object[]} findings
 * @param {{ fsImpl?: typeof fs }} [options]
 * @returns {{ repaired: object[], failed: Array<{ finding: object, error: string }> }}
 */
export const repairAgentConfig = (findings, { fsImpl = fs } = {}) => {
  const repaired = [];
  const failed = [];
  // Delete-json-key repairs on the same file re-read the file each time, so order does not matter.
  for (const finding of findings) {
    if (!finding.repair) continue;
    try {
      applyRepair(finding.repair, fsImpl);
      repaired.push(finding);
    } catch (error) {
      failed.push({ finding, error: error?.message ?? String(error) });
    }
  }
  return { repaired, failed };
};

/** One-line human summary of a finding. */
export const formatAgentConfigFinding = finding => `${finding.tool} ${finding.kind} "${finding.name}" at ${finding.location} (${finding.detail})`;

const requireCleanAuditedConfig = async options => {
  const snapshot = await validateAgentConfigAuditInputs(options);
  const { findings } = auditAgentConfig(options);
  await validateAgentConfigAuditInputs({ ...options, previous: snapshot });
  if (findings.length) throw new Error('Global agent configuration is not clean. Remove or safely quarantine the remaining additions before launching tasks.');
};

/**
 * Audit, log, and (optionally) repair. This is the entry point solve/hive/the
 * Docker launcher use.
 *
 * `requireClean` rejects findings that remain after repair (including items
 * the legacy repair deliberately leaves in place). This enforces the audited
 * surfaces only; it is not a full native CLI discovery/baseline attestation.
 *
 * @param {{ tool?: string, homeDir?: string, env?: object, autoRepair?: boolean, requireClean?: boolean, log?: Function, verbose?: boolean, fsImpl?: typeof fs, allowedMcpServers?: string[] }} [options]
 * @returns {Promise<{ findings: object[], repaired: object[], failed: object[], skipped: object[] }>}
 */
export const runAgentConfigAudit = async ({ tool = 'all', homeDir = os.homedir(), env = {}, autoRepair = true, requireClean = false, log = async () => {}, verbose = false, fsImpl = fs, allowedMcpServers = MINIMAL_MCP_SERVERS } = {}) => {
  const scope = AUDITABLE_TOOLS.includes(tool) ? tool : 'all';
  // Capture only path selectors. Do not retain or inspect provider credentials.
  const selectedEnv = env;
  env = { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, CODEX_HOME: env.CODEX_HOME };
  const requireSamePaths = () => {
    if (selectedEnv.CLAUDE_CONFIG_DIR !== env.CLAUDE_CONFIG_DIR || selectedEnv.CODEX_HOME !== env.CODEX_HOME) throw new Error('Global agent configuration has unsafe effective path changes; no repair or admission is permitted.');
  };
  const auditOptions = { tool: scope, homeDir, env, fsImpl, allowedMcpServers };
  const auditInputs = await validateAgentConfigAuditInputs(auditOptions);
  const { findings, repairable, warnOnly } = auditAgentConfig(auditOptions);
  if (verbose) await log(`🔍 ${LOG_PREFIX}: inspected global ${scope === 'all' ? 'claude/codex' : scope} configuration under ${homeDir} (${findings.length} finding${findings.length === 1 ? '' : 's'})`, { verbose: true });
  if (findings.length === 0) {
    // Verbose logging yields; do not admit a now-contaminated home on the
    // strength of an earlier clean snapshot.
    if (requireClean) await requireCleanAuditedConfig(auditOptions);
    requireSamePaths();
    return { findings, repaired: [], failed: [], skipped: [] };
  }

  await log(`⚠️  Global agent configuration is not minimal (issue #2190): ${findings.length} finding${findings.length === 1 ? '' : 's'}`, { level: 'warn' });
  for (const finding of findings) await log(`   • ${formatAgentConfigFinding(finding)}`, { level: 'warn' });
  for (const finding of warnOnly) {
    if (verbose) await log(`   ℹ️  ${finding.kind} "${finding.name}" is reported only; remove it manually if it is not wanted`, { verbose: true });
  }
  if (!autoRepair) {
    await log('   Auto-repair is disabled (--no-agent-config-auto-repair); nothing was changed. Non-minimal skills and plugins may change agent behaviour and token usage.', { level: 'warn' });
    if (requireClean) throw new Error('Global agent configuration is not clean. Remove or safely quarantine the reported additions before launching tasks.');
    return { findings, repaired: [], failed: [], skipped: repairable };
  }
  // Logging may yield to another editor. Reject changed state before the
  // synchronous legacy repairs rather than applying an obsolete repair plan.
  await validateAgentConfigAuditInputs({ ...auditOptions, previous: auditInputs });
  requireSamePaths();
  const { repaired, failed } = repairAgentConfig(repairable, { fsImpl });
  if (repaired.length) await log(`🧹 Auto-repaired ${repaired.length} global agent configuration item${repaired.length === 1 ? '' : 's'} (disable with --no-agent-config-auto-repair)`);
  for (const finding of repaired) {
    if (verbose) await log(`   ✓ ${finding.repair.type}: ${finding.repair.target}${finding.repair.table ? ` [${finding.repair.table}]` : ''}${finding.repair.keyPath ? ` ${finding.repair.keyPath.join('.')}` : ''}`, { verbose: true });
  }
  for (const { finding, error } of failed) await log(`   ✗ could not repair ${formatAgentConfigFinding(finding)}: ${error}`, { level: 'warn' });
  if (requireClean) {
    if (failed.length) throw new Error('Global agent configuration is not clean after repair. Resolve repair failures before launching tasks.');
    await requireCleanAuditedConfig(auditOptions);
    requireSamePaths();
  }
  return { findings, repaired, failed, skipped: [] };
};
