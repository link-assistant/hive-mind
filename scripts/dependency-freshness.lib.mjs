/**
 * Inventory and verify dependency versions declared outside the lockfile.
 *
 * `npm outdated` sees package.json, but Hive Mind also pins dependencies in
 * Dockerfiles, use-m's runtime package map and literal use-m specifiers,
 * GitHub Actions, base images and setup-action inputs. Issue #2264 requires
 * one fail-closed check over all of those surfaces for pull requests; issue
 * #2625 keeps it advisory elsewhere.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { USE_M_PACKAGE_VERSIONS } from '../src/use-with-retry.lib.mjs';

/**
 * Blank whole-line comments, keeping line numbers: a version mentioned in prose
 * (`# 0.353.0 was tagged but never published`) is not a declaration, and a
 * `FROM line below` sentence is not a build stage.
 */
const blankCommentLines = (source, marker = /^\s*#/) =>
  source
    .split('\n')
    .map(line => (marker.test(line) ? '' : line))
    .join('\n');

const JS_COMMENT_LINE = /^\s*(?:\/\/|\/?\*)/;

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

/** A declaration found at `match` in `file`: where to edit it and any exception linked on its line. */
const pinAt = (source, file, match, record) => ({ policy: 'exact', ...record, location: `${file}:${lineNumberAt(source, match.index)}`, exception: pinException(source, match.index) });

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
  const expression = /(?:^|[\s"'=])((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/gim;
  return [...source.matchAll(expression)].map(match => pinAt(source, file, match, { kind: 'npm', name: match[1], current: match[2] }));
};

/**
 * Parse version literals passed to use-m, such as a `use()` call whose
 * specifier is `yargs@17.7.2`. Runtime code should import through
 * USE_M_PACKAGE_VERSIONS; a literal left in a maintained script is still
 * checked, so it cannot silently fall behind.
 */
export const parseUseMLiteralPins = (source, file) => [...source.matchAll(/\buse\(\s*['"`]((?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\/[^'"`]*)?['"`]\s*\)/g)].map(match => pinAt(source, file, match, { kind: 'npm', name: match[1], current: match[2] }));

/**
 * Parse container images pinned as string literals in code, such as the task
 * base image or the router sidecar. They are pulled at runtime, so they fall
 * behind as silently as a Dockerfile FROM line. Comment lines are prose.
 */
export const parseSourceImagePins = (rawSource, file) => {
  const source = blankCommentLines(rawSource, JS_COMMENT_LINE);
  return [...source.matchAll(/['"`]((?:[a-z0-9-]+\.)+[a-z]+(?::\d+)?(?:\/[a-z0-9._-]+)+:v?\d[0-9A-Za-z.-]*)['"`]/g)].flatMap(match => {
    const record = imagePinRecord(match[1]);
    return record ? [pinAt(source, file, match, record)] : [];
  });
};

const MAINTAINED_SCRIPT = /\.(?:c|m)?js$/;

/** Shipped and maintained code: root scripts, src/ and scripts/. Tests and experiments pin on purpose. */
const discoverMaintainedScripts = async root => {
  const files = [];
  const walk = async relative => {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const target = path.join(relative, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (MAINTAINED_SCRIPT.test(entry.name)) files.push(target);
    }
  };
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isFile() && MAINTAINED_SCRIPT.test(entry.name)) files.push(entry.name);
    else if (entry.isDirectory() && ['src', 'scripts'].includes(entry.name)) await walk(entry.name);
  }
  return files;
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
  // The images run `cargo install formal-ai --version`, so a release is only
  // adoptable once crates.io has it. Its GitHub tag can exist for hours (or
  // indefinitely, when the publish job fails) before that: v0.353.0 was tagged
  // on 2026-10-12 and never reached crates.io (issue #2801, cf. #2395).
  FORMAL_AI_VERSION: { kind: 'crate', name: 'formal-ai' },
  HIVE_MIND_BUN_VERSION: { kind: 'github', name: 'oven-sh/bun', tagPrefix: 'bun-v' },
  HIVE_MIND_NODE_VERSION: { kind: 'github', name: 'nodejs/node' },
  HIVE_MIND_VERSION: { kind: 'npm', name: '@link-assistant/hive-mind' },
};

/** The box base images (`box`, `box-dind`, `box-essentials-dind`, ...) share link-foundation/box releases. */
const BOX_IMAGE = /^ghcr\.io\/link-foundation\/box(?:-[a-z]+)*$/;

/** Classify an `image:tag` reference wherever it is declared. Local, floating and non-version tags are not pins. */
export const imagePinRecord = reference => {
  const image = String(reference ?? '').replace(/@sha256:[0-9a-f]+$/i, '');
  const colon = image.lastIndexOf(':');
  if (colon < 0 || image.lastIndexOf('/') > colon) return null;
  const name = image.slice(0, colon),
    tag = image.slice(colon + 1);
  if (!/^v?\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?$/.test(tag)) return null;
  if (BOX_IMAGE.test(name)) return { kind: 'github', name: 'link-foundation/box', current: tag };
  // The pin names a Docker Hub image, not a rust-lang/rust tag: a toolchain
  // release is only adoptable once the official image publishes it, which can
  // lag the GitHub tag by hours (issue #2395: 1.99.0 was tagged before
  // `rust:1.99-*` existed, so the gate demanded a FROM line that cannot pull).
  if (name === 'rust') return { kind: 'docker', name: 'library/rust', current: tag.match(/^\d+\.\d+/)?.[0] ?? tag, policy: 'minor' };
  return { kind: 'container', name, current: tag };
};

/** Unknown version arguments are errors, so adding a pin cannot evade CI. */
export const parseDockerDependencyPins = (rawSource, file) => {
  const source = blankCommentLines(rawSource);
  const records = parseNpmPackagePins(source, file);
  const args = new Map();
  const add = (record, match) => records.push(pinAt(source, file, match, record));
  for (const match of source.matchAll(/^[ \t]*ARG\s+(\w+)=([^\s#]+)/gim)) {
    args.set(match[1], { value: match[2], match });
    if (!match[1].endsWith('_VERSION')) continue; // Image refs are checked where FROM uses them.
    if (['latest', 'stable'].includes(match[2])) continue; // Floating refs follow the publisher automatically.
    add({ ...(ARG_SOURCES[match[1]] ?? { kind: 'unresolved', name: match[1], error: 'Map this version argument to its publisher' }), current: match[2] }, match);
  }
  for (const match of source.matchAll(/cargo\s+install\s+([\w-]+)[^\n]*?--version\s+["']?([^"'\s]+)/g)) {
    const current = match[2].replace(/\$\{(\w+)\}/g, (_, name) => args.get(name)?.value ?? `unresolved:${name}`);
    add({ kind: 'crate', name: match[1], current }, match);
  }
  for (const match of source.matchAll(/^[ \t]*FROM\s+(?:--platform=\S+\s+)?(\S+)/gim)) {
    // A version ARG used in a tag is checked above; an image ARG is resolved here.
    if (/\$\{?\w+_VERSION\b/.test(match[1])) continue;
    // Report an image ARG where it is edited, not where FROM expands it.
    let declaration = match;
    const record = imagePinRecord(
      match[1].replace(/\$\{(\w+)\}|\$(\w+)/g, (whole, braced, bare) => {
        const arg = args.get(braced ?? bare);
        if (!arg) return whole;
        declaration = arg.match;
        return arg.value;
      })
    );
    if (record) add(record, declaration);
  }
  return records;
};

const discoverDockerfiles = async (root, relative = '') => {
  const files = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    // Experiments and tests pin historical versions on purpose.
    if (['.git', 'node_modules', 'reports', 'experiments', 'tests'].includes(entry.name)) continue;
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

  for (const relative of await discoverMaintainedScripts(root)) {
    const source = blankCommentLines(await fs.readFile(path.join(root, relative), 'utf8'), JS_COMMENT_LINE);
    records.push(...parseUseMLiteralPins(source, relative), ...parseSourceImagePins(source, relative));
  }

  for (const relative of await discoverDockerfiles(root)) {
    const source = await readIfPresent(path.join(root, relative));
    if (!source) continue;
    records.push(...parseDockerDependencyPins(source, relative));
  }

  const workflowRoot = path.join(root, '.github');
  for (const target of await walkYamlFiles(workflowRoot)) {
    const relative = path.relative(root, target);
    const source = blankCommentLines(await fs.readFile(target, 'utf8'));
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

/**
 * Lockfile packages that `npm update --package-lock-only` would change. A
 * transitive package cannot always be at its registry latest, because a
 * parent's range may exclude it, but it can always be at the newest version its
 * dependents allow: anything older is a lockfile nobody refreshed. Versions are
 * compared per package name rather than per path, so a different hoisting by
 * another npm release is not reported as staleness.
 */
export const lockfileLagRecords = (before, after) => {
  const versionsByName = lock => {
    const versions = new Map();
    for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
      const name = key.split('node_modules/').at(-1);
      if (!key.includes('node_modules/') || !entry?.version || entry.link) continue;
      if (!versions.has(name)) versions.set(name, new Set());
      versions.get(name).add(entry.version);
    }
    return versions;
  };
  const listed = versions => (versions?.size ? [...versions].sort().join(', ') : 'absent');
  const previous = versionsByName(before),
    refreshed = versionsByName(after);
  const records = [];
  for (const name of new Set([...previous.keys(), ...refreshed.keys()])) {
    const current = listed(previous.get(name)),
      latest = listed(refreshed.get(name));
    if (current !== latest) records.push({ kind: 'lockfile', name, current, latest, policy: 'npm update', location: `package-lock.json#${name}` });
  }
  return records.sort((a, b) => a.name.localeCompare(b.name));
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

/** Newest stable `X.Y.Z` tag of a Docker Hub repository such as `library/rust`. */
export const resolveDockerHubLatest = async (repository, _record = {}, options = {}) => {
  const page = await fetchJson(`https://hub.docker.com/v2/repositories/${repository}/tags?page_size=100&ordering=last_updated`, options);
  const semanticTags = (page?.results ?? [])
    .map(tag => ({ tag: tag?.name, parsed: /^\d+\.\d+\.\d+$/.test(tag?.name ?? '') ? parseVersion(tag.name) : null }))
    .filter(candidate => candidate.parsed)
    .sort((left, right) => compareParsedVersions(right.parsed, left.parsed));
  if (semanticTags.length === 0) throw new Error(`Docker Hub returned no semantic tags for ${repository}`);
  return semanticTags[0].tag;
};

const containerTagSuffix = current => String(current ?? '').replace(/^v?\d+(?:\.\d+){0,2}/, '');

/**
 * Docker Registry v2 supports Docker Hub and registries advertising Bearer auth.
 * Registries page their tag lists (GHCR returns a few dozen per page), so every
 * `Link: rel="next"` page is read: stopping at the first page made the router
 * image resolve to 0.82.0 while 1.24.1 was published. A candidate must have as
 * many version components as the pin, so a date tag such as `20260621` is not
 * read as major version twenty million.
 */
export const resolveContainerLatest = async (name, record = {}, { fetchImpl = globalThis.fetch, maxPages = 50 } = {}) => {
  const parts = name.split('/');
  const custom = parts[0].includes('.') || parts[0].includes(':');
  const registry = custom ? parts.shift() : 'registry-1.docker.io';
  const repository = !custom && parts.length === 1 ? `library/${parts[0]}` : parts.join('/');
  let authorization = null;
  const fetchPage = async url => {
    let response = await fetchImpl(url, authorization ? { headers: { authorization } } : undefined);
    if (response.status === 401 && !authorization) {
      const auth = response.headers.get('www-authenticate') ?? '';
      const realm = auth.match(/realm="([^"]+)"/)?.[1];
      if (!realm?.startsWith('https://')) throw new Error('Registry has no HTTPS Bearer authentication realm');
      const tokenUrl = new URL(realm);
      for (const key of ['service', 'scope']) {
        const value = auth.match(new RegExp(`${key}="([^"]+)"`))?.[1];
        if (value) tokenUrl.searchParams.set(key, value);
      }
      const credentials = await fetchJson(tokenUrl.toString(), { fetchImpl });
      authorization = `Bearer ${credentials.token ?? credentials.access_token}`;
      response = await fetchImpl(url, { headers: { authorization } });
    }
    if (!response.ok) throw new Error(`Registry returned ${response.status}`);
    return response;
  };
  const tags = [];
  let url = `https://${registry}/v2/${repository}/tags/list?n=1000`;
  for (let page = 0; url; page++) {
    if (page === maxPages) throw new Error(`Registry tag list for ${name} exceeds ${maxPages} pages`);
    const response = await fetchPage(url);
    tags.push(...((await response.json()).tags ?? []));
    const next = response.headers?.get?.('link')?.match(/<([^>]+)>\s*;\s*rel="?next"?/)?.[1];
    url = next ? new URL(next, `https://${registry}`).toString() : null;
  }
  const suffix = containerTagSuffix(record.current).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const components =
    String(record.current ?? '')
      .match(/^v?(\d+(?:\.\d+){0,2})/)?.[1]
      .split('.').length ?? 3;
  const tagPattern = new RegExp(`^v?(\\d+${'(?:\\.\\d+)'.repeat(components - 1)})${suffix}$`);
  const candidates = tags
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
export const checkDependencyRecords = async (records, { resolveNpmLatest: npmResolver = resolveNpmLatest, resolveGitHubLatest: githubResolver = resolveGitHubLatest, resolveCrateLatest: crateResolver = resolveCrateLatest, resolveDockerHubLatest: dockerResolver = resolveDockerHubLatest, resolveContainerLatest: containerResolver = resolveContainerLatest, resolveOpenIssue: issueResolver = resolveOpenIssue } = {}) => {
  const latestByDependency = new Map(),
    current = [],
    stale = [],
    errors = [],
    exceptions = [];
  const resolvers = { npm: npmResolver, github: githubResolver, crate: crateResolver, docker: dockerResolver, container: containerResolver };
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

/**
 * Pull requests must converge on the newest releases before they merge (issue
 * #2264). After the merge, a release published in the meantime is a reason
 * for a new pull request, not for skipping main's tests and release (issue
 * #2625), so every other event only warns. Local runs stay strict.
 */
export const freshnessEnforcement = eventName => (!eventName || eventName === 'pull_request' || eventName === 'merge_group' ? 'fail' : 'warn');

/** Render the outcome for the given enforcement mode without printing it. */
export const formatFreshnessReport = ({ stale, errors, mode }) => {
  const staleText = record => `${record.location}: ${record.name} ${record.current} -> ${record.latest} (${record.policy})`;
  const errorText = record => `${record.location}: ${record.name}: ${record.error}`;
  if (stale.length === 0 && errors.length === 0) return { exitCode: 0, lines: ['All tracked dependency declarations are current.'], summary: '' };
  const heading = `${stale.length} stale, ${errors.length} unresolved`;
  const summary = [`### Dependency freshness: ${heading}`, '', ...stale.map(record => `- Stale: \`${staleText(record)}\``), ...errors.map(record => `- Unresolved: \`${errorText(record)}\``), ''].join('\n');
  if (mode === 'warn') {
    return {
      exitCode: 0,
      lines: [...stale.map(record => `::warning title=Stale dependency::${staleText(record)}`), ...errors.map(record => `::warning title=Unresolved dependency::${errorText(record)}`), `Dependency freshness: ${heading}; only pull requests are blocked, so open one to update.`],
      summary,
    };
  }
  return { exitCode: 1, lines: [...stale.map(record => `STALE ${staleText(record)}`), ...errors.map(record => `ERROR ${errorText(record)}`), `Dependency freshness failed: ${heading}.`], summary };
};
