/** Safety preconditions for the legacy global-config repair, issue #3785.
 * This covers its existing inputs, not every native CLI discovery surface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from 'smol-toml';

const TOOL_INPUTS = {
  claude: {
    dirs: ['.claude', '.claude/plugins', '.claude/plugins/marketplaces', '.claude/plugins/cache', '.claude/plugins/repos', '.claude/skills', '.claude/agents', '.claude/commands'],
    json: ['.claude.json', '.claude/settings.json', '.claude/plugins/installed_plugins.json', '.claude/plugins/known_marketplaces.json'],
  },
  codex: {
    dirs: ['.codex', '.codex/plugins', '.codex/plugins/cache', '.codex/plugins/marketplaces', '.codex/skills', '.agents', '.agents/skills'],
    json: [],
    text: ['.codex/config.toml'],
  },
};

const unsafe = () => new Error('Global agent configuration has unsafe, unreadable or unparseable audit inputs; no repair is permitted. Inspect configuration types, links and permissions.');
const identity = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.nlink}`;
const CONFIG_MAX_BYTES = 1024 * 1024;

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
export async function validateAgentConfigAuditInputs({ tool = 'all', homeDir, fsImpl = fs, previous = null }) {
  const io = fsImpl.promises;
  const snapshot = new Map();
  const tools = tool === 'all' ? Object.keys(TOOL_INPUTS) : [tool];
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
    for (const name of tools) {
      const inputs = TOOL_INPUTS[name];
      if (!inputs) continue;
      for (const relative of inputs.dirs) {
        const target = path.join(homeDir, relative);
        if (!(await inspect(target, 'dir'))) continue;
        // Only extension roots are recursively removed by the legacy audit.
        // Do not inspect auth, transcripts or repository/task scopes here.
        if (['.claude', '.codex', '.agents'].includes(relative)) continue;
        for await (const child of await io.opendir(target)) {
          if (++entries > 10_000) throw unsafe();
          await inspect(path.join(target, child.name));
        }
      }
      for (const relative of [...inputs.json, ...(inputs.text || [])]) {
        const target = path.join(homeDir, relative);
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
            // The repair's line-oriented TOML helpers are not a syntax
            // validator. Reject malformed input before any file is changed.
            parseToml(content, { integersAsBigInt: 'asNeeded' });
          }
          if (identity(await handle.stat({ bigint: true })) !== identity(info)) throw unsafe();
        } finally {
          await handle.close();
        }
      }
    }
    if (previous && (snapshot.size !== previous.size || [...snapshot].some(([target, value]) => previous.get(target) !== value))) throw unsafe();
    return snapshot;
  } catch {
    throw unsafe();
  }
}
