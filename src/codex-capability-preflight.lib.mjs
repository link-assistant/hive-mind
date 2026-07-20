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

import { CODEX_PLUGIN_CLI, buildPluginCachePath as buildAgentPluginCachePath, buildPluginPayloadRepairs, pluginIdParts, readMaterializedPluginSkills as readAgentMaterializedPluginSkills, repairPluginPayloads } from './agent-plugin-cache.lib.mjs';

const execFileAsync = promisify(execFile);
const REQUIREMENT_WORDS = /\b(?:depend(?:s|ency)?|install|invoke|mandatory|must|need(?:ed|s)?|preflight|required?|requires|use)\b/i;
const NEGATED_REQUIREMENT = /\b(?:does\s+not\s+require|not\s+required|optional)\b/i;
// `(?!\.[a-z])` keeps email addresses and hostnames (`ops@example.com`) out of
// the plugin selector space.
const PLUGIN_SELECTOR = /\b([a-z0-9][a-z0-9-]*@[a-z0-9][a-z0-9-]*(?:-remote)?)\b(?!\.[a-z])/gi;
const NAMESPACED_SKILL = /\b([a-z0-9][a-z0-9-]*:[a-z0-9][a-z0-9-]*)\b/gi;
const EXPLICIT_BARE_SKILL = /\$([a-z0-9][a-z0-9-]*)|`([a-z0-9][a-z0-9-]*)`\s+(?:agent\s+)?skill/gi;
const CAPABILITY_PREFIX = /\b(?:depend(?:s|ed)?\s+on|install|invoke|must\s+(?:install|invoke|use)|need(?:ed|s)?(?:\s+to)?(?:\s+(?:install|invoke|use))?|require(?:d|s)?(?:\s+to)?(?:\s+(?:install|invoke|use))?|use)\s+(?:(?:the|an?)\s+)?(?:(?:agent\s+)?skill\s+)?(?:named\s+)?[`$]?$/i;
const CAPABILITY_SUFFIX = /^`?\s+(?:agent\s+)?(?:skill|capability)\b/i;
const STRUCTURED_DATA_VALUES = new Set(['array', 'boolean', 'false', 'integer', 'null', 'number', 'object', 'string', 'true']);

// Issue #2077: a capability name must contain at least one letter.
//
// The Agent Skills specification (agentskills.io/specification) allows a
// leading digit — `3d-rendering` is a legal skill name — so requiring a leading
// letter would be stricter than the spec. Requiring only that *some* letter is
// present stays spec-compliant while rejecting the purely numeric prose tokens
// the requirement regexes otherwise capture: aspect ratios (`16:9`), clock
// times (`9:30`), host ports (`localhost:3000`), version selectors (`node@20`)
// and currency amounts (`$100`).
//
// Charset follows the spec for skills (`a-z`, `0-9`, `-`) plus the underscore
// that codex-rs `validate_plugin_segment` accepts for plugin and marketplace
// segments.
const CAPABILITY_TOKEN = /^(?=[a-z0-9_-]*[a-z])[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u;

// Prose and markdown routinely produce `word:word` and `$word` tokens that are
// never capability references. Excluding them keeps a heuristic scan of free
// text from inventing requirements.
const PROSE_TOKENS = new Set(['agent', 'caution', 'codex', 'default', 'error', 'example', 'file', 'fixme', 'format', 'home', 'http', 'https', 'id', 'important', 'input', 'key', 'line', 'name', 'nb', 'note', 'output', 'path', 'ref', 'required', 'see', 'skill', 'the', 'tip', 'todo', 'type', 'url', 'usage', 'value', 'warning']);

const isCapabilityToken = value => CAPABILITY_TOKEN.test(value) && !PROSE_TOKENS.has(value);

const hasExplicitCapabilityContext = (line, match) => {
  const before = line.slice(0, match.index);
  const after = line.slice(match.index + match[0].length);
  if (CAPABILITY_SUFFIX.test(after) || before.endsWith('$')) return true;
  const value = match[1].slice(match[1].indexOf(':') + 1).toLowerCase();
  return !STRUCTURED_DATA_VALUES.has(value) && CAPABILITY_PREFIX.test(before);
};

const hasExplicitPluginContext = (line, match) => {
  const before = line.slice(0, match.index);
  const after = line.slice(match.index + match[0].length);
  const marketplace = match[1].slice(match[1].indexOf('@') + 1);
  return /(?:^|-)(?:bundled|curated|marketplace|remote)(?:-|$)/iu.test(marketplace) || /\bplugin\s+[`$]?$/iu.test(before) || /^`?\s+plugin\b/iu.test(after);
};

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
  // Issue #2088: a fully qualified reference — `plugin@marketplace` in plugin
  // context, or `plugin:skill` in requirement context — names a capability that
  // prose cannot produce by accident, so an unrepairable failure for one of
  // these is a real blocker. A bare `$name` or `` `name` skill `` token is a
  // guess about free text and stays advisory, which keeps issue #2077's
  // false-positive protection intact.
  const explicit = new Set();
  // Every accepted capability keeps the line it came from so `--verbose` can
  // explain a detection instead of only reporting its consequence (issue #2077).
  const evidence = [];
  const rejected = [];

  const accept = (target, value, line, { qualified = false } = {}) => {
    if (!isCapabilityName(value)) {
      rejected.push({ capability: value, line });
      return;
    }
    target.add(value);
    if (qualified) explicit.add(value);
    evidence.push({ capability: value, line, explicit: qualified });
  };

  for (const rawLine of String(text || '').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || !REQUIREMENT_WORDS.test(line) || NEGATED_REQUIREMENT.test(line)) continue;

    for (const match of line.matchAll(PLUGIN_SELECTOR)) {
      const selector = normalizePluginSelector(match[1]);
      if (hasExplicitPluginContext(line, match)) accept(plugins, selector, line, { qualified: true });
      else rejected.push({ capability: selector, line });
    }
    for (const match of line.matchAll(NAMESPACED_SKILL)) {
      const skill = match[1].toLowerCase();
      if (hasExplicitCapabilityContext(line, match)) accept(skills, skill, line, { qualified: true });
      else rejected.push({ capability: skill, line });
    }
    for (const match of line.matchAll(EXPLICIT_BARE_SKILL)) accept(skills, (match[1] || match[2]).toLowerCase(), line);
  }

  return { plugins: [...plugins].sort(), skills: [...skills].sort(), explicit: [...explicit].sort(), evidence, rejected };
}

export const isExplicitRequirement = (requirements, capability) => (requirements?.explicit || []).includes(String(capability || '').toLowerCase());

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

// Issue #2084: `codex plugin list` reports enablement, not model visibility.
//
// Codex renders the skills the model can actually see into a
// `<skills_instructions>` block in the prompt. `codex debug prompt-input`
// prints that prompt, so parsing the block is the only client-side signal that
// matches what the model receives. Entries are rendered as
// `- <name>: <description> (file: <path>)`, where `<name>` is bare for skills
// under `$CODEX_HOME/skills` and `<plugin>:<skill>` for plugin-provided ones.
const SKILLS_INSTRUCTIONS_BLOCK = /<skills_instructions>([\s\S]*?)<\/skills_instructions>/u;
const SKILL_CATALOG_ENTRY = /(?:^|\\n)\s*-\s+([a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)\s*:/giu;

export const parseModelVisibleSkills = (promptInput = '') => {
  // `codex debug prompt-input` emits JSON, so newlines inside the prompt arrive
  // as the two-character escape `\n`. Match both that and real newlines.
  const block = SKILLS_INSTRUCTIONS_BLOCK.exec(String(promptInput).replace(/\r\n/gu, '\n').replace(/\n/gu, '\\n'));
  if (!block) return null;
  const skills = new Set();
  for (const match of block[1].matchAll(SKILL_CATALOG_ENTRY)) skills.add(match[1].toLowerCase());
  return skills;
};

// Verification is advisory when the probe itself cannot run: an older Codex
// without `debug prompt-input`, or a sandbox that blocks it, must not fail a
// run that the previous verification would have allowed.
const readModelVisibleSkills = async ({ command, env, runCommand, log }) => {
  const result = await runCommand({ command, args: ['debug', 'prompt-input', 'hive-mind capability probe'], env });
  if (result.code !== 0) {
    await log(
      `   ⚠️  Could not read the model-visible skill catalog: ${String(result.stderr || result.stdout)
        .trim()
        .slice(0, 200)}`,
      { verbose: true }
    );
    return null;
  }
  const skills = parseModelVisibleSkills(result.stdout);
  if (!skills) await log('   ⚠️  Codex prompt did not contain a <skills_instructions> block; skipping skill visibility verification', { verbose: true });
  return skills;
};

// `status: 'unknown'` keeps the probe advisory when it cannot run at all;
// `status: 'missing'` is a fact about the prompt the model would receive.
const checkModelVisibleSkills = async ({ command, env, runCommand, log, requiredSkills }) => {
  if (!requiredSkills || requiredSkills.length === 0) return { status: 'satisfied', visible: null, missing: [] };
  const visible = await readModelVisibleSkills({ command, env, runCommand, log });
  if (!visible) return { status: 'unknown', visible: null, missing: [] };

  await log(`   🔎 Model-visible skills (${visible.size}): ${[...visible].sort().join(', ') || 'none'}`, { verbose: true });
  const missing = requiredSkills.filter(skill => !visible.has(skill.toLowerCase()));
  return { status: missing.length === 0 ? 'satisfied' : 'missing', visible, missing };
};

const skillVisibilityError = ({ missing, visible, requirements, repairs = [] }) => new CodexCapabilityPreflightError(`Codex reports the required plugins as installed, but the model cannot see: ${missing.join(', ')}. ` + `A plugin must survive Codex loader reconciliation and have a valid payload under ` + `CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills before its skills are exposed. ` + `Visible skills were: ${visible ? [...visible].sort().join(', ') || 'none' : 'unknown'}.` + (repairs.length > 0 ? ` Attempted repairs: ${repairs.join(', ')}.` : ''), { missing, failClosed: missing.some(skill => isExplicitRequirement(requirements, skill)) });

const verifyModelVisibleSkills = async ({ command, env, runCommand, log, requiredSkills, requirements }) => {
  const outcome = await checkModelVisibleSkills({ command, env, runCommand, log, requiredSkills });
  if (outcome.status === 'unknown') return outcome;
  if (outcome.status === 'satisfied') {
    if (requiredSkills?.length) await log(`   ✅ Verified ${requiredSkills.length} required skill(s) are visible to the model`);
    return outcome;
  }
  throw skillVisibilityError({ missing: outcome.missing, visible: outcome.visible, requirements });
};

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

// Issue #2088: repairing a payload requires knowing *which* plugin is expected
// to provide each required skill, so resolution reports the mapping rather than
// only the set of plugin selectors.
export async function resolveRequiredCapabilities({ requirements, catalog, skillDirectories = [] }) {
  const entries = catalogEntries(catalog);
  const byId = new Map(entries.map(entry => [normalizePluginSelector(entry.pluginId), entry]));
  const selected = new Map();
  const providers = new Map();
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
    if (provider) {
      selected.set(normalizePluginSelector(provider.pluginId), provider);
      providers.set(skill, { pluginId: normalizePluginSelector(provider.pluginId), pluginName: provider.name || skillParts(skill).namespace, skillName: skillParts(skill).name });
    } else missing.push(skill);
  }

  if (missing.length > 0) {
    // A missing capability that the issue named explicitly is a blocker; one
    // inferred from prose is a guess that failed (issues #2077 and #2088).
    // Only `plugin@marketplace` selectors qualify here: at this point nothing
    // has corroborated the detection, and a `plugin:skill` token the catalog has
    // never heard of is more likely a false positive (issue #2080) than a real
    // requirement. Once the catalog *does* resolve the provider, a skill that
    // repair cannot materialize does fail closed further down.
    const explicitMissing = missing.filter(capability => isExplicitRequirement(requirements, capability) && capability.includes('@'));
    throw new CodexCapabilityPreflightError(`Required Codex capability unavailable: ${missing.join(', ')}. ` + `Run 'codex plugin list --available --json' in the operator container and configure a marketplace that provides it. ` + `Hive Mind installs discovered capabilities into repository-scoped CODEX_HOME state; it does not enable plugins globally.`, { missing, failClosed: explicitMissing.length > 0 });
  }

  return { plugins: [...selected.keys()].sort(), providers };
}

export async function resolveRequiredPlugins(options) {
  return (await resolveRequiredCapabilities(options)).plugins;
}

const readIssueRequirementText = async ({ owner, repo, issueNumber, runCommand, env }) => {
  const issueResult = await runCommand({ command: 'gh', args: ['api', `repos/${owner}/${repo}/issues/${issueNumber}`], env });
  const issue = parseJsonCommand(issueResult, 'Codex capability issue discovery');
  const commentsResult = await runCommand({ command: 'gh', args: ['api', `repos/${owner}/${repo}/issues/${issueNumber}/comments`, '--paginate'], env });
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

const setTomlTableBoolean = ({ config, table, key, value }) => {
  const lines = String(config || '')
    .replace(/\r\n/gu, '\n')
    .split('\n');
  const tableHeader = `[${table}]`;
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const keyPattern = new RegExp(`^(\\s*${escapedKey}\\s*=\\s*)(?:true|false)(\\s*(?:#.*)?)$`, 'iu');
  const nextTablePattern = /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/u;
  const tableStart = lines.findIndex(line => line.trim().split(/\s+#/u, 1)[0] === tableHeader);

  if (tableStart === -1) {
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    if (lines.length > 0) lines.push('');
    lines.push(tableHeader, `${key} = ${value}`, '');
    return lines.join('\n');
  }

  let tableEnd = lines.length;
  for (let index = tableStart + 1; index < lines.length; index++) {
    if (nextTablePattern.test(lines[index])) {
      tableEnd = index;
      break;
    }
  }
  for (let index = tableStart + 1; index < tableEnd; index++) {
    if (keyPattern.test(lines[index])) {
      lines[index] = lines[index].replace(keyPattern, `$1${value}$2`);
      return `${lines.join('\n').trimEnd()}\n`;
    }
  }
  lines.splice(tableEnd, 0, `${key} = ${value}`);
  return `${lines.join('\n').trimEnd()}\n`;
};

// Codex's authenticated remote global catalog owns the reserved
// `openai-curated` marketplace. In codex-rs 0.144.6 the prompt loader removes
// every locally configured plugin from that marketplace before merging remote
// installations. Hive provisions the local marketplace payload, so the scoped
// home must select that local catalog or plugin list and prompt assembly report
// contradictory states (issue #2094). This override is deliberately scoped to
// runs that selected a local curated plugin; personal marketplaces retain the
// operator's remote catalog setting.
const configureScopedPluginLoader = async ({ codexHome, plugins, log }) => {
  const localCurated = plugins.filter(plugin => pluginIdParts(plugin).marketplace === 'openai-curated');
  if (localCurated.length === 0) return;
  const configPath = path.join(codexHome, 'config.toml');
  const config = await readIfPresent(configPath);
  const nextConfig = setTomlTableBoolean({ config, table: 'features', key: 'remote_plugin', value: false });
  if (nextConfig !== config) await fs.writeFile(configPath, nextConfig);
  await log(`   🧭 Scoped Codex loader: remote_plugin=false for ${localCurated.join(', ')}; an authenticated remote catalog otherwise removes local @openai-curated entries before prompt assembly`, { verbose: true });
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

// --- issue #2088: repair the repository-scoped plugin payload ----------------
//
// `codex plugin list` reporting `installed, enabled` proves only that
// `config.toml` declares the plugin and that Codex could resolve a source for
// it. The skill loader reads
// `CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills`, so a
// scoped home whose cache is missing or stale exposes zero skills while every
// enablement check passes. Reproduced end to end with a real Codex CLI in
// experiments/issue-2088/reproduce-cache-repair.sh.

export const buildPluginCachePath = ({ codexHome, pluginId }) => buildAgentPluginCachePath({ agentHome: codexHome, pluginId: normalizePluginSelector(pluginId) });

export const readMaterializedPluginSkills = ({ codexHome, pluginId }) => readAgentMaterializedPluginSkills({ agentHome: codexHome, pluginId: normalizePluginSelector(pluginId) });

// `codex plugin remove` also drops the `[plugins."…"]` block, so a payload
// restored by copying it back in has to be re-declared to stay enabled.
const enablePluginInScopedConfig = async ({ agentHome: codexHome, pluginId }) => {
  const configPath = path.join(codexHome, 'config.toml');
  const config = await readIfPresent(configPath);
  if (new RegExp(`^\\[plugins\\."${pluginId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}"\\]`, 'mu').test(config)) return;
  await fs.writeFile(configPath, `${config.trimEnd()}\n\n[plugins."${pluginId}"]\nenabled = true\n`);
};

const PLUGIN_PAYLOAD_REPAIRS = buildPluginPayloadRepairs({
  cli: CODEX_PLUGIN_CLI,
  onInstalled: ({ result, pluginId }) => parseJsonCommand(result, `Installing required Codex plugin ${pluginId}`),
  onCopied: enablePluginInScopedConfig,
});

// The provider map answers "which plugin must expose which skill", which is
// what turns a payload listing into a health verdict.
const expectedSkillsByPlugin = providers => {
  const expected = new Map();
  for (const provider of providers?.values() || []) {
    const skill = `${pluginIdParts(provider.pluginId).name}:${provider.skillName}`.toLowerCase();
    expected.set(provider.pluginId, [...(expected.get(provider.pluginId) || []), skill]);
  }
  return expected;
};

export const repairScopedPluginPayloads = ({ command, env, runCommand, log, codexHome, baseCodexHome, plugins, providers, strategies = PLUGIN_PAYLOAD_REPAIRS, force = false }) => repairPluginPayloads({ command, env, runCommand, log, agentHome: codexHome, copyFrom: baseCodexHome, plugins, expectedSkills: expectedSkillsByPlugin(providers), strategies, force, label: 'repository-scoped Codex' });

export const isCodexCapabilityStrict = (env = process.env) => /^(?:1|true|yes|on)$/iu.test(String(env.HIVE_MIND_CODEX_CAPABILITY_STRICT || ''));

// Issue #2088: explicitly declared capabilities fail closed. This escape hatch
// restores the previous advisory-only behaviour for an operator who would
// rather run degraded than not at all.
export const isCodexCapabilityAdvisory = (env = process.env) => /^(?:1|true|yes|on)$/iu.test(String(env.HIVE_MIND_CODEX_CAPABILITY_ADVISORY || ''));

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
    // Issue #2088: that reasoning does not extend to a capability the issue
    // named explicitly and that repair could not materialize. Continuing there
    // spends a full solver run that is already known to be unable to satisfy
    // the task, so an explicit requirement fails closed before `codex exec`.
    if (error.details?.failClosed && !isCodexCapabilityAdvisory(env)) {
      await log(`❌ Codex capability preflight failed: ${error.message}`);
      await log('   The issue names this capability explicitly, so Codex was not started. Set HIVE_MIND_CODEX_CAPABILITY_ADVISORY=1 to run degraded instead.');
      throw error;
    }
    await log(`⚠️  Codex capability preflight skipped: ${error.message}`);
    await log('   Continuing with the operator Codex capabilities. Set HIVE_MIND_CODEX_CAPABILITY_STRICT=1 to fail instead.');
    return { required: false, degraded: true, error: error.message, plugins: [], codexHome: null };
  }
}

async function provisionCodexCapabilities({ owner, repo, issueNumber, projectDir, env = process.env, baseCodexHome = env.HIVE_MIND_PARENT_CODEX_HOME || env.CODEX_HOME || path.join(os.homedir(), '.codex'), codexPath = 'codex', runCommand = defaultRunCommand, log = async () => {} } = {}) {
  if (!owner || !repo || !issueNumber) return { required: false, plugins: [], codexHome: null };

  // `executeToolWithBun` uses a shell expression for execution. Preflight uses
  // execFile and therefore selects the installed Codex binary directly.
  const command = /\s/u.test(codexPath) ? 'codex' : codexPath;
  const requirementText = await readIssueRequirementText({ owner, repo, issueNumber, runCommand, env });
  const requirements = detectRequiredCodexCapabilities(requirementText);
  for (const { capability, line } of requirements.rejected || []) {
    await log(`   ⏭️  Ignored non-capability token '${capability}' from: ${line.slice(0, 160)}`, { verbose: true });
  }
  if (requirements.plugins.length === 0 && requirements.skills.length === 0) return { required: false, plugins: [], codexHome: null };

  await log(`🔌 Codex capability preflight: detected ${requirements.plugins.length} plugin and ${requirements.skills.length} skill requirement(s)`);
  for (const { capability, line } of requirements.evidence || []) {
    await log(`   🔎 '${capability}' detected from: ${line.slice(0, 160)}`, { verbose: true });
  }
  // Every Codex-side preflight operation runs from the checkout that the
  // solver will enter. Besides matching `codex exec`, this keeps any future
  // repository-local discovery deterministic without relying on Hive's launch
  // directory (issue #2094).
  const runCodexCommand = invocation => runCommand({ ...invocation, cwd: projectDir });
  const baseEnv = { ...env, CODEX_HOME: baseCodexHome, HIVE_MIND_PARENT_CODEX_HOME: baseCodexHome };
  const baseCatalogResult = await runCodexCommand({ command, args: ['plugin', 'list', '--available', '--json'], env: baseEnv });
  const baseCatalog = parseJsonCommand(baseCatalogResult, 'Codex plugin catalog discovery');
  const skillDirectories = [path.join(os.homedir(), '.agents', 'skills'), projectDir && path.join(projectDir, '.agents', 'skills')].filter(Boolean);
  const { plugins, providers } = await resolveRequiredCapabilities({ requirements, catalog: baseCatalog, skillDirectories });
  for (const plugin of plugins) {
    await log(`   ✅ Verified ${plugin} in the Codex plugin catalog`, { verbose: true });
  }
  if (plugins.length === 0) {
    await log('   ✅ Required Agent Skills are already available from standard skill directories');
    await verifyModelVisibleSkills({ command, env: baseEnv, runCommand: runCodexCommand, log, requiredSkills: requirements.skills, requirements });
    return { required: true, plugins, skills: requirements.skills, codexHome: null, baseCodexHome };
  }

  const codexHome = buildCodexCapabilityStatePath({ baseCodexHome, owner, repo });
  await prepareScopedCodexHome({ baseCodexHome, codexHome });
  await configureScopedPluginLoader({ codexHome, plugins, log });
  const scopedEnv = { ...env, CODEX_HOME: codexHome, HIVE_MIND_PARENT_CODEX_HOME: baseCodexHome };

  // Issue #2088: install *and repair*. Enablement recorded in the scoped
  // `config.toml` survives a container restart while the payload under
  // `plugins/cache` may not, and `codex plugin list` cannot tell those states
  // apart — so the payload itself is the thing that gets checked and rebuilt.
  const repair = await repairScopedPluginPayloads({ command, env: scopedEnv, runCommand: runCodexCommand, log, codexHome, baseCodexHome, plugins, providers });
  for (const entry of repair.report) {
    if (entry.healthy) await log(`   ✅ Provisioned ${entry.pluginId} in repository-scoped Codex state`);
  }

  const verifyResult = await runCodexCommand({ command, args: ['plugin', 'list', '--json'], env: scopedEnv });
  const verifiedCatalog = parseJsonCommand(verifyResult, 'Codex capability verification');
  const verified = new Set((verifiedCatalog.installed || []).filter(plugin => plugin.installed && plugin.enabled).map(plugin => normalizePluginSelector(plugin.pluginId)));
  const unverified = plugins.filter(plugin => !verified.has(plugin));
  if (unverified.length > 0) {
    const blockedSkills = repair.unhealthy.flatMap(entry => entry.missing);
    throw new CodexCapabilityPreflightError(`Codex capability installation did not verify successfully: ${unverified.join(', ')}. ` + (blockedSkills.length > 0 ? `The required skills ${blockedSkills.join(', ')} are therefore unavailable. ` : '') + `Expected the plugin payload under CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills in ${codexHome}. ` + `Attempted repairs: ${repair.applied.join(', ') || 'none'}.`, {
      missing: unverified,
      failClosed: unverified.some(plugin => isExplicitRequirement(requirements, plugin)) || blockedSkills.some(skill => isExplicitRequirement(requirements, skill)),
    });
  }

  // Issue #2084: enablement is not exposure. The failing run reached this point
  // with `superpowers@openai-curated` reported as "installed, enabled" while
  // the model saw zero `superpowers:*` skills, so the run proceeded and then
  // stalled on the repository's mandatory preflight. Confirm the requirement
  // against the catalog the model actually receives.
  let visibility = await checkModelVisibleSkills({ command, env: scopedEnv, runCommand: runCodexCommand, log, requiredSkills: requirements.skills });
  if (visibility.status === 'missing') {
    // The payload looks materialized but the prompt disagrees: rebuild it from
    // scratch and re-probe before deciding (issue #2088).
    await log(`   🛠️  Model cannot see ${visibility.missing.join(', ')}; forcing a repository-scoped plugin payload rebuild`);
    const forced = await repairScopedPluginPayloads({ command, env: scopedEnv, runCommand: runCodexCommand, log, codexHome, baseCodexHome, plugins, providers, strategies: PLUGIN_PAYLOAD_REPAIRS.slice(1), force: true });
    repair.applied.push(...forced.applied);
    visibility = await checkModelVisibleSkills({ command, env: scopedEnv, runCommand: runCodexCommand, log, requiredSkills: requirements.skills });
  }
  if (visibility.status === 'missing') throw skillVisibilityError({ missing: visibility.missing, visible: visibility.visible, requirements, repairs: repair.applied });
  if (visibility.status === 'unknown' && repair.unhealthy.length > 0) {
    // Without the probe the materialized payload is the only evidence there is.
    const missing = repair.unhealthy.flatMap(entry => (entry.missing.length > 0 ? entry.missing : [entry.pluginId]));
    throw new CodexCapabilityPreflightError(`Repository-scoped Codex plugin payload could not be materialized for: ${missing.join(', ')}. ` + `Expected skills under CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>/skills in ${codexHome}. ` + `Attempted repairs: ${repair.applied.join(', ') || 'none'}.`, { missing, failClosed: missing.some(capability => isExplicitRequirement(requirements, capability)) });
  }
  if (visibility.status === 'satisfied' && requirements.skills.length > 0) await log(`   ✅ Verified ${requirements.skills.length} required skill(s) are visible to the model`);

  await log(`   Codex capability state: ${codexHome}`, { verbose: true });
  return { required: true, plugins, skills: requirements.skills, codexHome, baseCodexHome, repairs: repair.applied };
}

export default {
  applyCodexCapabilityEnv,
  buildPluginCachePath,
  detectRequiredCodexCapabilities,
  isCapabilityName,
  isExplicitRequirement,
  readMaterializedPluginSkills,
  repairScopedPluginPayloads,
  resolveRequiredCapabilities,
  runCodexCapabilityPreflight,
};
