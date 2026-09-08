/**
 * Global Claude / Codex configuration audit and auto-repair (issue #2190).
 *
 * Hive-mind's default agent configuration must be minimalistic: no globally
 * installed plugins, marketplaces, or skills, and no MCP servers beyond the
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
 * The audit is pure with respect to its inputs (an injectable `fs`, `homeDir`)
 * so it can be tested against a temporary home directory. Repair is opt-out via
 * `--no-agent-config-auto-repair` (or `HIVE_MIND_AGENT_CONFIG_AUTO_REPAIR=0` for
 * processes that have no argv, such as the Telegram bot's Docker launcher).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { setTomlTableBoolean } from './codex-capability-preflight.lib.mjs';

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

const safeReadDir = (fsImpl, dir) => {
  try {
    return fsImpl.readdirSync(dir, { withFileTypes: true }).filter(entry => !entry.name.startsWith('.'));
  } catch {
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

const parseTomlTableHeaders = config => {
  const headers = [];
  const pattern = /^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$/gmu;
  let match;
  while ((match = pattern.exec(config)) !== null) headers.push(match[1].trim());
  return headers;
};

const readTomlFeatureValue = (config, key) => {
  const sections = config.split(/^(?=\s*\[)/mu);
  for (const section of sections) {
    const headerMatch = section.match(/^\s*\[([^\]]+)\]/u);
    const header = headerMatch ? headerMatch[1].trim() : '';
    if (header === 'features') {
      const line = section.match(new RegExp(`^\\s*${key}\\s*=\\s*(true|false)`, 'mu'));
      if (line) return line[1] === 'true';
    }
    if (header === '') {
      const dotted = section.match(new RegExp(`^\\s*features\\.${key}\\s*=\\s*(true|false)`, 'mu'));
      if (dotted) return dotted[1] === 'true';
      const inline = section.match(/^\s*features\s*=\s*\{([^}]*)\}/mu);
      if (inline) {
        const pair = inline[1].match(new RegExp(`(?:^|,)\\s*${key}\\s*=\\s*(true|false)`, 'u'));
        if (pair) return pair[1] === 'true';
      }
    }
  }
  return undefined;
};

const unquoteTomlKey = key => key.trim().replace(/^"(.*)"$/u, '$1');

const auditClaude = ({ homeDir, fsImpl, allowedMcpServers }) => {
  const findings = [];
  const claudeDir = path.join(homeDir, '.claude');
  const pluginsDir = path.join(claudeDir, 'plugins');

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
    for (const key of ['enabledPlugins', 'extraKnownMarketplaces']) {
      const value = settings[key];
      if (!value || typeof value !== 'object') continue;
      for (const name of Object.keys(value)) {
        findings.push(makeFinding({ tool: 'claude', kind: key === 'enabledPlugins' ? 'plugin-enable' : 'marketplace', name, location: settingsPath, detail: `${key}.${name} in settings.json`, repair: { type: 'delete-json-key', target: settingsPath, keyPath: [key, name] } }));
      }
    }
  }

  const claudeJsonPath = path.join(homeDir, '.claude.json');
  const claudeJson = safeReadJson(fsImpl, claudeJsonPath);
  if (claudeJson?.mcpServers && typeof claudeJson.mcpServers === 'object') {
    for (const name of Object.keys(claudeJson.mcpServers)) {
      if (allowedMcpServers.includes(name)) continue;
      findings.push(makeFinding({ tool: 'claude', kind: 'mcp-server', name, location: claudeJsonPath, detail: 'user-scope MCP server outside the minimal set', repair: { type: 'delete-json-key', target: claudeJsonPath, keyPath: ['mcpServers', name] } }));
    }
  }
  return findings;
};

const auditCodex = ({ homeDir, fsImpl, allowedMcpServers }) => {
  const findings = [];
  const codexDir = path.join(homeDir, '.codex');
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
    for (const header of parseTomlTableHeaders(config)) {
      const pluginMatch = header.match(/^plugins\.(.+)$/u);
      if (pluginMatch) {
        findings.push(makeFinding({ tool: 'codex', kind: 'plugin-enable', name: unquoteTomlKey(pluginMatch[1]), location: configPath, detail: `[${header}] in config.toml`, repair: { type: 'remove-toml-table', target: configPath, table: header } }));
        continue;
      }
      const mcpMatch = header.match(/^mcp_servers\.([^.]+)$/u);
      if (mcpMatch) {
        const name = unquoteTomlKey(mcpMatch[1]);
        if (allowedMcpServers.includes(name)) continue;
        findings.push(makeFinding({ tool: 'codex', kind: 'mcp-server', name, location: configPath, detail: `[${header}] in config.toml`, repair: { type: 'remove-toml-table', target: configPath, table: header } }));
      }
    }
    const remotePlugin = readTomlFeatureValue(config, 'remote_plugin');
    if (remotePlugin !== false) {
      findings.push(makeFinding({ tool: 'codex', kind: 'remote-plugin-sync', name: 'features.remote_plugin', location: configPath, detail: remotePlugin === undefined ? 'not pinned (Codex syncs the remote plugin catalog on start)' : 'explicitly enabled', repair: { type: 'set-toml-boolean', target: configPath, table: 'features', key: 'remote_plugin', value: false } }));
    }
  } else {
    findings.push(makeFinding({ tool: 'codex', kind: 'remote-plugin-sync', name: 'features.remote_plugin', location: configPath, detail: 'config.toml missing (Codex syncs the remote plugin catalog on start)', repair: { type: 'set-toml-boolean', target: configPath, table: 'features', key: 'remote_plugin', value: false } }));
  }
  return findings;
};

/**
 * Inspect the global configuration of one or both tools.
 *
 * @param {{ tool?: 'claude'|'codex'|'all', homeDir?: string, fsImpl?: typeof fs, allowedMcpServers?: string[] }} [options]
 * @returns {{ findings: object[], repairable: object[], warnOnly: object[] }}
 */
export const auditAgentConfig = ({ tool = 'all', homeDir = os.homedir(), fsImpl = fs, allowedMcpServers = MINIMAL_MCP_SERVERS } = {}) => {
  const tools = tool === 'all' ? AUDITABLE_TOOLS : AUDITABLE_TOOLS.includes(tool) ? [tool] : [];
  const findings = [];
  for (const name of tools) {
    if (name === 'claude') findings.push(...auditClaude({ homeDir, fsImpl, allowedMcpServers }));
    if (name === 'codex') findings.push(...auditCodex({ homeDir, fsImpl, allowedMcpServers }));
  }
  return { findings, repairable: findings.filter(f => f.repair), warnOnly: findings.filter(f => !f.repair) };
};

const applyRepair = (repair, fsImpl) => {
  switch (repair.type) {
    case 'remove-path': {
      fsImpl.rmSync(repair.target, { recursive: true, force: true });
      if (repair.pruneEmptyParent) {
        const parent = path.dirname(repair.target);
        if (safeReadDir(fsImpl, parent).length === 0) fsImpl.rmSync(parent, { recursive: true, force: true });
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
    case 'set-toml-boolean': {
      const config = safeReadText(fsImpl, repair.target) ?? '';
      fsImpl.mkdirSync(path.dirname(repair.target), { recursive: true });
      fsImpl.writeFileSync(repair.target, setTomlTableBoolean({ config, table: repair.table, key: repair.key, value: repair.value }));
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

/**
 * Audit, log, and (optionally) repair. This is the entry point solve/hive/the
 * Docker launcher use.
 *
 * @param {{ tool?: string, homeDir?: string, autoRepair?: boolean, log?: Function, verbose?: boolean, fsImpl?: typeof fs, allowedMcpServers?: string[] }} [options]
 * @returns {Promise<{ findings: object[], repaired: object[], failed: object[], skipped: object[] }>}
 */
export const runAgentConfigAudit = async ({ tool = 'all', homeDir = os.homedir(), autoRepair = true, log = async () => {}, verbose = false, fsImpl = fs, allowedMcpServers = MINIMAL_MCP_SERVERS } = {}) => {
  const scope = AUDITABLE_TOOLS.includes(tool) ? tool : 'all';
  const { findings, repairable, warnOnly } = auditAgentConfig({ tool: scope, homeDir, fsImpl, allowedMcpServers });
  if (verbose) await log(`🔍 ${LOG_PREFIX}: inspected global ${scope === 'all' ? 'claude/codex' : scope} configuration under ${homeDir} (${findings.length} finding${findings.length === 1 ? '' : 's'})`, { verbose: true });
  if (findings.length === 0) return { findings, repaired: [], failed: [], skipped: [] };

  await log(`⚠️  Global agent configuration is not minimal (issue #2190): ${findings.length} finding${findings.length === 1 ? '' : 's'}`, { level: 'warn' });
  for (const finding of findings) await log(`   • ${formatAgentConfigFinding(finding)}`, { level: 'warn' });
  for (const finding of warnOnly) {
    if (verbose) await log(`   ℹ️  ${finding.kind} "${finding.name}" is reported only; remove it manually if it is not wanted`, { verbose: true });
  }
  if (!autoRepair) {
    await log('   Auto-repair is disabled (--no-agent-config-auto-repair); nothing was changed. Non-minimal skills and plugins may change agent behaviour and token usage.', { level: 'warn' });
    return { findings, repaired: [], failed: [], skipped: repairable };
  }
  const { repaired, failed } = repairAgentConfig(repairable, { fsImpl });
  if (repaired.length) await log(`🧹 Auto-repaired ${repaired.length} global agent configuration item${repaired.length === 1 ? '' : 's'} (disable with --no-agent-config-auto-repair)`);
  for (const finding of repaired) {
    if (verbose) await log(`   ✓ ${finding.repair.type}: ${finding.repair.target}${finding.repair.table ? ` [${finding.repair.table}]` : ''}${finding.repair.keyPath ? ` ${finding.repair.keyPath.join('.')}` : ''}`, { verbose: true });
  }
  for (const { finding, error } of failed) await log(`   ✗ could not repair ${formatAgentConfigFinding(finding)}: ${error}`, { level: 'warn' });
  return { findings, repaired, failed, skipped: [] };
};
