/** Safety preconditions for the legacy global-config repair, issue #3785.
 * This covers its existing inputs, not every native CLI discovery surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { CodexStockBaselineError, validateCodexStockSkills } from './codex-stock-skills.lib.mjs';
import { agentConfigAuditScopes } from './agent-config-audit-paths.lib.mjs';
import { auditManagedAgentConfig } from './agent-config-audit-managed.lib.mjs';

const TOOL_INPUTS = {
  claude: {
    dirs: ['.claude', '.claude/plugins', '.claude/plugins/marketplaces', '.claude/plugins/cache', '.claude/plugins/repos', '.claude/skills', '.claude/agents', '.claude/commands', '.claude/rules'],
    json: ['.claude.json', '.claude/.claude.json', '.claude/settings.json', '.claude/plugins/installed_plugins.json', '.claude/plugins/known_marketplaces.json'],
    opaque: ['.claude/CLAUDE.md'],
  },
  codex: {
    dirs: ['.codex', '.codex/plugins', '.codex/plugins/cache', '.codex/plugins/marketplaces', '.codex/skills', '.codex/prompts', '.agents', '.agents/skills'],
    json: ['.codex/hooks.json'],
    text: ['.codex/config.toml'],
    opaque: ['.codex/AGENTS.md', '.codex/AGENTS.override.md'],
  },
};

const unsafe = () => new Error('Global agent configuration has unsafe, unreadable or unparseable audit inputs; no repair is permitted. Inspect configuration types, links and permissions.');
const identity = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.nlink}`;
const CONFIG_MAX_BYTES = 1024 * 1024;

export function parseAgentConfigToml(content) {
  try {
    return parseToml(content, { integersAsBigInt: 'asNeeded' });
  } catch {
    // Parser diagnostics can contain configuration values, including secrets.
    throw unsafe();
  }
}

async function readBoundedConfig(handle) {
  // Reading through a descriptor prevents link replacement, but the inode can
  // still grow after stat. Keep both allocation and total I/O bounded.
  const buffer = Buffer.alloc(CONFIG_MAX_BYTES + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) return buffer.toString('utf8', 0, offset);
    offset += bytesRead;
  }
  throw unsafe();
}

/** Reject links, nonregular files, unreadable/malformed configuration and changed inputs.
 * Never include parser errors or input bytes in diagnostics. Directory scans
 * are bounded; config reads use O_NOFOLLOW and descriptor identity checks.
 */
export async function validateAgentConfigAuditInputs({ tool = 'all', homeDir, env = {}, systemRoots, fsImpl = fs, previous = null }) {
  const io = fsImpl.promises;
  const snapshot = new Map();
  const scopes = agentConfigAuditScopes({ tool, homeDir, env });
  for (const [target, value] of (await auditManagedAgentConfig({ tool, systemRoots, fsImpl })).snapshot) snapshot.set(`managed:${target}`, value);
  let entries = 0;
  const inspect = async (target, kind) => {
    let info;
    try {
      info = await io.lstat(target, { bigint: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw unsafe();
      snapshot.set(target, 'missing');
      return null;
    }
    if (info.isSymbolicLink() || (!info.isDirectory() && (!info.isFile() || info.nlink !== 1n))) throw unsafe();
    if ((kind === 'dir' && !info.isDirectory()) || (kind === 'file' && !info.isFile())) throw unsafe();
    snapshot.set(target, identity(info));
    return info;
  };
  try {
    // A linked tool root or ancestor must never redirect recursive cleanup.
    await inspect(homeDir, 'dir');
    for (const { tool: name, configDir, additional } of scopes) {
      const inputs = TOOL_INPUTS[name];
      if (!inputs) continue;
      const targetPath = relative => (relative === `.${name}` || relative.startsWith(`.${name}/`) ? path.join(configDir, relative.slice(name.length + 2)) : path.join(homeDir, relative));
      // An override may have a linked ancestor even when its final directory
      // is ordinary. Validate each ancestor's identity, without tracking its
      // unrelated directory entries or traversing auth/history contents.
      if (additional) {
        let ancestor = path.dirname(configDir);
        while (true) {
          let info;
          try {
            info = await io.lstat(ancestor, { bigint: true });
          } catch (error) {
            if (error.code !== 'ENOENT') throw unsafe();
          }
          if (info) {
            if (!info.isDirectory() || info.isSymbolicLink()) throw unsafe();
            snapshot.set(`ancestor:${ancestor}`, `${info.dev}:${info.ino}`);
          } else snapshot.set(`ancestor:${ancestor}`, 'missing');
          if (ancestor === path.dirname(ancestor)) break;
          ancestor = path.dirname(ancestor);
        }
      }
      for (const relative of inputs.dirs) {
        const target = targetPath(relative);
        if (!(await inspect(target, 'dir'))) continue;
        // Only extension roots are recursively removed by the legacy audit.
        // Do not inspect auth, transcripts or repository/task scopes here.
        if (['.claude', '.codex', '.agents'].includes(relative)) continue;
        for await (const child of await io.opendir(target)) {
          if (++entries > 10_000) throw unsafe();
          await inspect(path.join(target, child.name));
        }
      }
      for (const relative of inputs.opaque || []) await inspect(targetPath(relative), 'file');
      for (const relative of [...inputs.json, ...(inputs.text || [])]) {
        const target = targetPath(relative);
        const info = await inspect(target, 'file');
        if (!info) continue;
        if (info.size > BigInt(CONFIG_MAX_BYTES)) throw unsafe();
        const handle = await io.open(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        try {
          if (identity(await handle.stat({ bigint: true })) !== identity(info)) throw unsafe();
          const content = await readBoundedConfig(handle);
          if (inputs.json.includes(relative)) {
            const parsed = JSON.parse(content);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unsafe();
          } else {
            // Validate the full document before building a repair plan.
            parseAgentConfigToml(content);
          }
          if (identity(await handle.stat({ bigint: true })) !== identity(info)) throw unsafe();
        } finally {
          await handle.close();
        }
      }
      if (name === 'codex') {
        const stock = await validateCodexStockSkills({ directory: path.join(configDir, 'skills', '.system'), fsImpl });
        for (const [target, version] of stock) snapshot.set(target, version);
      }
    }
    if (previous && (snapshot.size !== previous.size || [...snapshot].some(([target, value]) => previous.get(target) !== value))) throw unsafe();
    return snapshot;
  } catch (error) {
    if (error instanceof CodexStockBaselineError) throw error;
    throw unsafe();
  }
}
