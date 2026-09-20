/**
 * Inventory and verify dependency versions declared outside the lockfile.
 *
 * `npm outdated` sees package.json, but Hive Mind also pins dependencies in
 * Dockerfiles, use-m's runtime package map, GitHub Actions, base images and
 * setup-action inputs. Issue #2264 requires one fail-closed check over all of
 * those surfaces.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { USE_M_PACKAGE_VERSIONS } from '../src/use-with-retry.lib.mjs';

const DOCKERFILES = ['Dockerfile', 'Dockerfile.dind', 'Dockerfile.formal-ai', 'coolify/Dockerfile'];
const VERSION = /\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?/;

const parseVersion = value => {
  const match = String(value ?? '').match(VERSION);
  if (!match) return null;
  const [core, prerelease = ''] = match[0].split('-', 2);
  const [major = 0, minor = 0, patch = 0] = core.split('.').map(Number);
  return { raw: match[0], major, minor, patch, prerelease };
};

const compareParsedVersions = (left, right) => left.major - right.major || left.minor - right.minor || left.patch - right.patch || (left.prerelease ? (right.prerelease ? left.prerelease.localeCompare(right.prerelease) : -1) : right.prerelease ? 1 : 0);

/** Compare a declaration at the precision promised by its update mechanism. */
export const assessVersionPin = ({ current, latest, policy = 'exact' }) => {
  const currentVersion = parseVersion(current);
  const latestVersion = parseVersion(latest);
  if (!currentVersion || !latestVersion) return { current: false, reason: 'unparseable version', currentVersion, latestVersion };

  let isCurrent;
  if (policy === 'major') isCurrent = currentVersion.major === latestVersion.major;
  else if (policy === 'minor') isCurrent = currentVersion.major === latestVersion.major && currentVersion.minor === latestVersion.minor;
  else isCurrent = compareParsedVersions(currentVersion, latestVersion) === 0;

  return { current: isCurrent, currentVersion, latestVersion };
};

const lineNumberAt = (source, index) => source.slice(0, index).split('\n').length;

/** Parse owner/repository action refs. Action subpaths normalize to their repo. */
export const parseGitHubActionPins = (source, file) => {
  const records = [];
  const expression = /uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[^\s@]+)?@([^\s#]+)(?:\s+#\s*v?(\d+\.\d+\.\d+))?/g;
  for (const match of source.matchAll(expression)) {
    const ref = match[2];
    const documentedVersion = match[3];
    const semanticRef = ref.match(/^v?(\d+(?:\.\d+){0,2})$/)?.[0];
    if (!documentedVersion && !semanticRef) continue;
    const current = documentedVersion ?? semanticRef;
    const components = current.replace(/^v/, '').split('.').length;
    records.push({
      kind: 'github',
      name: match[1],
      current,
      policy: documentedVersion || components === 3 ? 'exact' : components === 2 ? 'minor' : 'major',
      location: `${file}:${lineNumberAt(source, match.index)}`,
    });
  }

  const dockerAction = /uses:\s*docker:\/\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+):v?(\d+\.\d+\.\d+)/g;
  for (const match of source.matchAll(dockerAction)) {
    records.push({ kind: 'github', name: match[1], current: match[2], policy: 'exact', location: `${file}:${lineNumberAt(source, match.index)}` });
  }
  return records;
};

/** Parse exact npm package pins embedded in image build commands. */
export const parseNpmPackagePins = (source, file) => {
  const records = [];
  const expression = /(?:^|[\s"'=])((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gim;
  for (const match of source.matchAll(expression)) {
    records.push({ kind: 'npm', name: match[1], current: match[2], policy: 'exact', location: `${file}:${lineNumberAt(source, match.index)}` });
  }
  return records;
};

const walkYamlFiles = async directory => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkYamlFiles(target)));
    else if (/\.ya?ml$/i.test(entry.name)) files.push(target);
  }
  return files;
};

const readIfPresent = async target => {
  try {
    return await fs.readFile(target, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const addContainerReleasePins = (records, source, file) => {
  for (const match of source.matchAll(/FROM\s+ghcr\.io\/link-foundation\/box(?:-dind)?:v?(\d+\.\d+\.\d+)/g)) {
    records.push({ kind: 'github', name: 'link-foundation/box', current: match[1], policy: 'exact', location: `${file}:${lineNumberAt(source, match.index)}` });
  }
  for (const match of source.matchAll(/FROM\s+rust:(\d+\.\d+)(?:[.-][^\s]+)?/g)) {
    records.push({ kind: 'github', name: 'rust-lang/rust', current: match[1], policy: 'minor', location: `${file}:${lineNumberAt(source, match.index)}` });
  }
  for (const match of source.matchAll(/ARG\s+FORMAL_AI_VERSION=(\d+\.\d+\.\d+)/g)) {
    records.push({ kind: 'github', name: 'link-assistant/formal-ai', current: match[1], policy: 'exact', location: `${file}:${lineNumberAt(source, match.index)}` });
  }
  for (const match of source.matchAll(/ARG\s+HIVE_MIND_BUN_VERSION=(\d+\.\d+\.\d+)/g)) {
    records.push({ kind: 'github', name: 'oven-sh/bun', current: match[1], policy: 'exact', tagPrefix: 'bun-v', location: `${file}:${lineNumberAt(source, match.index)}` });
  }
  for (const match of source.matchAll(/ARG\s+HIVE_MIND_NODE_VERSION=(\d+\.\d+\.\d+)/g)) {
    records.push({ kind: 'github', name: 'nodejs/node', current: match[1], policy: 'exact', versionMajor: Number(match[1].split('.')[0]), location: `${file}:${lineNumberAt(source, match.index)}` });
  }
};

/** Discover every dependency surface maintained by the freshness gate. */
export const collectDependencyRecords = async ({ root = process.cwd() } = {}) => {
  const records = [];
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, current] of Object.entries(manifest[section] ?? {})) {
      if (parseVersion(current)) records.push({ kind: 'npm', name, current, policy: 'exact', location: `package.json#${section}` });
    }
  }

  for (const [name, current] of Object.entries(USE_M_PACKAGE_VERSIONS)) {
    records.push({ kind: 'npm', name, current, policy: 'exact', location: 'src/use-with-retry.lib.mjs#USE_M_PACKAGE_VERSIONS' });
  }

  const bootstrapSource = await fs.readFile(path.join(root, 'src', 'use-m-bootstrap.lib.mjs'), 'utf8');
  for (const match of bootstrapSource.matchAll(/(?:unpkg\.com|cdn\.jsdelivr\.net\/npm)\/use-m@(\d+\.\d+\.\d+)\/use\.js/g)) {
    records.push({ kind: 'npm', name: 'use-m', current: match[1], policy: 'exact', location: `src/use-m-bootstrap.lib.mjs:${lineNumberAt(bootstrapSource, match.index)}` });
  }

  for (const relative of DOCKERFILES) {
    const source = await readIfPresent(path.join(root, relative));
    if (!source) continue;
    records.push(...parseNpmPackagePins(source, relative));
    addContainerReleasePins(records, source, relative);
  }

  const workflowRoot = path.join(root, '.github', 'workflows');
  for (const target of await walkYamlFiles(workflowRoot)) {
    const relative = path.relative(root, target);
    const source = await fs.readFile(target, 'utf8');
    records.push(...parseGitHubActionPins(source, relative));
    for (const match of source.matchAll(/\bversion:\s*v(\d+\.\d+\.\d+)/g)) {
      const preceding = source.slice(Math.max(0, match.index - 250), match.index);
      if (preceding.includes('azure/setup-helm@')) {
        records.push({ kind: 'github', name: 'helm/helm', current: match[1], policy: 'exact', location: `${relative}:${lineNumberAt(source, match.index)}` });
      }
    }
  }

  const seen = new Set();
  return records.filter(record => {
    const key = `${record.kind}|${record.name}|${record.current}|${record.policy}|${record.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchJson = async (url, { fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN } = {}) => {
  const isGitHub = url.startsWith('https://api.github.com/');
  const headers = { accept: isGitHub ? 'application/vnd.github+json' : 'application/json', 'user-agent': 'hive-mind-dependency-freshness' };
  if (isGitHub && token) headers.authorization = `Bearer ${token}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(url, { headers });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? lastError}`);
};

export const resolveNpmLatest = async (name, options = {}) => {
  const metadata = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, options);
  if (!parseVersion(metadata?.version)) throw new Error(`npm returned no semantic latest version for ${name}`);
  return metadata.version;
};

export const resolveGitHubLatest = async (repository, record = {}, options = {}) => {
  const tags = await fetchJson(`https://api.github.com/repos/${repository}/tags?per_page=100`, options);
  const prefix = record.tagPrefix ? record.tagPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : 'v?';
  const tagPattern = new RegExp(`^${prefix}(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)$`);
  const semanticTags = tags
    .map(tag => ({ tag: tag.name, parsed: tagPattern.test(tag.name) ? parseVersion(tag.name) : null }))
    .filter(candidate => candidate.parsed && (record.includePrerelease || !candidate.parsed.prerelease) && (record.versionMajor === undefined || candidate.parsed.major === record.versionMajor))
    .sort((left, right) => compareParsedVersions(right.parsed, left.parsed));
  if (semanticTags.length === 0) throw new Error(`GitHub returned no semantic tags for ${repository}`);
  return semanticTags[0].tag;
};

/** Resolve and classify records. Registry failures are errors, never passes. */
export const checkDependencyRecords = async (records, { resolveNpmLatest: npmResolver = resolveNpmLatest, resolveGitHubLatest: githubResolver = resolveGitHubLatest } = {}) => {
  const latestByDependency = new Map();
  const current = [];
  const stale = [];
  const errors = [];

  await Promise.all(
    records.map(async record => {
      const key = `${record.kind}:${record.name}:${record.tagPrefix ?? ''}:${record.versionMajor ?? ''}`;
      try {
        let latestPromise = latestByDependency.get(key);
        if (!latestPromise) {
          latestPromise = record.kind === 'npm' ? npmResolver(record.name, record) : githubResolver(record.name, record);
          latestByDependency.set(key, latestPromise);
        }
        const latest = await latestPromise;
        const assessment = assessVersionPin({ current: record.current, latest, policy: record.policy });
        const result = { ...record, latest, reason: assessment.reason };
        (assessment.current ? current : stale).push(result);
      } catch (error) {
        errors.push({ ...record, error: error?.message ?? String(error) });
      }
    })
  );

  const byLocation = (left, right) => left.location.localeCompare(right.location) || left.name.localeCompare(right.name);
  current.sort(byLocation);
  stale.sort(byLocation);
  errors.sort(byLocation);
  return { records, current, stale, errors };
};
