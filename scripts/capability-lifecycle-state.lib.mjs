// Issue #3785: two independent views of an operator home for the installed
// capability lifecycle gate.
//
// - `scanCapabilityManifest` lists private capability state (skills, plugin
//   payloads/catalogs, plugin state files, MCP servers and the configuration
//   that keeps them off). It is written independently of the production audit
//   so a defect in one cannot hide a recurrence from both. It never reads
//   instruction or skill contents and never executes anything it finds.
// - `captureCanonicalState` fingerprints canonical authentication and history
//   (bytes and file identity). Fingerprints stay in memory; only relative paths
//   ever appear in messages.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** The only global MCP server the baseline allows. */
export const BASELINE_MCP_SERVERS = Object.freeze(['playwright']);

/** Codex features that must stay off in the global profile. */
export const CODEX_GLOBAL_FEATURE_PINS = Object.freeze({ remote_plugin: false, plugins: false, apps: false });

/** Claude settings that keep account skill/plugin sync and connectors off. */
export const CLAUDE_GLOBAL_POLICY = Object.freeze({ syncClaudeAiSkills: false, syncClaudeAiPlugins: false, disableClaudeAiConnectors: true });

/** Startup environment (settings.json `env`) that keeps marketplace auto-install and connectors off. */
export const CLAUDE_GLOBAL_POLICY_ENV = Object.freeze({ CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false' });

const list = async directory => {
  try {
    return (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
};

const readJson = async file => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    return { unreadable: true };
  }
};

const readText = async file => fs.readFile(file, 'utf8').catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error)));

/**
 * Capability entries in one home, as sorted `tool:category:relative` strings.
 * An empty list is the Playwright-only baseline with stock Codex system skills.
 * @param {string} home operator HOME
 * @param {{ parseToml: (text: string) => object }} options
 */
export async function scanCapabilityManifest(home, { parseToml }) {
  const entries = [];
  const add = (tool, category, relative) => entries.push(`${tool}:${category}:${relative}`);
  const claude = path.join(home, '.claude');
  const codex = path.join(home, '.codex');

  for (const entry of await list(path.join(claude, 'skills'))) add('claude', 'skill', `.claude/skills/${entry.name}`);
  for (const area of ['synced', 'marketplaces', 'cache', 'repos']) {
    for (const entry of await list(path.join(claude, 'plugins', area))) add('claude', area === 'marketplaces' ? 'catalog' : 'plugin-payload', `.claude/plugins/${area}/${entry.name}`);
  }
  for (const name of ['installed_plugins.json', 'known_marketplaces.json']) {
    const state = await readJson(path.join(claude, 'plugins', name));
    const keys = state ? Object.keys(name === 'installed_plugins.json' ? (state.plugins ?? {}) : state).filter(key => key !== 'version') : [];
    if (keys.length) add('claude', 'plugin-state', `.claude/plugins/${name}`);
  }
  const settings = (await readJson(path.join(claude, 'settings.json'))) ?? {};
  for (const [key, value] of Object.entries(CLAUDE_GLOBAL_POLICY)) if (settings[key] !== value) add('claude', 'policy', `.claude/settings.json#${key}`);
  for (const [key, value] of Object.entries(CLAUDE_GLOBAL_POLICY_ENV)) if (settings.env?.[key] !== value) add('claude', 'policy', `.claude/settings.json#env.${key}`);
  for (const [plugin, enabled] of Object.entries(settings.enabledPlugins ?? {})) if (enabled) add('claude', 'enabled-plugin', `.claude/settings.json#enabledPlugins.${plugin}`);
  if (settings.extraKnownMarketplaces && Object.keys(settings.extraKnownMarketplaces).length) add('claude', 'catalog', '.claude/settings.json#extraKnownMarketplaces');
  const state = (await readJson(path.join(home, '.claude.json'))) ?? {};
  for (const name of Object.keys(state.mcpServers ?? {})) if (!BASELINE_MCP_SERVERS.includes(name)) add('claude', 'mcp-server', `.claude.json#mcpServers.${name}`);

  for (const entry of await list(path.join(codex, '.tmp'))) if (entry.name.startsWith('plugins')) add('codex', 'catalog', `.codex/.tmp/${entry.name}`);
  for (const area of ['cache', 'marketplaces']) {
    for (const entry of await list(path.join(codex, 'plugins', area))) add('codex', area === 'cache' ? 'plugin-payload' : 'catalog', `.codex/plugins/${area}/${entry.name}`);
  }
  // `.system` holds the CLI's stock skills; everything else is user capability.
  for (const entry of await list(path.join(codex, 'skills'))) if (entry.name !== '.system') add('codex', 'skill', `.codex/skills/${entry.name}`);
  for (const entry of await list(path.join(home, '.agents', 'skills'))) add('codex', 'skill', `.agents/skills/${entry.name}`);
  const configText = await readText(path.join(codex, 'config.toml'));
  let config = {};
  try {
    config = configText === null ? {} : parseToml(configText);
  } catch {
    add('codex', 'config', '.codex/config.toml#unparseable');
  }
  for (const [key, value] of Object.entries(CODEX_GLOBAL_FEATURE_PINS)) if (config.features?.[key] !== value) add('codex', 'feature-pin', `.codex/config.toml#features.${key}`);
  for (const [profile, table] of Object.entries(config.profiles ?? {})) {
    for (const key of Object.keys(CODEX_GLOBAL_FEATURE_PINS)) if (table?.features?.[key] === true) add('codex', 'feature-pin', `.codex/config.toml#profiles.${profile}.features.${key}`);
  }
  for (const name of Object.keys(config.mcp_servers ?? {})) if (!BASELINE_MCP_SERVERS.includes(name)) add('codex', 'mcp-server', `.codex/config.toml#mcp_servers.${name}`);
  for (const [plugin, table] of Object.entries(config.plugins ?? {})) if (table?.enabled) add('codex', 'enabled-plugin', `.codex/config.toml#plugins.${plugin}`);
  return entries.sort();
}

const fingerprint = async file => {
  const [stat, bytes] = await Promise.all([fs.stat(file), fs.readFile(file)]);
  return { digest: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, ino: stat.ino, dev: stat.dev, bytes };
};

/**
 * Fingerprint canonical files. `relatives` are paths under `root`.
 * @returns {Promise<Map<string, {digest: string, size: number, ino: number, dev: number, bytes: Buffer}>>}
 */
export async function captureCanonicalState(root, relatives) {
  const state = new Map();
  for (const relative of relatives) state.set(relative, await fingerprint(path.join(root, relative)).catch(error => (error.code === 'ENOENT' ? null : Promise.reject(error))));
  return state;
}

/**
 * Relative paths whose canonical state changed. `appendOnly` paths (history
 * journals a native run may extend) pass when the earlier bytes are an
 * unchanged prefix of the same file; every other path must keep its bytes and
 * its file identity (a replaced inode breaks shared mounts and hard links)
 * unless it is listed in `contentOnly`.
 */
export function compareCanonicalState(before, after, { appendOnly = [], contentOnly = [] } = {}) {
  const changed = [];
  for (const [relative, previous] of before) {
    const current = after.get(relative);
    if (!previous || !current) {
      if (previous !== current) changed.push(relative);
      continue;
    }
    // `contentOnly` is for files a restore legitimately re-creates.
    const sameFile = contentOnly.includes(relative) || (previous.ino === current.ino && previous.dev === current.dev);
    if (previous.digest === current.digest && sameFile) continue;
    if (appendOnly.includes(relative) && sameFile && current.size > previous.size && current.bytes.subarray(0, previous.size).equals(previous.bytes)) continue;
    changed.push(relative);
  }
  return changed;
}

/**
 * Classify recorded provider requests (method + host + masked path) and
 * tunnelled hosts into the capability channels the gate watches.
 */
export function classifyCapabilityTraffic(requests, tunnels = []) {
  const matching = pattern => [...new Set(requests.filter(line => pattern.test(line)))].sort();
  return {
    accountSync: matching(/\/api\/oauth\/organizations\/:uuid\/(?:skills|plugins)\//u),
    curatedCatalog: [...matching(/chatgpt\.com\/backend-api\/(?:plugins\/featured|ps\/plugins\/)/u), ...[...tunnels].filter(host => host === 'github.com' || host === 'codeload.github.com').map(host => `TUNNEL ${host}`)],
    hostedConnectors: matching(/chatgpt\.com\/backend-api\/(?:ps\/mcp|wham\/apps|connectors)/u),
  };
}

/** Throw unless every channel is empty; the message names channels and entries, never values. */
export function assertNoCapabilityTraffic(traffic, phase) {
  const leaks = Object.entries(traffic).filter(([, lines]) => lines.length);
  if (leaks.length) throw new Error(`${phase}: capability traffic ${leaks.map(([channel, lines]) => `${channel}=[${lines.join(', ')}]`).join('; ')}`);
}
