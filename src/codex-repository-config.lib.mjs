/**
 * Per-task Codex configuration derived from the checked-out repository (issue #3785).
 *
 * Codex only reads a repository's `.codex/config.toml` when the project is
 * trusted, and trusting a checkout wholesale would let it replace the model
 * provider, base URL or sandbox policy of the operator account. Instead, an
 * allowlisted subset is copied into the disposable per-task CODEX_HOME:
 *
 *   - `mcp_servers.*` the repository declares (never replacing an operator
 *     server such as the default Playwright registration);
 *   - `[[skills.config]]` entries whose path stays inside the checkout;
 *   - `[plugins."name@marketplace"] enabled = true` declarations, returned as
 *     advisory plugin requirements so the existing scoped installer provisions
 *     them for this task only.
 *
 * Bundled Codex system skills are disabled per task by default ("no skills or
 * plugins by default"). `HIVE_MIND_CODEX_SYSTEM_SKILLS=1` restores the previous
 * behaviour, and a system skill the task explicitly requires stays enabled.
 * Nothing here writes outside the task's own CODEX_HOME.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

import { CODEX_STOCK_SKILLS } from './codex-stock-skills.lib.mjs';

export const REPOSITORY_CODEX_CONFIG = path.join('.codex', 'config.toml');
const MAX_REPOSITORY_CONFIG_BYTES = 256 * 1024;
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/iu;
const SERVER_NAME = /^[a-z0-9][a-z0-9_-]*$/iu;

/** Names of the system skills bundled with the pinned Codex CLI. */
export const CODEX_SYSTEM_SKILL_NAMES = Object.freeze(
  [
    ...new Set(
      Object.keys(CODEX_STOCK_SKILLS.files)
        .filter(file => /^[^/]+\/SKILL\.md$/u.test(file))
        .map(file => file.split('/')[0])
    ),
  ].sort()
);

export const isCodexSystemSkillsEnabled = (env = process.env) => /^(?:1|true|yes|on)$/iu.test(String(env?.HIVE_MIND_CODEX_SYSTEM_SKILLS || ''));

const isWithin = (candidate, root) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const realpathOrNull = async target => {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);

/**
 * Read the allowlisted subset of `<projectDir>/.codex/config.toml`. A missing
 * file is an empty declaration; an unreadable, oversized, escaping or malformed
 * file is reported as a warning and ignored, so a repository can never break the
 * task or widen its authority through this file.
 */
export async function readRepositoryCodexConfig({ projectDir } = {}) {
  const empty = { mcpServers: {}, skillConfigs: [], plugins: [], warnings: [], found: false };
  if (!projectDir) return empty;
  const root = await realpathOrNull(projectDir);
  const file = path.join(projectDir, REPOSITORY_CODEX_CONFIG);
  const canonical = await realpathOrNull(file);
  if (!root || !canonical) return empty;
  if (!isWithin(canonical, root)) return { ...empty, found: true, warnings: [`${REPOSITORY_CODEX_CONFIG} resolves outside the checkout and was ignored.`] };
  let parsed;
  try {
    const info = await fs.stat(canonical);
    if (!info.isFile() || info.size > MAX_REPOSITORY_CONFIG_BYTES) return { ...empty, found: true, warnings: [`${REPOSITORY_CODEX_CONFIG} is not a regular file under ${MAX_REPOSITORY_CONFIG_BYTES} bytes and was ignored.`] };
    parsed = parseToml(await fs.readFile(canonical, 'utf8'));
  } catch {
    // TOML diagnostics may quote values; keep them out of task logs.
    return { ...empty, found: true, warnings: [`${REPOSITORY_CODEX_CONFIG} is not valid TOML and was ignored.`] };
  }

  const warnings = [];
  const mcpServers = {};
  for (const [name, server] of Object.entries(isPlainObject(parsed.mcp_servers) ? parsed.mcp_servers : {})) {
    if (SERVER_NAME.test(name) && isPlainObject(server) && (typeof server.command === 'string' || typeof server.url === 'string')) mcpServers[name] = server;
    else warnings.push(`MCP server '${String(name).slice(0, 80)}' in ${REPOSITORY_CODEX_CONFIG} has no command or url and was ignored.`);
  }

  const skillConfigs = [];
  const declaredSkills = parsed.skills?.config;
  for (const entry of Array.isArray(declaredSkills) ? declaredSkills : []) {
    if (!isPlainObject(entry) || typeof entry.path !== 'string' || typeof entry.enabled !== 'boolean') continue;
    const resolved = path.resolve(path.dirname(file), entry.path);
    const canonicalSkill = (await realpathOrNull(resolved)) || resolved;
    if (isWithin(canonicalSkill, root)) skillConfigs.push({ path: canonicalSkill, enabled: entry.enabled });
    else warnings.push(`A skills.config path in ${REPOSITORY_CODEX_CONFIG} points outside the checkout and was ignored.`);
  }

  const plugins = Object.entries(isPlainObject(parsed.plugins) ? parsed.plugins : {})
    .filter(([id, value]) => PLUGIN_ID.test(id) && isPlainObject(value) && value.enabled === true)
    .map(([id]) => id.toLowerCase())
    .sort();

  const ignoredKeys = Object.keys(parsed).filter(key => !['mcp_servers', 'skills', 'plugins'].includes(key));
  if (ignoredKeys.length > 0) warnings.push(`${REPOSITORY_CODEX_CONFIG} keys ${ignoredKeys.sort().join(', ')} were not applied: they could change account, provider or sandbox authority.`);
  return { mcpServers, skillConfigs, plugins, warnings, found: true };
}

/**
 * Apply the per-task skill policy and the repository declaration to the scoped
 * `config.toml`. Returns what was applied, for logging and tests.
 */
export async function applyRepositoryCodexConfig({ codexHome, projectDir, env = process.env, requiredSkills = [], repositoryConfig, log = async () => {} } = {}) {
  const declaration = repositoryConfig || (await readRepositoryCodexConfig({ projectDir }));
  const configPath = path.join(codexHome, 'config.toml');
  let config = {};
  try {
    config = parseToml(await fs.readFile(configPath, 'utf8'), { integersAsBigInt: 'asNeeded' });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const servers = isPlainObject(config.mcp_servers) ? config.mcp_servers : {};
  const addedServers = [];
  const shadowedServers = [];
  for (const [name, server] of Object.entries(declaration.mcpServers)) {
    if (Object.hasOwn(servers, name)) shadowedServers.push(name);
    else {
      servers[name] = server;
      addedServers.push(name);
    }
  }
  if (Object.keys(servers).length > 0) config.mcp_servers = servers;

  const skillEntries = [];
  const required = new Set(requiredSkills.map(skill => String(skill).toLowerCase()));
  const disabledSystemSkills = isCodexSystemSkillsEnabled(env) ? [] : CODEX_SYSTEM_SKILL_NAMES.filter(name => !required.has(name));
  const homes = [...new Set([codexHome, (await realpathOrNull(codexHome)) || codexHome])];
  for (const name of disabledSystemSkills) {
    for (const home of homes) skillEntries.push({ path: path.join(home, 'skills', '.system', name, 'SKILL.md'), enabled: false });
  }
  skillEntries.push(...declaration.skillConfigs);
  const existing = isPlainObject(config.skills) && Array.isArray(config.skills.config) ? config.skills.config : [];
  const seen = new Set(existing.map(entry => entry?.path));
  const appended = skillEntries.filter(entry => !seen.has(entry.path) && seen.add(entry.path));
  if (appended.length > 0) config.skills = { ...(isPlainObject(config.skills) ? config.skills : {}), config: [...existing, ...appended] };

  await fs.writeFile(configPath, stringifyToml(config));
  for (const warning of declaration.warnings) await log(`   ⚠️  ${warning}`);
  if (addedServers.length > 0) await log(`   🔌 Repository MCP servers enabled for this task only: ${addedServers.join(', ')}`);
  if (shadowedServers.length > 0) await log(`   ⏭️  Repository MCP servers not applied because the operator already defines them: ${shadowedServers.join(', ')}`);
  if (declaration.plugins.length > 0) await log(`   🔌 Repository Codex plugins requested by ${REPOSITORY_CODEX_CONFIG}: ${declaration.plugins.join(', ')}`);
  await log(`   🧩 Codex system skills: ${disabledSystemSkills.length > 0 ? `disabled for this task (${disabledSystemSkills.join(', ')}); set HIVE_MIND_CODEX_SYSTEM_SKILLS=1 to keep them` : 'enabled'}`, { verbose: true });
  return { addedServers, shadowedServers, disabledSystemSkills, repositorySkillConfigs: declaration.skillConfigs.length, plugins: declaration.plugins };
}

/**
 * Switch off skills the task must not see, in the task's own CODEX_HOME only
 * (issue #4057).
 *
 * Codex also discovers user-level (`$HOME/.agents/skills`) and admin-level
 * (`/etc/codex/skills`) skills, which a per-task CODEX_HOME does not cover.
 * Failing every run because the host has such a skill installed broke
 * repositories whose own skills were fine; leaving the skill enabled would
 * leak host instructions into the task. A `[[skills.config]] enabled = false`
 * entry for each refused file, keyed by both the path Codex rendered and its
 * canonical target and placed after any other matching entry (Codex applies
 * the last match), removes it from the model-visible catalog. The caller
 * re-probes the catalog afterwards and still fails closed if anything remains.
 *
 * Returns the skills that received a new or changed entry; an empty result
 * means nothing more can be done from configuration.
 */
export async function disableScopedCodexSkills({ codexHome, skills = [] } = {}) {
  if (!codexHome || skills.length === 0) return [];
  const configPath = path.join(codexHome, 'config.toml');
  let config = {};
  try {
    config = parseToml(await fs.readFile(configPath, 'utf8'), { integersAsBigInt: 'asNeeded' });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let entries = isPlainObject(config.skills) && Array.isArray(config.skills.config) ? [...config.skills.config] : [];
  const disabled = [];
  // Codex applies the last `[[skills.config]]` entry that matches a skill, by
  // `path` or by `name`, so the disabling entry must be the last match.
  const lastMatch = (target, name) => entries.findLast(entry => entry?.path === target || (typeof entry?.name === 'string' && entry.name.toLowerCase() === name));
  for (const skill of skills) {
    let changed = false;
    for (const target of new Set([skill.path, skill.canonical].filter(Boolean))) {
      const last = lastMatch(target, String(skill.name || '').toLowerCase());
      if (last?.path === target && last.enabled === false) continue;
      entries = entries.filter(entry => entry?.path !== target);
      entries.push({ path: target, enabled: false });
      changed = true;
    }
    if (changed) disabled.push(skill);
  }
  if (disabled.length === 0) return [];
  config.skills = { ...(isPlainObject(config.skills) ? config.skills : {}), config: entries };
  await fs.writeFile(configPath, stringifyToml(config));
  return disabled;
}

export default { CODEX_SYSTEM_SKILL_NAMES, applyRepositoryCodexConfig, disableScopedCodexSkills, isCodexSystemSkillsEnabled, readRepositoryCodexConfig };
