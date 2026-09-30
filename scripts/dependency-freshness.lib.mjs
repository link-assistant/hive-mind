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
    if (!documentedVersion && !semanticRef) {
      records.push({ kind: 'unresolved', name: match[1], current: ref, location: `${file}:${lineNumberAt(source, match.index)}`, error: 'Action refs require a semantic version or a SHA with a version comment', exception: pinException(source, match.index) });
      continue;
    }
    const current = documentedVersion ?? semanticRef;
    const components = current.replace(/^v/, '').split('.').length;
    records.push({
      kind: 'github',
      exception: pinException(source, match.index),
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
    records.push({ exception: pinException(source, match.index), kind: 'npm', name: match[1], current: match[2], policy: 'exact', location: `${file}:${lineNumberAt(source, match.index)}` });
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

const pinException = (source, index) => source.split('\n')[lineNumberAt(source, index) - 1]?.match(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/)?.[0];

const ARG_SOURCES = {
  FORMAL_AI_VERSION: { kind: 'github', name: 'link-assistant/formal-ai' },
  HIVE_MIND_BUN_VERSION: { kind: 'github', name: 'oven-sh/bun', tagPrefix: 'bun-v' },
  HIVE_MIND_NODE_VERSION: { kind: 'github', name: 'nodejs/node' },
  HIVE_MIND_VERSION: { kind: 'npm', name: '@link-assistant/hive-mind' },
};

/** Unknown version arguments are errors, so adding a pin cannot evade CI. */
export const parseDockerDependencyPins = (source, file) => {
  const records = parseNpmPackagePins(source, file);
  const args = new Map();
  const add = (record, match) => records.push({ policy: 'exact', ...record, location: `${file}:${lineNumberAt(source, match.index)}`, exception: pinException(source, match.index) });
  for (const match of source.matchAll(/ARG\s+(\w+_VERSION)=([^\s#]+)/g)) {
    args.set(match[1], match[2]);
    if (['latest', 'stable'].includes(match[2])) continue; // Floating refs follow the publisher automatically.
    add({ ...(ARG_SOURCES[match[1]] ?? { kind: 'unresolved', name: match[1], error: 'Map this version argument to its publisher' }), current: match[2] }, match);
  }
  for (const match of source.matchAll(/cargo\s+install\s+([\w-]+)[^\n]*?--version\s+["']?([^"'\s]+)/g)) {
    const current = match[2].replace(/\$\{(\w+)\}/g, (_, name) => args.get(name) ?? `unresolved:${name}`);
    add({ kind: 'crate', name: match[1], current }, match);
  }
  for (const match of source.matchAll(/FROM\s+(?:--platform=\S+\s+)?([^\s]+)(?:\s+AS\s+\w+)?/gi)) {
    const image = match[1];
    if (image.includes('${')) continue; // Declared ARG is checked above.
    const colon = image.lastIndexOf(':');
    if (colon < 0 || image.slice(colon + 1) === 'latest') continue;
    const name = image.slice(0, colon),
      tag = image.slice(colon + 1);
    if (/^ghcr\.io\/link-foundation\/box(?:-dind)?$/.test(name)) add({ kind: 'github', name: 'link-foundation/box', current: tag }, match);
    else if (name === 'rust') add({ kind: 'github', name: 'rust-lang/rust', current: tag, policy: 'minor' }, match);
    else add({ kind: 'container', name, current: tag }, match);
  }
  return records;
};

const discoverDockerfiles = async (root, relative = '') => {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    if (['.git', 'node_modules', 'reports'].includes(entry.name)) continue;
    const target = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await discoverDockerfiles(root, target)));
    else if (entry.name.startsWith('Dockerfile')) files.push(target);
  }
  return files;
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

  for (const relative of await discoverDockerfiles(root)) {
    const source = await readIfPresent(path.join(root, relative));
    if (!source) continue;
    records.push(...parseDockerDependencyPins(source, relative));
  }

  const workflowRoot = path.join(root, '.github');
  for (const target of await walkYamlFiles(workflowRoot)) {
    const relative = path.relative(root, target);
    const source = await fs.readFile(target, 'utf8');
    records.push(...parseGitHubActionPins(source, relative));
    for (const match of source.matchAll(/ACT_VERSION:\s*v?(\d+\.\d+\.\d+)/g)) records.push({ kind: 'github', name: 'nektos/act', current: match[1], policy: 'exact', location: `${relative}:${lineNumberAt(source, match.index)}`, exception: pinException(source, match.index) });
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

const fetchJson = async (url, { fetchImpl = globalThis.fetch, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {}) => {
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

export const resolveCrateLatest = async (name, options = {}) => {
  const metadata = await fetchJson(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, options);
  return metadata.crate.max_stable_version;
};

const containerTagSuffix = current => String(current ?? '').replace(/^v?\d+(?:\.\d+){0,2}/, '');

/** Docker Registry v2 supports Docker Hub and registries advertising Bearer auth. */
export const resolveContainerLatest = async (name, record = {}, { fetchImpl = globalThis.fetch } = {}) => {
  const parts = name.split('/');
  const custom = parts[0].includes('.') || parts[0].includes(':');
  const registry = custom ? parts.shift() : 'registry-1.docker.io';
  const repository = !custom && parts.length === 1 ? `library/${parts[0]}` : parts.join('/');
  const url = `https://${registry}/v2/${repository}/tags/list`;
  let response = await fetchImpl(url);
  if (response.status === 401) {
    const auth = response.headers.get('www-authenticate') ?? '';
    const realm = auth.match(/realm="([^"]+)"/)?.[1];
    if (!realm?.startsWith('https://')) throw new Error('Registry has no HTTPS Bearer authentication realm');
    const tokenUrl = new URL(realm);
    for (const key of ['service', 'scope']) {
      const value = auth.match(new RegExp(`${key}="([^"]+)"`))?.[1];
      if (value) tokenUrl.searchParams.set(key, value);
    }
    const credentials = await fetchJson(tokenUrl.toString(), { fetchImpl });
    response = await fetchImpl(url, { headers: { authorization: `Bearer ${credentials.token ?? credentials.access_token}` } });
  }
  if (!response.ok) throw new Error(`Registry returned ${response.status}`);
  const suffix = containerTagSuffix(record.current).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagPattern = new RegExp(`^v?(\\d+(?:\\.\\d+){0,2})${suffix}$`);
  const metadata = await response.json();
  const candidates = (metadata.tags ?? [])
    .map(tag => ({ tag, version: parseVersion(tag.match(tagPattern)?.[1]) }))
    .filter(candidate => candidate.version)
    .sort((a, b) => compareParsedVersions(b.version, a.version));
  if (!candidates.length) throw new Error(`No stable container tags found for ${name}`);
  return candidates[0].tag;
};

export const resolveOpenIssue = async (url, options = {}) => {
  const match = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)$/);
  if (!match) throw new Error('Exceptions must link a GitHub issue on the declaration line');
  const issue = await fetchJson(`https://api.github.com/repos/${match[1]}/issues/${match[2]}`, options);
  return issue.state === 'open' && !issue.pull_request;
};

/** Registry errors and unrecognized pins fail closed; only verified open issues waive pins. */
export const checkDependencyRecords = async (records, { resolveNpmLatest: npmResolver = resolveNpmLatest, resolveGitHubLatest: githubResolver = resolveGitHubLatest, resolveCrateLatest: crateResolver = resolveCrateLatest, resolveContainerLatest: containerResolver = resolveContainerLatest, resolveOpenIssue: issueResolver = resolveOpenIssue } = {}) => {
  const latestByDependency = new Map(),
    current = [],
    stale = [],
    errors = [],
    exceptions = [];
  const resolvers = { npm: npmResolver, github: githubResolver, crate: crateResolver, container: containerResolver };
  await Promise.all(
    records.map(async record => {
      try {
        if (record.exception) {
          if (!(await issueResolver(record.exception))) throw new Error(`Exception issue is closed or invalid: ${record.exception}`);
        }
        if (!resolvers[record.kind]) {
          if (record.exception) {
            exceptions.push(record);
            return;
          }
          throw new Error(record.error ?? `Unknown dependency kind ${record.kind}`);
        }
        const key = `${record.kind}:${record.name}:${record.tagPrefix ?? ''}:${record.versionMajor ?? ''}:${record.kind === 'container' ? containerTagSuffix(record.current) : ''}`;
        if (!latestByDependency.has(key)) latestByDependency.set(key, resolvers[record.kind](record.name, record));
        const latest = await latestByDependency.get(key);
        const assessment = assessVersionPin({ current: record.current, latest, policy: record.policy });
        const result = { ...record, latest, reason: assessment.reason };
        (assessment.current ? current : record.exception ? exceptions : stale).push(result);
      } catch (error) {
        errors.push({ ...record, error: error?.message ?? String(error) });
      }
    })
  );
  const byLocation = (a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name);
  for (const results of [current, stale, errors, exceptions]) results.sort(byLocation);
  return { records, current, stale, errors, exceptions };
};
