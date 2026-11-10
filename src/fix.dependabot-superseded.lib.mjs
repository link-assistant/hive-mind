/**
 * Decide whether a conflicting Dependabot pull request is already superseded
 * by its base branch (issue #3863).
 *
 * In konard/medical-neural-network-ml#25 the five open Dependabot pull
 * requests (#13–#17) could not be merged: each one conflicted with `main`,
 * because later pull requests had already moved every package they bumped to
 * the same or a newer version (`numpy==2.5.4` on `main` against `numpy==2.2.6`
 * in #17, `transformers==5.20.1` against `5.19.0` in #16, …). Dependabot never
 * closed them either: `.github/dependabot.yml` had since excluded
 * `scripts/*-requirements.*` from the `pip` updater, so no Dependabot job
 * looked at them again. They stayed open after the update pull request was
 * merged.
 *
 * This module compares the dependency lines a pull request adds with the
 * same dependencies in the base branch. When every bumped dependency is
 * already at the target version or newer on the base branch (or is no longer
 * there at all), the pull request is superseded and can be closed. Anything
 * it cannot parse or compare makes it answer "not superseded", so a pull
 * request is never closed on a guess.
 *
 * Everything except `checkSupersededByBase` is pure; that one reaches `gh`
 * only through the injected `run`.
 */

import { commandOutput } from './fix.github.lib.mjs';

/**
 * Split a version into numeric parts and a pre-release flag.
 * `v1.2.3`, `2.9.0.post0`, `1.0.0-rc.1`, `3.0` → comparable shape; anything
 * not starting with a digit returns null.
 */
export function parseVersion(text) {
  const match = /^v?(\d+(?:\.\d+)*)(.*)$/i.exec(String(text || '').trim());
  if (!match) return null;
  const numbers = match[1].split('.').map(Number);
  const suffix = match[2].replace(/^[.\-+_]/, '').toLowerCase();
  // Build metadata (`+local`) does not order versions; `post` releases come
  // after the release; every other suffix (a, b, rc, dev, alpha, beta, pre…)
  // comes before it.
  let rank = 0;
  if (suffix && !match[2].startsWith('+')) rank = /^(post|rev|pl|p|r)\.?\d*$/.test(suffix) ? 1 : -1;
  const tagNumber = Number((/(\d+)$/.exec(suffix) || [])[1] || 0);
  return { numbers, rank, tagNumber };
}

/** Compare two version strings: negative, 0 or positive; null when either is not a version. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.numbers[index] || 0) - (b.numbers[index] || 0);
    if (difference !== 0) return difference;
  }
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.tagNumber - b.tagNumber;
}

/** Normalize a dependency name the way package indexes do (PEP 503 for Python, case-insensitive elsewhere). */
export function normalizeDependencyName(name) {
  return String(name || '')
    .trim()
    .replace(/\[.*\]$/, '')
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

/**
 * Generated lockfiles are regenerated alongside the manifest a pull request
 * bumps; their `"version": …` lines name no dependency, so they are judged by
 * the manifest instead.
 */
export const LOCKFILE_PATTERN = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.ya?ml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|pdm\.lock|composer\.lock|Gemfile\.lock|go\.sum|mix\.lock|pubspec\.lock|Package\.resolved|packages\.lock\.json|\.terraform\.lock\.hcl)$/;

/** Manifest keys that look like `key = "1.2.3"` but are not dependencies. */
const NON_DEPENDENCY_KEYS = new Set(['version', 'name', 'node', 'npm', 'yarn', 'pnpm', 'bun', 'python', 'requires-python', 'packagemanager', 'lockfileversion', 'edition', 'rust-version', 'go', 'toolchain', 'minimum-stability']);

const LOWER_OPERATORS = new Set(['==', '===', '>=', '~=', '>', '=', '^', '~', '']);
const UPPER_OPERATORS = new Set(['<', '<=']);

/**
 * Read `{ lower, upper }` from a version requirement such as `==2.2.6`,
 * `>=1.13.0,<3.0`, `^4.17.21`, `~> 7.1` or a bare `1.2.3`. `lower` is the
 * newest version the requirement pins or demands at least; `upper` is the
 * tightest upper bound. Returns null when nothing in it is a version.
 */
export function parseRequirement(text) {
  let lower = null;
  let upper = null;
  for (const part of String(text || '').split(/,|\|\||\s+(?=[<>=~^!])/)) {
    const match = /^\s*(===|==|>=|<=|~=|!=|~>|>|<|=|\^|~)?\s*v?(\d[\w.\-+]*)/.exec(part);
    if (!match) continue;
    const operator = match[1] === '~>' ? '~' : match[1] || '';
    const version = match[2].replace(/[.\-+]$/, '');
    if (operator === '!=') continue;
    if (UPPER_OPERATORS.has(operator)) {
      if (upper === null || compareVersions(version, upper) < 0) upper = version;
    } else if (LOWER_OPERATORS.has(operator)) {
      if (lower === null || compareVersions(version, lower) > 0) lower = version;
    }
  }
  return lower === null && upper === null ? null : { lower, upper };
}

/**
 * Extract one dependency `{ name, requirement }` from a manifest or lockfile
 * line, or null when the line is not a dependency pin. Recognized shapes:
 *
 * - pip / requirements / pyproject arrays: `numpy==2.2.6`, `"mypy>=1.13.0,<3.0",`
 * - JSON manifests (npm, composer): `"lodash": "^4.17.21",`
 * - TOML tables (Cargo, Poetry, uv): `serde = "1.0.200"`, `serde = { version = "1.0" }`
 * - GitHub Actions: `uses: actions/checkout@<sha> # v4.2.0`, `uses: actions/setup-node@v4`
 * - Docker: `FROM node:22.11.0-alpine`
 */
export function parseDependencyLine(line) {
  const text = String(line || '')
    .replace(/\s+\\$/, '')
    .trim();
  if (!text || text.startsWith('#') || text.startsWith('//')) return null;

  let match = /^-?\s*uses:\s*['"]?([^@\s'"]+)@([^\s'"#]+)['"]?(?:\s*#\s*v?(\d[\w.\-+]*))?/.exec(text);
  if (match) {
    const version = match[3] || (/^v?\d/.test(match[2]) ? match[2] : null);
    return version ? { name: match[1].toLowerCase(), requirement: parseRequirement(version) } : null;
  }

  match = /^FROM\s+(?:--platform=\S+\s+)?([^\s:@]+):(\d[\w.-]*)/i.exec(text);
  if (match) return { name: match[1].toLowerCase(), requirement: parseRequirement(match[2]) };

  match = /^"(@?[\w.\-/]+)"\s*:\s*"([^"]+)"\s*,?$/.exec(text);
  if (match) {
    const requirement = NON_DEPENDENCY_KEYS.has(match[1].toLowerCase()) ? null : parseRequirement(match[2]);
    return requirement ? { name: match[1].toLowerCase(), requirement } : null;
  }

  match = /^([A-Za-z0-9][\w.-]*)\s*=\s*(?:"([^"]+)"|\{[^}]*\bversion\s*=\s*"([^"]+)")/.exec(text);
  if (match) {
    const requirement = NON_DEPENDENCY_KEYS.has(match[1].toLowerCase()) ? null : parseRequirement(match[2] || match[3]);
    return requirement ? { name: normalizeDependencyName(match[1]), requirement } : null;
  }

  // go.mod: `require github.com/x/y v1.2.3` or an indented line of a require block.
  match = /^(?:require\s+)?([a-z0-9][\w.-]*\.[a-z]{2,}\/[\w.\-/]+)\s+(v\d[\w.\-+]*)(?:\s*\/\/.*)?$/i.exec(text);
  if (match) return { name: match[1].toLowerCase(), requirement: parseRequirement(match[2]) };

  // Gemfile / gemspec: `gem "rails", "~> 7.1"`.
  match = /^(?:gem|spec\.add_(?:development_|runtime_)?dependency)\s*\(?\s*['"]([\w.-]+)['"]\s*,\s*['"]([^'"]+)['"]/.exec(text);
  if (match) {
    const requirement = parseRequirement(match[2]);
    return requirement ? { name: match[1].toLowerCase(), requirement } : null;
  }

  match = /^['"]?([A-Za-z0-9][\w.-]*(?:\[[^\]]*\])?)\s*((?:===|==|>=|<=|~=|!=|>|<)\s*[^'";#\s,<>=!~][^'";#\s,]*(?:\s*,\s*(?:===|==|>=|<=|~=|!=|>|<)\s*[^'";#\s,<>=!~][^'";#\s,]*)*)['"]?\s*,?(?:\s*;.*)?(?:\s+#.*)?$/.exec(text);
  if (match) {
    const requirement = parseRequirement(match[2]);
    return requirement ? { name: normalizeDependencyName(match[1]), requirement } : null;
  }
  return null;
}

/**
 * Parse a unified diff (`gh pr diff`) into `[{ path, added, removed }]`, where
 * `added`/`removed` are the changed lines without their `+`/`-` marker.
 */
export function parseUnifiedDiff(diff) {
  const files = [];
  let current = null;
  for (const line of String(diff || '').split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = { path: header[2], added: [], removed: [], deleted: false };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      if (line === '+++ /dev/null') current.deleted = true;
      continue;
    }
    if (line.startsWith('+')) current.added.push(line.slice(1));
    else if (line.startsWith('-')) current.removed.push(line.slice(1));
  }
  return files;
}

/** Every dependency of a file's content, by normalized name (the last occurrence wins). */
export function collectDependencies(content) {
  const dependencies = new Map();
  for (const line of String(content || '').split('\n')) {
    const dependency = parseDependencyLine(line);
    if (dependency) dependencies.set(dependency.name, dependency.requirement);
  }
  return dependencies;
}

/**
 * Is `base` at least as new as `target`? The base must demand the same or a
 * newer version, and must not cap it below the target's own upper bound.
 */
export function requirementSatisfies(base, target) {
  if (!base || !target) return false;
  if (target.lower !== null) {
    if (base.lower === null) return false;
    const comparison = compareVersions(base.lower, target.lower);
    if (comparison === null || comparison < 0) return false;
  }
  if (target.upper !== null && base.upper !== null) {
    const comparison = compareVersions(base.upper, target.upper);
    if (comparison === null || comparison < 0) return false;
  }
  return true;
}

/**
 * Pure verdict for one pull request: `{ superseded, reason, dependencies }`.
 *
 * `files` is `parseUnifiedDiff` output; `baseContents` maps each path to its
 * content on the base branch (`null` when the file no longer exists there).
 * Lockfiles a pull request regenerates alongside a manifest are judged by the
 * lines that parse; a file whose changed lines contain no dependency at all
 * is ignored. Every bumped dependency must be satisfied by the base branch.
 */
export function evaluateSupersession(files, baseContents) {
  const dependencies = [];
  for (const file of files || []) {
    if (file.deleted || LOCKFILE_PATTERN.test(file.path)) continue;
    const removed = new Map();
    for (const line of file.removed) {
      const dependency = parseDependencyLine(line);
      if (dependency) removed.set(dependency.name, dependency.requirement);
    }
    const bumped = [];
    for (const line of file.added) {
      const dependency = parseDependencyLine(line);
      if (!dependency || !dependency.requirement) continue;
      const before = removed.get(dependency.name);
      if (before && before.lower === dependency.requirement.lower && before.upper === dependency.requirement.upper) continue;
      bumped.push(dependency);
    }
    if (bumped.length === 0) continue;
    const content = baseContents?.[file.path];
    if (content === undefined) return { superseded: false, reason: `the base version of ${file.path} could not be read`, dependencies };
    const onBase = content === null ? new Map() : collectDependencies(content);
    for (const dependency of bumped) {
      const base = onBase.get(dependency.name) || null;
      const entry = { path: file.path, name: dependency.name, target: dependency.requirement, base };
      dependencies.push(entry);
      if (!base) {
        entry.verdict = 'removed';
        continue;
      }
      entry.verdict = requirementSatisfies(base, dependency.requirement) ? 'satisfied' : 'behind';
      if (entry.verdict === 'behind') return { superseded: false, reason: `${dependency.name} on the base branch (${formatRequirement(base)}) is older than ${formatRequirement(dependency.requirement)}`, dependencies };
    }
  }
  if (dependencies.length === 0) return { superseded: false, reason: 'no dependency version change could be read from the diff', dependencies };
  if (dependencies.every(entry => entry.verdict === 'removed')) return { superseded: false, reason: 'none of the updated dependencies was found on the base branch', dependencies };
  return { superseded: true, reason: describeSupersession(dependencies), dependencies };
}

export function formatRequirement(requirement) {
  if (!requirement) return 'absent';
  const parts = [];
  if (requirement.lower !== null) parts.push(requirement.lower);
  if (requirement.upper !== null) parts.push(`<${requirement.upper}`);
  return parts.join(', ');
}

/** Human-readable list such as "numpy 2.5.4 ≥ 2.2.6; mypy 2.4.0 ≥ 1.13.0, <3.0". */
export function describeSupersession(dependencies) {
  return dependencies.map(entry => (entry.verdict === 'removed' ? `${entry.name} is no longer a dependency in ${entry.path}` : `${entry.name} ${formatRequirement(entry.base)} ≥ ${formatRequirement(entry.target)}`)).join('; ');
}

/** Read a file of `repository` at `ref`; null when it does not exist (HTTP 404). Throws on other errors. */
async function readFileAtRef(repository, path, ref, run) {
  try {
    return await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, '-H', 'Accept: application/vnd.github.raw']);
  } catch (error) {
    if (/HTTP 404|Not Found/i.test(String(error.message))) return null;
    throw error;
  }
}

/**
 * Check one Dependabot pull request against its base branch through `gh`.
 * Never throws: a read failure answers `{ superseded: false, reason }`.
 */
export async function checkSupersededByBase({ repository, pullRequest, run }) {
  try {
    const diff = await commandOutput(run, 'gh', ['pr', 'diff', String(pullRequest.number), '--repo', repository.fullName]);
    const files = parseUnifiedDiff(diff);
    const baseRef = pullRequest.baseRefName || 'HEAD';
    const baseContents = {};
    for (const file of files) {
      if (!file.deleted && !LOCKFILE_PATTERN.test(file.path) && file.added.some(line => parseDependencyLine(line))) baseContents[file.path] = await readFileAtRef(repository, file.path, baseRef, run);
    }
    return evaluateSupersession(files, baseContents);
  } catch (error) {
    const reason = (
      String(error.message || '')
        .split('\n')
        .find(Boolean) || 'unknown error'
    ).trim();
    return { superseded: false, reason: `could not compare with the base branch: ${reason}`, dependencies: [] };
  }
}
