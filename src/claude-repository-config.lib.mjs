/**
 * Per-task Claude Code configuration declared by the checked-out repository (issue #3785).
 *
 * Verified with Claude Code 2.1.319 (experiments/issue-3785):
 *   - `.claude/skills` in the checkout already load natively;
 *   - `.mcp.json` servers stay "pending approval" in headless runs, and the
 *     `--strict-mcp-config` that Hive Mind passes (issue #1627) drops them;
 *   - plugins a repository enables in `.claude/settings.json` are neither
 *     installed nor loaded by a headless run.
 *
 * This module turns those declarations into per-session arguments only:
 * repository MCP servers are merged into the session's temporary strict MCP
 * config, and repository plugins are materialized in a private temporary
 * directory and passed with `--plugin-dir`. Nothing is written to `~/.claude`,
 * `~/.claude.json` or any other task, and the temporary directory is removed
 * when the process exits.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_DECLARATION_BYTES = 256 * 1024;
const NAME = /^[a-z0-9][a-z0-9._-]*$/iu;
const GITHUB_REPO = /^[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+$/iu;
const GIT_URL = /^(?:https:\/\/|git@)[^\s]+$/u;
const CLONE_TIMEOUT_MS = 120_000;

/** Marketplaces Claude Code knows without a repository declaration. */
export const KNOWN_CLAUDE_MARKETPLACES = Object.freeze({ 'claude-plugins-official': Object.freeze({ source: 'github', repo: 'anthropics/claude-plugins-official' }) });

const isWithin = (candidate, root) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Read a small JSON file that must resolve inside `root`; null when absent or unsafe. */
const readContainedJson = async (file, root) => {
  try {
    const [canonical, canonicalRoot] = await Promise.all([fs.promises.realpath(file), fs.promises.realpath(root)]);
    if (!isWithin(canonical, canonicalRoot)) return { error: `${path.relative(root, file)} resolves outside the checkout` };
    const info = await fs.promises.stat(canonical);
    if (!info.isFile() || info.size > MAX_DECLARATION_BYTES) return { error: `${path.relative(root, file)} is not a regular file under ${MAX_DECLARATION_BYTES} bytes` };
    return { value: JSON.parse(await fs.promises.readFile(canonical, 'utf8')) };
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    return { error: `${path.relative(root, file)} could not be parsed` };
  }
};

/**
 * MCP servers the repository declares in `.mcp.json`. Server definitions are
 * returned as written; Claude Code expands `${VAR}` references itself.
 */
export async function readRepositoryMcpServers({ projectDir } = {}) {
  if (!projectDir) return { servers: {}, warnings: [] };
  const { value, error } = await readContainedJson(path.join(projectDir, '.mcp.json'), projectDir);
  if (error) return { servers: {}, warnings: [`${error}; repository MCP servers were not loaded.`] };
  const servers = {};
  const warnings = [];
  for (const [name, server] of Object.entries(isPlainObject(value?.mcpServers) ? value.mcpServers : {})) {
    if (isPlainObject(server) && (typeof server.command === 'string' || typeof server.url === 'string')) servers[name] = server;
    else warnings.push(`.mcp.json server '${String(name).slice(0, 80)}' has no command or url and was ignored.`);
  }
  return { servers, warnings };
}

/**
 * Merge operator and repository MCP servers. The operator registration wins on
 * a name clash, so a checkout cannot replace the default Playwright server or
 * any other host-approved server.
 */
export function mergeRepositoryMcpServers({ operatorServers = {}, repositoryServers = {}, exclude = () => false }) {
  const merged = {};
  const added = [];
  const shadowed = [];
  for (const [name, server] of Object.entries(operatorServers)) if (!exclude(name)) merged[name] = server;
  for (const [name, server] of Object.entries(repositoryServers)) {
    if (exclude(name)) continue;
    if (Object.hasOwn(operatorServers, name)) shadowed.push(name);
    else {
      merged[name] = server;
      added.push(name);
    }
  }
  return { servers: merged, added, shadowed };
}

/** Plugins the repository enables in its committed `.claude/settings.json`. */
export async function readRepositoryClaudePluginDeclarations({ projectDir } = {}) {
  if (!projectDir) return { plugins: [], marketplaces: {}, warnings: [] };
  const { value, error } = await readContainedJson(path.join(projectDir, '.claude', 'settings.json'), projectDir);
  if (error) return { plugins: [], marketplaces: {}, warnings: [`${error}; repository Claude plugins were not loaded.`] };
  const enabled = isPlainObject(value?.enabledPlugins) ? value.enabledPlugins : {};
  const plugins = [];
  for (const [id, on] of Object.entries(enabled)) {
    const [name, marketplace, ...rest] = id.split('@');
    if (on === true && rest.length === 0 && NAME.test(name || '') && NAME.test(marketplace || '')) plugins.push({ id, name, marketplace });
  }
  const marketplaces = {};
  for (const [name, entry] of Object.entries(isPlainObject(value?.extraKnownMarketplaces) ? value.extraKnownMarketplaces : {})) {
    if (NAME.test(name) && isPlainObject(entry?.source)) marketplaces[name] = entry.source;
  }
  return { plugins: plugins.sort((left, right) => left.id.localeCompare(right.id)), marketplaces, warnings: [] };
}

const git = (args, cwd) => execFileAsync('git', args, { cwd, timeout: CLONE_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

/** Shallow clone; a pinned `sha` is fetched and checked out when the ref tip differs. */
const defaultClone = async ({ url, ref, sha, destination }) => {
  await git(['clone', '--quiet', '--depth', '1', ...(ref ? ['--branch', ref] : []), '--', url, destination]);
  if (!sha) return;
  const { stdout } = await git(['rev-parse', 'HEAD'], destination);
  if (stdout.trim() === sha) return;
  await git(['fetch', '--quiet', '--depth', '1', 'origin', sha], destination);
  await git(['checkout', '--quiet', '--detach', sha], destination);
};

const cloneUrlFor = source => {
  if (source?.source === 'github' && GITHUB_REPO.test(String(source.repo || ''))) return `https://github.com/${source.repo}.git`;
  if (['git', 'url', 'git-subdir'].includes(source?.source) && GIT_URL.test(String(source.url || ''))) return source.url;
  return null;
};

/**
 * Materialize every repository-enabled Claude plugin into `workDir` and return
 * the directories to pass with `--plugin-dir`. Failures are warnings: a plugin
 * that cannot be fetched must not break the task or fall back to host state.
 */
export async function materializeRepositoryClaudePlugins({ projectDir, workDir, declarations, clone = defaultClone } = {}) {
  const declared = declarations || (await readRepositoryClaudePluginDeclarations({ projectDir }));
  const warnings = [...declared.warnings];
  const pluginDirs = [];
  const loaded = [];
  const marketplaceRoots = new Map();
  let counter = 0;
  const fetchInto = async (source, label) => {
    const url = cloneUrlFor(source);
    if (!url) throw new Error(`unsupported source for ${label}`);
    const destination = path.join(workDir, `${String((counter += 1)).padStart(2, '0')}-${label.replace(/[^a-z0-9._-]/giu, '_')}`);
    const text = key => (typeof source[key] === 'string' && /^[\w./-]+$/u.test(source[key]) && !source[key].startsWith('-') ? source[key] : undefined);
    await clone({ url, ref: text('ref'), sha: /^[0-9a-f]{40}$/u.test(String(source.sha || '')) ? source.sha : undefined, destination });
    if (source.source !== 'git-subdir') return destination;
    const subdirectory = path.resolve(destination, String(source.path || ''));
    if (!isWithin(subdirectory, destination)) throw new Error(`${label} path escapes its repository`);
    return subdirectory;
  };
  const marketplaceRoot = async marketplace => {
    if (marketplaceRoots.has(marketplace)) return marketplaceRoots.get(marketplace);
    const source = declared.marketplaces[marketplace] || KNOWN_CLAUDE_MARKETPLACES[marketplace];
    let root;
    if (!source) throw new Error(`marketplace '${marketplace}' is not declared in .claude/settings.json extraKnownMarketplaces`);
    if (source.source === 'directory') {
      const candidate = path.resolve(projectDir, String(source.path || ''));
      const canonical = await fs.promises.realpath(candidate);
      if (!isWithin(canonical, await fs.promises.realpath(projectDir))) throw new Error(`marketplace '${marketplace}' directory is outside the checkout`);
      root = canonical;
    } else root = await fetchInto(source, `marketplace-${marketplace}`);
    marketplaceRoots.set(marketplace, root);
    return root;
  };
  for (const plugin of declared.plugins) {
    try {
      const root = await marketplaceRoot(plugin.marketplace);
      const manifest = JSON.parse(await fs.promises.readFile(path.join(root, '.claude-plugin', 'marketplace.json'), 'utf8'));
      const entry = (Array.isArray(manifest.plugins) ? manifest.plugins : []).find(candidate => candidate?.name === plugin.name);
      if (!entry) throw new Error(`plugin '${plugin.name}' is not listed by marketplace '${plugin.marketplace}'`);
      let directory;
      if (typeof entry.source === 'string') {
        const pluginRoot = typeof manifest.metadata?.pluginRoot === 'string' && !entry.source.startsWith('./') ? manifest.metadata.pluginRoot : '';
        directory = path.resolve(root, pluginRoot, entry.source);
        if (!isWithin(directory, root)) throw new Error(`plugin '${plugin.name}' source escapes its marketplace`);
      } else directory = await fetchInto(entry.source, `plugin-${plugin.name}`);
      await fs.promises.access(directory);
      pluginDirs.push(directory);
      loaded.push(plugin.id);
    } catch (error) {
      warnings.push(
        `Repository Claude plugin ${plugin.id} was not loaded: ${String(error.message || error)
          .split('\n')[0]
          .slice(0, 200)}`
      );
    }
  }
  return { pluginDirs, loaded, warnings };
}

/**
 * Resolve `--plugin-dir` arguments for one session. The returned `cleanup`
 * removes the private plugin directory; it is also registered for process exit.
 */
const resolvedPluginArgs = new Map();

export async function resolveRepositoryClaudePluginArgs({ projectDir, log = async () => {}, clone } = {}) {
  // Retried attempts of the same task reuse the plugins fetched for its checkout.
  if (!clone && resolvedPluginArgs.has(projectDir)) return resolvedPluginArgs.get(projectDir);
  const result = await resolveRepositoryClaudePluginArgsOnce({ projectDir, log, clone });
  if (!clone) resolvedPluginArgs.set(projectDir, result);
  return result;
}

async function resolveRepositoryClaudePluginArgsOnce({ projectDir, log, clone }) {
  const declarations = await readRepositoryClaudePluginDeclarations({ projectDir });
  if (declarations.plugins.length === 0) {
    for (const warning of declarations.warnings) await log(`⚠️  ${warning}`);
    return { args: [], loaded: [], cleanup: async () => {} };
  }
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'hive-mind-claude-plugins-'));
  const removeSync = () => fs.rmSync(workDir, { recursive: true, force: true }); // hive-sync-ok: exit handler, async work cannot run at exit
  process.once('exit', removeSync); // hive-sync-ok: registers the exit-handler cleanup once per task
  const cleanup = async () => {
    resolvedPluginArgs.delete(projectDir);
    process.removeListener('exit', removeSync); // hive-sync-ok: unregisters the exit-handler cleanup
    await fs.promises.rm(workDir, { recursive: true, force: true });
  };
  const { pluginDirs, loaded, warnings } = await materializeRepositoryClaudePlugins({ projectDir, workDir, declarations, clone });
  for (const warning of warnings) await log(`⚠️  ${warning}`);
  if (loaded.length > 0) await log(`🔌 Repository Claude plugins loaded for this session only: ${loaded.join(', ')}`);
  return { args: pluginDirs.flatMap(directory => ['--plugin-dir', directory]), loaded, cleanup };
}

export default { KNOWN_CLAUDE_MARKETPLACES, materializeRepositoryClaudePlugins, mergeRepositoryMcpServers, readRepositoryClaudePluginDeclarations, readRepositoryMcpServers, resolveRepositoryClaudePluginArgs };
