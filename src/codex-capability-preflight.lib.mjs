/**
 * Repository-scoped Codex capability preflight (issue #2074).
 *
 * Explicit plugin and Agent Skill requirements are discovered from the issue
 * before `codex exec`. Required marketplace plugins are installed into a
 * persistent CODEX_HOME scoped by repository, leaving the operator's global
 * plugin enablement and the target repository untouched.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REQUIREMENT_WORDS = /\b(?:depend(?:s|ency)?|install|invoke|mandatory|must|need(?:ed|s)?|preflight|required?|requires|use)\b/i;
const NEGATED_REQUIREMENT = /\b(?:does\s+not\s+require|not\s+required|optional)\b/i;
// `(?!\.[a-z])` keeps email addresses and hostnames (`ops@example.com`) out of
// the plugin selector space.
const PLUGIN_SELECTOR = /\b([a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*(?:-remote)?)\b(?!\.[a-z])/gi;
const NAMESPACED_SKILL = /\b([a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*)\b/gi;
const EXPLICIT_BARE_SKILL = /\$([a-z0-9][a-z0-9-]*)|`([a-z0-9][a-z0-9-]*)`\s+(?:agent\s+)?skill/gi;

// Issue #2077: Codex plugin and Agent Skill names are lowercase kebab-case
// identifiers that always begin with a letter. Requiring that shape rejects the
// numeric prose tokens the requirement regexes otherwise capture — aspect
// ratios (`16:9`), clock times (`9:30`), host ports (`localhost:3000`), version
// selectors (`node@20`) and currency amounts (`$100`).
const CAPABILITY_TOKEN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

// Prose and markdown routinely produce `word:word` and `$word` tokens that are
// never capability references. Excluding them keeps a heuristic scan of free
// text from inventing requirements.
const PROSE_TOKENS = new Set([
  'agent',
  'caution',
  'codex',
  'default',
  'error',
  'example',
  'file',
  'fixme',
  'format',
  'home',
  'http',
  'https',
  'id',
  'important',
  'input',
  'key',
  'line',
  'name',
  'nb',
  'note',
  'output',
  'path',
  'ref',
  'required',
  'see',
  'skill',
  'the',
  'tip',
  'todo',
  'type',
  'url',
  'usage',
  'value',
  'warning',
]);

const isCapabilityToken = value => CAPABILITY_TOKEN.test(value) && !PROSE_TOKENS.has(value);

export function isCapabilityName(value) {
  const token = String(value || '').toLowerCase();
  const separator = /[:@]/u.exec(token);
  if (!separator) return isCapabilityToken(token);
  const [left, right] = [token.slice(0, separator.index), token.slice(separator.index + 1)];
  // A qualified reference only needs its own halves to be well formed; a prose
  // word such as `note` is meaningless alone but valid as `note:taking`.
  return CAPABILITY_TOKEN.test(left) && CAPABILITY_TOKEN.test(right) && !PROSE_TOKENS.has(left);
}

export class CodexCapabilityPreflightError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'CodexCapabilityPreflightError';
    this.details = details;
  }
}

export function normalizePluginSelector(selector) {
  return String(selector || '')
    .trim()
    .toLowerCase()
    .replace(/@openai-curated-remote$/u, '@openai-curated');
}

export function detectRequiredCodexCapabilities(text) {
  const plugins = new Set();
  const skills = new Set();
  // Every accepted capability keeps the line it came from so `--verbose` can
  // explain a detection instead of only reporting its consequence (issue #2077).
  const evidence = [];
  const rejected = [];

  const accept = (target, value, line) => {
    if (!isCapabilityName(value)) {
      rejected.push({ capability: value, line });
      return;
    }
    target.add(value);
    evidence.push({ capability: value, line });
  };

  for (const rawLine of String(text || '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || !REQUIREMENT_WORDS.test(line) || NEGATED_REQUIREMENT.test(line)) continue;

    for (const match of line.matchAll(PLUGIN_SELECTOR)) accept(plugins, normalizePluginSelector(match[1]), line);
    for (const match of line.matchAll(NAMESPACED_SKILL)) accept(skills, match[1].toLowerCase(), line);
    for (const match of line.matchAll(EXPLICIT_BARE_SKILL)) accept(skills, (match[1] || match[2]).toLowerCase(), line);
  }

  return { plugins: [...plugins].sort(), skills: [...skills].sort(), evidence, rejected };
}

const sanitizePathSegment = value => String(value || '').replace(/[^a-zA-Z0-9._-]/gu, '_');

export function buildCodexCapabilityStatePath({ baseCodexHome, owner, repo }) {
  return path.join(baseCodexHome, 'hive-mind', 'repositories', sanitizePathSegment(owner), sanitizePathSegment(repo));
}

export function applyCodexCapabilityEnv(env, { codexHome, baseCodexHome } = {}) {
  if (!codexHome) return env;
  return { ...env, CODEX_HOME: codexHome, HIVE_MIND_PARENT_CODEX_HOME: baseCodexHome };
}

const defaultRunCommand = async ({ command, args, env = process.env, cwd }) => {
  try {
    const result = await execFileAsync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
    return { stdout: result.stdout || '', stderr: result.stderr || '', code: 0 };
  } catch (error) {
    return { stdout: error.stdout || '', stderr: error.stderr || error.message, code: Number.isInteger(error.code) ? error.code : 1 };
  }
};

const parseJsonCommand = (result, label) => {
  if (result.code !== 0) throw new CodexCapabilityPreflightError(`${label} failed: ${String(result.stderr || result.stdout).trim()}`);
  try {
    return JSON.parse(result.stdout || 'null');
  } catch (error) {
    throw new CodexCapabilityPreflightError(`${label} returned invalid JSON: ${error.message}`);
  }
};

const catalogEntries = catalog => [...(catalog?.installed || []), ...(catalog?.available || [])];

const skillParts = skill => {
  const separator = skill.indexOf(':');
  return separator === -1 ? { namespace: null, name: skill } : { namespace: skill.slice(0, separator), name: skill.slice(separator + 1) };
};

const pluginProvidesSkill = async (plugin, skill) => {
  const sourcePath = plugin?.source?.path;
  if (!sourcePath) return false;
  const { name } = skillParts(skill);
  try {
    await fs.access(path.join(sourcePath, 'skills', name, 'SKILL.md'));
    return true;
  } catch {
    return false;
  }
};

const skillExistsInDirectories = async (skill, skillDirectories) => {
  const { name } = skillParts(skill);
  for (const directory of skillDirectories || []) {
    try {
      await fs.access(path.join(directory, name, 'SKILL.md'));
      return true;
    } catch {
      // Keep searching the remaining standard skill locations.
    }
  }
  return false;
};

export async function resolveRequiredPlugins({ requirements, catalog, skillDirectories = [] }) {
  const entries = catalogEntries(catalog);
  const byId = new Map(entries.map(entry => [normalizePluginSelector(entry.pluginId), entry]));
  const selected = new Map();
  const missing = [];

  for (const selector of requirements.plugins || []) {
    const normalized = normalizePluginSelector(selector);
    const entry = byId.get(normalized);
    if (!entry) missing.push(normalized);
    else selected.set(normalized, entry);
  }

  for (const skill of requirements.skills || []) {
    const { namespace } = skillParts(skill);
    if (!namespace && (await skillExistsInDirectories(skill, skillDirectories))) continue;
    let candidates = entries;
    if (namespace) candidates = entries.filter(entry => entry.name === namespace || String(entry.pluginId || '').startsWith(`${namespace}@`));

    let provider = null;
    for (const entry of candidates) {
      if (await pluginProvidesSkill(entry, skill)) {
        provider = entry;
        break;
      }
    }
    if (provider) selected.set(normalizePluginSelector(provider.pluginId), provider);
    else missing.push(skill);
  }

  if (missing.length > 0) {
    throw new CodexCapabilityPreflightError(`Required Codex capability unavailable: ${missing.join(', ')}. ` + `Run 'codex plugin list --available --json' in the operator container and configure a marketplace that provides it. ` + `Hive Mind installs discovered capabilities into repository-scoped CODEX_HOME state; it does not enable plugins globally.`, { missing });
  }

  return [...selected.keys()].sort();
}

const readIssueRequirementText = async ({ owner, repo, issueNumber, runCommand }) => {
  const issueResult = await runCommand({ command: 'gh', args: ['api', `repos/${owner}/${repo}/issues/${issueNumber}`], env: process.env });
  const issue = parseJsonCommand(issueResult, 'Codex capability issue discovery');
  const commentsResult = await runCommand({ command: 'gh', args: ['api', `repos/${owner}/${repo}/issues/${issueNumber}/comments`, '--paginate'], env: process.env });
  const comments = parseJsonCommand(commentsResult, 'Codex capability comment discovery');
  return [issue?.title, issue?.body, ...(Array.isArray(comments) ? comments.map(comment => comment?.body) : [])].filter(Boolean).join('\n');
};

const replaceWithRelativeSymlink = async ({ source, target }) => {
  try {
    const current = await fs.readlink(target);
    if (path.resolve(path.dirname(target), current) === path.resolve(source)) return;
  } catch {
    // Missing path or a non-symlink is reconciled below.
  }
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.symlink(path.relative(path.dirname(target), source), target, 'dir');
};

const syncFileIfPresent = async (source, target) => {
  try {
    await fs.copyFile(source, target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      await fs.rm(target, { force: true });
      return false;
    }
    throw error;
  }
};

const readIfPresent = async filePath => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
};

// Runtime settings follow the operator config while plugin enablement remains
// persistent and isolated to this repository.
const syncScopedConfig = async ({ baseConfigPath, scopedConfigPath }) => {
  const baseConfig = await readIfPresent(baseConfigPath);
  const scopedConfig = await readIfPresent(scopedConfigPath);
  const pluginPattern = /^\[plugins\."[^"]+"\][^\n]*(?:\n(?!\[)[^\n]*)*/gmu;
  const pluginBlocks = scopedConfig.match(pluginPattern) || [];
  const baseWithoutPlugins = baseConfig.replace(pluginPattern, '').trimEnd();
  const nextConfig = [baseWithoutPlugins, ...pluginBlocks.map(block => block.trim())].filter(Boolean).join('\n\n');
  if (nextConfig) await fs.writeFile(scopedConfigPath, `${nextConfig}\n`);
};

const prepareScopedCodexHome = async ({ baseCodexHome, codexHome }) => {
  await fs.mkdir(codexHome, { recursive: true });
  await syncScopedConfig({ baseConfigPath: path.join(baseCodexHome, 'config.toml'), scopedConfigPath: path.join(codexHome, 'config.toml') });
  await syncFileIfPresent(path.join(baseCodexHome, 'auth.json'), path.join(codexHome, 'auth.json'));
  await syncFileIfPresent(path.join(baseCodexHome, 'installation_id'), path.join(codexHome, 'installation_id'));

  const marketplaceSource = path.join(baseCodexHome, '.tmp', 'plugins');
  const marketplaceSha = path.join(baseCodexHome, '.tmp', 'plugins.sha');
  try {
    await fs.access(marketplaceSource);
    await fs.access(marketplaceSha);
    await replaceWithRelativeSymlink({ source: marketplaceSource, target: path.join(codexHome, '.tmp', 'plugins') });
    await fs.copyFile(marketplaceSha, path.join(codexHome, '.tmp', 'plugins.sha'));
  } catch {
    throw new CodexCapabilityPreflightError(`The operator Codex marketplace snapshot is unavailable at ${marketplaceSource}. ` + `Run 'codex plugin list --available --json' once in the operator container, then retry.`);
  }
};

export const isCodexCapabilityStrict = (env = process.env) => /^(?:1|true|yes|on)$/iu.test(String(env.HIVE_MIND_CODEX_CAPABILITY_STRICT || ''));

export async function runCodexCapabilityPreflight(options = {}) {
  const { log = async () => {}, env = process.env } = options;
  try {
    return await provisionCodexCapabilities(options);
  } catch (error) {
    if (!(error instanceof CodexCapabilityPreflightError)) throw error;
    // Issue #2077: requirements are inferred from free-form issue prose, so a
    // preflight miss is a guess that failed rather than proof the task cannot
    // run. Aborting here discarded an otherwise healthy run because an aspect
    // ratio (`16:9`) was read as a skill name. Degrade to a warning and let
    // Codex execute with the operator's own capabilities.
    if (isCodexCapabilityStrict(env)) throw error;
    await log(`⚠️  Codex capability preflight skipped: ${error.message}`);
    await log('   Continuing with the operator Codex capabilities. Set HIVE_MIND_CODEX_CAPABILITY_STRICT=1 to fail instead.');
    return { required: false, degraded: true, error: error.message, plugins: [], codexHome: null };
  }
}

async function provisionCodexCapabilities({ owner, repo, issueNumber, projectDir, baseCodexHome = process.env.HIVE_MIND_PARENT_CODEX_HOME || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), codexPath = 'codex', runCommand = defaultRunCommand, log = async () => {} } = {}) {
  if (!owner || !repo || !issueNumber) return { required: false, plugins: [], codexHome: null };

  // `executeToolWithBun` uses a shell expression for execution. Preflight uses
  // execFile and therefore selects the installed Codex binary directly.
  const command = /\s/u.test(codexPath) ? 'codex' : codexPath;
  const requirementText = await readIssueRequirementText({ owner, repo, issueNumber, runCommand });
  const requirements = detectRequiredCodexCapabilities(requirementText);
  for (const { capability, line } of requirements.rejected || []) {
    await log(`   ⏭️  Ignored non-capability token '${capability}' from: ${line.slice(0, 160)}`, { verbose: true });
  }
  if (requirements.plugins.length === 0 && requirements.skills.length === 0) return { required: false, plugins: [], codexHome: null };

  await log(`🔌 Codex capability preflight: detected ${requirements.plugins.length} plugin and ${requirements.skills.length} skill requirement(s)`);
  for (const { capability, line } of requirements.evidence || []) {
    await log(`   🔎 '${capability}' detected from: ${line.slice(0, 160)}`, { verbose: true });
  }
  const baseEnv = { ...process.env, CODEX_HOME: baseCodexHome, HIVE_MIND_PARENT_CODEX_HOME: baseCodexHome };
  const baseCatalogResult = await runCommand({ command, args: ['plugin', 'list', '--available', '--json'], env: baseEnv });
  const baseCatalog = parseJsonCommand(baseCatalogResult, 'Codex plugin catalog discovery');
  const skillDirectories = [path.join(os.homedir(), '.agents', 'skills'), projectDir && path.join(projectDir, '.agents', 'skills')].filter(Boolean);
  const plugins = await resolveRequiredPlugins({ requirements, catalog: baseCatalog, skillDirectories });
  if (plugins.length === 0) {
    await log('   ✅ Required Agent Skills are already available from standard skill directories');
    return { required: true, plugins, skills: requirements.skills, codexHome: null, baseCodexHome };
  }

  const codexHome = buildCodexCapabilityStatePath({ baseCodexHome, owner, repo });
  await prepareScopedCodexHome({ baseCodexHome, codexHome });
  const scopedEnv = { ...process.env, CODEX_HOME: codexHome, HIVE_MIND_PARENT_CODEX_HOME: baseCodexHome };

  const scopedCatalogResult = await runCommand({ command, args: ['plugin', 'list', '--json'], env: scopedEnv });
  const scopedCatalog = parseJsonCommand(scopedCatalogResult, 'Repository-scoped Codex plugin discovery');
  const installed = new Set((scopedCatalog.installed || []).filter(plugin => plugin.installed && plugin.enabled).map(plugin => normalizePluginSelector(plugin.pluginId)));

  for (const plugin of plugins) {
    if (installed.has(plugin)) continue;
    const installResult = await runCommand({ command, args: ['plugin', 'add', plugin, '--json'], env: scopedEnv });
    parseJsonCommand(installResult, `Installing required Codex plugin ${plugin}`);
    await log(`   ✅ Provisioned ${plugin} in repository-scoped Codex state`);
  }

  const verifyResult = await runCommand({ command, args: ['plugin', 'list', '--json'], env: scopedEnv });
  const verifiedCatalog = parseJsonCommand(verifyResult, 'Codex capability verification');
  const verified = new Set((verifiedCatalog.installed || []).filter(plugin => plugin.installed && plugin.enabled).map(plugin => normalizePluginSelector(plugin.pluginId)));
  const unverified = plugins.filter(plugin => !verified.has(plugin));
  if (unverified.length > 0) throw new CodexCapabilityPreflightError(`Codex capability installation did not verify successfully: ${unverified.join(', ')}`, { missing: unverified });

  await log(`   Codex capability state: ${codexHome}`, { verbose: true });
  return { required: true, plugins, skills: requirements.skills, codexHome, baseCodexHome };
}

export default { applyCodexCapabilityEnv, detectRequiredCodexCapabilities, isCapabilityName, runCodexCapabilityPreflight };
