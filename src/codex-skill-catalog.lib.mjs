/**
 * Parse and validate the model-visible Codex Agent Skill catalog (issue #2254).
 *
 * The plugin inventory is not authoritative: Codex can render instructions
 * from stale cache entries that do not appear in `plugin list`. The rendered
 * `<skills_instructions>` block is therefore validated as a complete allowlist,
 * including canonical provenance paths, before a solver process is started.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { pluginIdParts } from './agent-plugin-cache.lib.mjs';

const BLOCK_PATTERN = /<skills_instructions>([\s\S]*?)<\/skills_instructions>/u;
const ROOT_PATTERN = /^\s*-\s+`?([a-z][a-z0-9_-]*)`?\s*=\s*`([^`]+)`\s*$/iu;
const ENTRY_PATTERN = /^\s*-\s+([a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?)\s*:/iu;
const FILE_PATTERN = /\(file:\s*([^)]+?)\)\s*$/iu;

const findSkillsBlock = promptInput => {
  const source = String(promptInput || '');
  const candidates = [];
  try {
    const visit = value => {
      if (typeof value === 'string') candidates.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(JSON.parse(source));
  } catch {
    candidates.push(source);
  }
  for (const candidate of candidates) {
    const normalized = candidate.replace(/\r\n/gu, '\n').replace(/\\n/gu, '\n');
    const block = BLOCK_PATTERN.exec(normalized);
    if (block) return block[1];
  }
  return null;
};

const stripTicks = value =>
  String(value || '')
    .trim()
    .replace(/^`|`$/gu, '');

const resolveCatalogPath = (file, roots) => {
  const value = stripTicks(file);
  if (path.isAbsolute(value)) return path.normalize(value);
  const separator = value.search(/[\\/]/u);
  const alias = separator === -1 ? value : value.slice(0, separator);
  const root = roots.get(alias);
  if (!root) return null;
  const suffix = separator === -1 ? '' : value.slice(separator + 1);
  return path.resolve(root, suffix);
};

/** Return every rendered entry and its expanded file path, without trusting it. */
export const parseModelVisibleSkillCatalog = (promptInput = '') => {
  const block = findSkillsBlock(promptInput);
  if (block === null) return null;
  const roots = new Map();
  const entries = [];
  const errors = [];
  const lines = block.split('\n');
  const availableIndex = lines.findIndex(line => /^\s*###\s+Available skills\s*$/iu.test(line));
  if (availableIndex === -1) errors.push('The <skills_instructions> block has no parseable Available skills catalog.');

  for (const line of lines) {
    const root = ROOT_PATTERN.exec(line);
    if (root) roots.set(root[1], path.normalize(root[2]));
  }

  for (const line of lines.slice(availableIndex + 1)) {
    if (/^\s*###\s+/u.test(line)) break;
    const skill = ENTRY_PATTERN.exec(line);
    if (!skill) {
      if (/^\s*-\s+/u.test(line)) errors.push(`Unparseable model-visible skill catalog entry: ${line.trim().slice(0, 200)}.`);
      continue;
    }
    const file = FILE_PATTERN.exec(line);
    if (!file) {
      errors.push(`Model-visible skill '${skill[1].toLowerCase()}' has no parseable (file: path) provenance.`);
      continue;
    }
    const resolvedPath = resolveCatalogPath(file[1], roots);
    if (!resolvedPath) errors.push(`Model-visible skill '${skill[1].toLowerCase()}' uses unknown skill-root alias in '${stripTicks(file[1])}'.`);
    entries.push({ name: skill[1].toLowerCase(), file: stripTicks(file[1]), path: resolvedPath });
  }

  return { entries, errors, roots: Object.fromEntries([...roots].sort(([left], [right]) => left.localeCompare(right))) };
};

const isWithin = (candidate, root) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

const canonicalPath = async target => {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
};

const readSystemVersion = async systemRoot => {
  try {
    return (await fs.readFile(path.join(systemRoot, '.codex-system-skills.marker'), 'utf8')).trim() || 'bundled';
  } catch {
    return 'bundled';
  }
};

const pluginProvenance = async ({ entry, canonical, codexHome, canonicalCodexHome, selectedPlugins }) => {
  for (const pluginId of selectedPlugins) {
    const { name, marketplace } = pluginIdParts(pluginId);
    const root = await canonicalPath(path.join(codexHome, 'plugins', 'cache', marketplace, name));
    if (!root || !canonicalCodexHome || !isWithin(root, canonicalCodexHome) || !isWithin(canonical, root)) continue;
    const segments = path.relative(root, canonical).split(path.sep);
    const [version, skillsDirectory, skillName, filename, ...surplus] = segments;
    if (surplus.length > 0 || !version || skillsDirectory !== 'skills' || filename !== 'SKILL.md' || entry.name !== `${name}:${skillName}`.toLowerCase()) return null;
    return { providerId: pluginId, version };
  }
  return null;
};

/**
 * Validate names and canonical paths against the providers selected for this
 * run. Symlinks are resolved so a path that lexically sits inside the scoped
 * home cannot redirect instructions back into an operator/global cache.
 */
export const validateModelVisibleSkillCatalog = async ({ catalog, codexHome, projectDir, selectedPlugins = [], requiredSkills = [] }) => {
  const violations = [...(catalog?.errors || [])];
  const allowed = [];
  const seen = new Map();
  const canonicalCodexHome = await canonicalPath(codexHome);
  const candidateSystemRoot = await canonicalPath(path.join(codexHome, 'skills', '.system'));
  const systemRoot = canonicalCodexHome && candidateSystemRoot && isWithin(candidateSystemRoot, canonicalCodexHome) ? candidateSystemRoot : null;
  const canonicalProjectDir = projectDir ? await canonicalPath(projectDir) : null;
  const candidateProjectSkillsRoot = projectDir ? await canonicalPath(path.join(projectDir, '.agents', 'skills')) : null;
  const projectSkillsRoot = canonicalProjectDir && candidateProjectSkillsRoot && isWithin(candidateProjectSkillsRoot, canonicalProjectDir) ? candidateProjectSkillsRoot : null;
  const requiredBareSkills = new Set(requiredSkills.filter(skill => !skill.includes(':')).map(skill => skill.toLowerCase()));
  const systemVersion = systemRoot ? await readSystemVersion(systemRoot) : 'bundled';

  for (const entry of catalog?.entries || []) {
    seen.set(entry.name, [...(seen.get(entry.name) || []), entry.path]);
    if (!entry.path) continue;
    const canonical = await canonicalPath(entry.path);
    if (!canonical) {
      violations.push(`Model-visible skill '${entry.name}' points to an unreadable path: ${entry.path}.`);
      continue;
    }

    let provenance = null;
    if (systemRoot && isWithin(canonical, systemRoot)) {
      const relative = path.relative(systemRoot, canonical).split(path.sep);
      if (!entry.name.includes(':') && relative.length === 2 && relative[0] === entry.name && relative[1] === 'SKILL.md') provenance = { providerId: 'codex-system', version: systemVersion };
    } else if (projectSkillsRoot && requiredBareSkills.has(entry.name) && isWithin(canonical, projectSkillsRoot)) {
      const relative = path.relative(projectSkillsRoot, canonical).split(path.sep);
      if (relative.length === 2 && relative[0] === entry.name && relative[1] === 'SKILL.md') provenance = { providerId: 'repository', version: 'workspace' };
    } else if (entry.name.includes(':')) {
      provenance = await pluginProvenance({ entry, canonical, codexHome, canonicalCodexHome, selectedPlugins });
    }

    if (!provenance) {
      violations.push(`Model-visible skill '${entry.name}' is not allowlisted for this run or resolves outside trusted repository-scoped paths: ${canonical}.`);
      continue;
    }
    allowed.push({ name: entry.name, providerId: provenance.providerId, version: provenance.version, path: canonical });
  }

  for (const [name, paths] of seen) {
    if (paths.length > 1) violations.push(`Model-visible skill identity '${name}' is ambiguous (${paths.join(', ')}).`);
  }

  allowed.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  const allowedNames = new Set(allowed.map(entry => entry.name));
  const missing = requiredSkills.filter(skill => !allowedNames.has(skill.toLowerCase()));
  const fingerprint = createHash('sha256').update(JSON.stringify(allowed)).digest('hex');
  return { allowed, fingerprint, missing, violations };
};

export default { parseModelVisibleSkillCatalog, validateModelVisibleSkillCatalog };
