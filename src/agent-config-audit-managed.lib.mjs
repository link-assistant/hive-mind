/** Read-only admission checks for local system/managed agent configuration.
 * Never repair administrator policy or execute a configured helper/hook.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { assertApprovedPlaywrightRegistration } from './agent-mcp-baseline.lib.mjs';
import { CLAUDE_CLOUD_DISABLE_ENV, CLAUDE_CLOUD_DISABLE_SETTINGS } from './claude-cloud-policy.lib.mjs';

const MAX_BYTES = 1024 * 1024;
const unsafe = () => new Error('Unsafe or changed managed agent configuration; no repair or admission is permitted. Inspect managed paths, permissions and syntax without removing security policy.');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
const identity = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.nlink}`;

export function managedAgentConfigRoots() {
  if (process.platform === 'win32') return { claude: path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ClaudeCode'), codex: path.join(process.env.ProgramData || 'C:\\ProgramData', 'OpenAI', 'Codex') };
  // macOS's standard /etc -> /private/etc link is part of the platform layout;
  // inspect its canonical fixed root without weakening arbitrary-link checks.
  return { claude: process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code', codex: process.platform === 'darwin' ? '/private/etc/codex' : '/etc/codex' };
}

/** Fixed platform defaults in production; systemRoots/fsImpl are fixture injection.
 * Requirements constrain MCP identity and executable policy; those restrictions
 * are not server registrations or instruction files and must remain intact.
 */
export async function auditManagedAgentConfig({ tool = 'all', systemRoots = managedAgentConfigRoots(), fsImpl = fs, previous = null } = {}) {
  const io = fsImpl.promises;
  const snapshot = new Map();
  const findings = [];
  let entries = 0;
  const inspect = async (target, directory = false, ancestor = false) => {
    let info;
    try {
      info = await io.lstat(target, { bigint: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw unsafe();
      snapshot.set(target, 'missing');
      return null;
    }
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1n)) throw unsafe();
    snapshot.set(target, ancestor ? `${info.dev}:${info.ino}` : identity(info));
    return info;
  };
  const read = async (target, toml = false) => {
    const info = await inspect(target);
    if (!info) return null;
    if (info.size > BigInt(MAX_BYTES)) throw unsafe();
    const descriptor = await io.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (identity(await descriptor.stat({ bigint: true })) !== identity(info)) throw unsafe();
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead: count } = await descriptor.read(buffer, offset, buffer.length - offset, offset);
        if (!count) break;
        offset += count;
      }
      if (offset > MAX_BYTES || identity(await descriptor.stat({ bigint: true })) !== identity(info)) throw unsafe();
      const parsed = toml ? parseToml(buffer.toString('utf8', 0, offset), { integersAsBigInt: 'asNeeded' }) : JSON.parse(buffer.toString('utf8', 0, offset));
      if (!record(parsed)) throw unsafe();
      return parsed;
    } finally {
      await descriptor.close();
    }
  };
  const children = async target => {
    if (!(await inspect(target, true))) return [];
    const names = [];
    for await (const child of await io.opendir(target)) {
      if (++entries > 10_000) throw unsafe();
      names.push(child.name);
    }
    return names;
  };
  const table = (data, key) => {
    if (data[key] === undefined) return {};
    if (!record(data[key])) throw unsafe();
    return data[key];
  };
  const report = (name, location, key) => findings.push({ tool: name, kind: 'managed-capability', name: key, location, detail: 'managed capability requires explicit administrator reconciliation; security policy is never auto-repaired', repair: null });
  const nonempty = (name, data, location, keys) => {
    for (const key of keys) if (data[key] !== undefined && (record(data[key]) ? Object.keys(data[key]).length > 0 : true)) report(name, location, key);
  };
  const servers = (name, data, location, key) => {
    for (const [serverName, server] of Object.entries(table(data, key))) {
      if (serverName === 'playwright') assertApprovedPlaywrightRegistration(server, name);
      else report(name, location, key);
    }
  };
  const claudeSettings = (data, location) => {
    if (!data) return;
    nonempty('claude', data, location, ['hooks', 'enabledPlugins', 'extraKnownMarketplaces', 'policyHelper']);
    servers('claude', data, location, 'managedMcpServers');
    servers('claude', data, location, 'mcpServers');
    for (const [key, value] of Object.entries({ ...CLAUDE_CLOUD_DISABLE_SETTINGS, allowAllClaudeAiMcps: false })) if (data[key] !== undefined && data[key] !== value) report('claude', location, key);
    const env = table(data, 'env');
    for (const [key, value] of Object.entries(CLAUDE_CLOUD_DISABLE_ENV)) if (env[key] !== undefined && env[key] !== value) report('claude', location, `env.${key}`);
  };
  const codexSettings = (data, location, requirements = false) => {
    if (!data) return;
    const scopes = requirements ? [data] : [data, ...Object.values(table(data, 'profiles'))];
    for (const scope of scopes) {
      if (!record(scope)) throw unsafe();
      nonempty('codex', scope, location, requirements ? ['hooks', 'additional_developer_instructions', 'config_server'] : ['hooks', 'plugins', 'marketplaces', 'skills', 'notify', 'developer_instructions', 'model_instructions_file']);
      if (!requirements) {
        servers('codex', scope, location, 'mcp_servers');
        for (const value of Object.values(table(scope, 'agents'))) if (record(value)) report('codex', location, 'agents');
      }
      // A managed requirement can force remote sync even when user config says
      // false. An absent flag in a system default does not undo the user pin.
      for (const key of ['features', ...(requirements ? ['feature_requirements'] : [])]) {
        const value = table(scope, key).remote_plugin;
        if (value !== undefined && value !== false) report('codex', location, 'features.remote_plugin');
      }
    }
  };
  try {
    for (const name of tool === 'all' ? ['claude', 'codex'] : [tool]) {
      if (!['claude', 'codex'].includes(name)) continue;
      const root = systemRoots[name];
      if (typeof root !== 'string' || !path.isAbsolute(root) || path.normalize(root) !== root || root === path.parse(root).root || /[\0\r\n]/u.test(root)) throw unsafe();
      let parent = path.dirname(root);
      while (true) {
        await inspect(parent, true, true);
        if (parent === path.dirname(parent)) break;
        parent = path.dirname(parent);
      }
      if (!(await inspect(root, true))) continue;
      if (name === 'claude') {
        const settings = path.join(root, 'managed-settings.json');
        claudeSettings(await read(settings), settings);
        const mcp = path.join(root, 'managed-mcp.json');
        const data = await read(mcp);
        if (data) servers(name, data, mcp, 'mcpServers');
        const fragments = path.join(root, 'managed-settings.d');
        for (const file of (await children(fragments)).sort()) {
          if (file.startsWith('.') || !file.endsWith('.json')) continue;
          const target = path.join(fragments, file);
          claudeSettings(await read(target), target);
        }
      } else {
        for (const file of ['config.toml', 'managed_config.toml', 'requirements.toml']) {
          const target = path.join(root, file);
          codexSettings(await read(target, true), target, file === 'requirements.toml');
        }
        const hooks = path.join(root, 'hooks.json');
        const data = await read(hooks);
        if (data) nonempty(name, data, hooks, ['hooks']);
      }
      for (const directory of ['skills', 'plugins', 'agents', 'commands', ...(name === 'claude' ? ['rules'] : ['prompts'])]) {
        const target = path.join(root, directory);
        // These admin payloads are not the pinned CODEX_HOME stock directory.
        // No recursive reads or execution of their contents are necessary.
        if ((await children(target)).length) report(name, target, directory);
      }
      for (const file of name === 'claude' ? ['CLAUDE.md'] : ['AGENTS.md', 'AGENTS.override.md']) {
        const target = path.join(root, file);
        if (await inspect(target)) report(name, target, file);
      }
    }
    if (previous && (snapshot.size !== previous.size || [...snapshot].some(([target, value]) => previous.get(target) !== value))) throw unsafe();
    return { snapshot, findings };
  } catch {
    // Parser and filesystem errors can carry credentials or arbitrary input.
    throw unsafe();
  }
}
