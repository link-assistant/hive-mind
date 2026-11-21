#!/usr/bin/env node
/**
 * Issue #4050: can one npm package name carry per-platform native payloads as
 * prerelease "variant" versions, the way @openai/codex does, for both npm and
 * Bun global installs?
 *
 * A local in-memory registry serves tiny fake packages, so nothing is published
 * and nothing large is downloaded. It answers:
 *   1. npm `files` negation keeps the runtime out of the main tarball;
 *   2. npm (local and -g) and Bun (-g, copyfile) install the alias optional
 *      dependency `@link-assistant/hive-mind-native-codex-<platform>` from
 *      `npm:@link-assistant/hive-mind@<v>-native-codex-<platform>`, skipping the
 *      other CPU via `os`/`cpu`;
 *   3. the installed files have nlink 1 and mode 0755 for the executable;
 *   4. `createRequire(main/src).resolve(alias/package.json)` finds it;
 *   5. a later unrelated `bun install -g` keeps the variant bytes (same inode);
 *   6. local tarballs install under the alias with `alias@file:` (npm) — the
 *      path used before a release exists (PR images, installed-runtime CI).
 *
 * Usage: node experiments/issue-4050/fake-registry-variant-install.mjs [--keep]
 */
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const keep = process.argv.includes('--keep');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-4050-variants-'));
const NAME = '@link-assistant/hive-mind';
const VERSION = '9.9.9';
const platform = `linux-${process.arch}`;
const platforms = ['linux-x64', 'linux-arm64'];
const alias = p => `${NAME}-native-codex-${p}`;
const results = [];
const record = (name, value) => {
  results.push([name, value]);
  console.log(`${value ? 'PASS' : 'FAIL'}: ${name}`);
};
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...opts });
// The registry is served by this process, so installs must not block its event loop.
const run = async (cmd, args, opts = {}) => (await promisify(execFile)(cmd, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 1 << 24, ...opts })).stdout;

const write = (file, content, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
};
const pack = dir => {
  const out = JSON.parse(sh('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', path.join(root, 'tarballs')], { cwd: dir }));
  return { file: path.join(root, 'tarballs', out[0].filename), entries: out[0].files.map(f => f.path) };
};
fs.mkdirSync(path.join(root, 'tarballs'));

// Variant packages: same name, prerelease version per platform.
const manifests = {};
const tarballs = {};
for (const p of platforms) {
  const dir = path.join(root, 'stage', p);
  const version = `${VERSION}-native-codex-${p}`;
  const pkg = { name: NAME, version, os: ['linux'], cpu: [p.slice('linux-'.length)], files: ['runtime'], license: 'Unlicense' };
  write(path.join(dir, 'package.json'), JSON.stringify(pkg));
  write(path.join(dir, 'runtime', p, 'codex'), `#!/bin/sh\necho ${p}\n`, 0o755);
  write(path.join(dir, 'runtime', p, 'manifest.json'), JSON.stringify({ platform: p }));
  const packed = pack(dir);
  manifests[version] = pkg;
  tarballs[version] = packed.file;
}

// Main package: runtime exists in the working tree but is excluded by `files`.
const mainDir = path.join(root, 'stage', 'main');
const optionalDependencies = Object.fromEntries(platforms.map(p => [alias(p), `npm:${NAME}@${VERSION}-native-codex-${p}`]));
const mainPkg = { name: NAME, version: VERSION, type: 'module', bin: { hive: 'src/hive.mjs' }, files: ['src', '!src/native-codex/runtime'], optionalDependencies, license: 'Unlicense' };
write(path.join(mainDir, 'package.json'), JSON.stringify(mainPkg));
write(path.join(mainDir, 'src', 'hive.mjs'), `#!/usr/bin/env node\nconsole.log('${VERSION}');\n`, 0o755);
write(path.join(mainDir, 'src', 'resolve.mjs'), `import { createRequire } from 'node:module';\nimport path from 'node:path';\nconst r = createRequire(import.meta.url);\nconsole.log(path.dirname(r.resolve('${alias(platform)}/package.json')));\n`);
write(path.join(mainDir, 'src', 'native-codex', 'recipe.json'), '{}');
write(path.join(mainDir, 'src', 'native-codex', 'runtime', platform, 'codex'), 'stale\n', 0o755);
const mainPacked = pack(mainDir);
record('files negation keeps src/native-codex/runtime out of the main tarball', !mainPacked.entries.some(e => e.startsWith('src/native-codex/runtime')) && mainPacked.entries.includes('src/native-codex/recipe.json'));
manifests[VERSION] = mainPkg;
tarballs[VERSION] = mainPacked.file;

// A second, unrelated package for "later global install" checks.
const otherDir = path.join(root, 'stage', 'other');
write(path.join(otherDir, 'package.json'), JSON.stringify({ name: 'issue-4050-other', version: '1.0.0', bin: { other: 'o.js' }, license: 'Unlicense' }));
write(path.join(otherDir, 'o.js'), '#!/usr/bin/env node\n', 0o755);
const otherTar = pack(otherDir).file;

const digest = (file, algo, enc) => createHash(algo).update(fs.readFileSync(file)).digest(enc);
let base;
const packument = name => {
  if (name === 'issue-4050-other') {
    return { name, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { name, version: '1.0.0', bin: { other: 'o.js' }, dist: { tarball: `${base}/t/other.tgz`, shasum: digest(otherTar, 'sha1', 'hex'), integrity: `sha512-${digest(otherTar, 'sha512', 'base64')}` } } } };
  }
  if (name !== NAME) return null;
  const versions = {};
  for (const [v, m] of Object.entries(manifests)) versions[v] = { ...m, dist: { tarball: `${base}/t/${encodeURIComponent(v)}.tgz`, shasum: digest(tarballs[v], 'sha1', 'hex'), integrity: `sha512-${digest(tarballs[v], 'sha512', 'base64')}` } };
  return { name, 'dist-tags': { latest: VERSION, ...Object.fromEntries(platforms.map(p => [`native-codex-${p}`, `${VERSION}-native-codex-${p}`])) }, versions };
};
const requests = [];
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  requests.push(url);
  if (url.startsWith('/t/')) {
    const key = url.slice(3, -4);
    const file = key === 'other' ? otherTar : tarballs[key];
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }
  const body = packument(url.slice(1));
  if (!body) return res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
base = `http://127.0.0.1:${server.address().port}`;

const npmEnv = { ...process.env, npm_config_registry: `${base}/`, npm_config_cache: path.join(root, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_userconfig: path.join(root, 'npmrc') };
fs.writeFileSync(path.join(root, 'npmrc'), `registry=${base}/\n`);
const statOf = file => fs.statSync(file);
const checkInstall = (label, nodeModules, mainRoot = path.join(nodeModules, NAME)) => {
  const variant = path.join(nodeModules, alias(platform));
  const other = path.join(nodeModules, alias(platforms.find(p => p !== platform)));
  const codex = path.join(variant, 'runtime', platform, 'codex');
  const ok = fs.existsSync(codex);
  record(`${label}: alias optional dependency installed at ${path.relative(root, variant)}`, ok);
  if (!ok) return null;
  const s = statOf(codex);
  record(`${label}: executable mode 0755 and nlink 1 (mode ${(s.mode & 0o777).toString(8)}, nlink ${s.nlink})`, (s.mode & 0o777) === 0o755 && s.nlink === 1);
  record(`${label}: the other CPU's variant is skipped`, !fs.existsSync(other));
  const resolved = sh(process.execPath, [path.join(mainRoot, 'src', 'resolve.mjs')]).trim();
  record(`${label}: createRequire(main/src).resolve finds the variant (${path.relative(root, resolved)})`, fs.realpathSync(resolved) === fs.realpathSync(variant));
  record(`${label}: main package has no bundled runtime`, !fs.existsSync(path.join(mainRoot, 'src', 'native-codex', 'runtime')));
  return s.ino;
};

try {
  // 1. npm local install from the registry.
  const local = path.join(root, 'npm-local');
  await run('npm', ['install', '--prefix', local, '--ignore-scripts', `${NAME}@${VERSION}`], { env: npmEnv });
  checkInstall('npm local', path.join(local, 'node_modules'));

  // 2. npm global install from the registry.
  const globalPrefix = path.join(root, 'npm-global');
  await run('npm', ['install', '-g', '--prefix', globalPrefix, '--ignore-scripts', `${NAME}@${VERSION}`], { env: npmEnv });
  checkInstall('npm -g', path.join(globalPrefix, 'lib', 'node_modules', NAME, 'node_modules'), path.join(globalPrefix, 'lib', 'node_modules', NAME));

  // 3. Bun global copyfile install from the registry, then an unrelated later install.
  let bunVersion = null;
  try {
    bunVersion = sh('bun', ['--version']).trim();
  } catch {
    console.log('SKIP: bun is not installed');
  }
  if (bunVersion) {
    const bunEnv = { ...process.env, BUN_INSTALL: path.join(root, 'bun'), BUN_INSTALL_CACHE_DIR: path.join(root, 'bun-cache'), BUN_CONFIG_REGISTRY: `${base}/`, NPM_CONFIG_REGISTRY: `${base}/`, PATH: `${path.join(root, 'bun', 'bin')}:${process.env.PATH}` };
    await run('bun', ['install', '--backend=copyfile', '-g', `${NAME}@${VERSION}`], { env: bunEnv, cwd: root });
    const bunModules = path.join(root, 'bun', 'install', 'global', 'node_modules');
    const before = checkInstall(`bun ${bunVersion} -g copyfile`, bunModules);
    await run('bun', ['install', '--backend=copyfile', '-g', 'issue-4050-other@1.0.0'], { env: bunEnv, cwd: root });
    const codex = path.join(bunModules, alias(platform), 'runtime', platform, 'codex');
    record('bun: a later unrelated global install keeps the variant bytes (same inode)', before !== null && fs.existsSync(codex) && statOf(codex).ino === before);

    // 3b. Pre-release path: Bun global install of the main tarball (without the
    // registry alias) plus the variant extracted under the alias directory, then
    // a later unrelated install. Does Bun prune the extracted directory?
    const prEnv = { ...bunEnv, BUN_INSTALL: path.join(root, 'bun-pr'), PATH: `${path.join(root, 'bun-pr', 'bin')}:${process.env.PATH}` };
    const prMainDir = path.join(root, 'stage', 'main-pr');
    fs.cpSync(mainDir, prMainDir, { recursive: true });
    const prPkg = { ...mainPkg };
    delete prPkg.optionalDependencies;
    fs.writeFileSync(path.join(prMainDir, 'package.json'), JSON.stringify(prPkg));
    const prMain = pack(prMainDir).file;
    await run('bun', ['install', '--backend=copyfile', '-g', prMain], { env: prEnv, cwd: root });
    const prModules = path.join(root, 'bun-pr', 'install', 'global', 'node_modules');
    const target = path.join(prModules, alias(platform));
    fs.mkdirSync(target, { recursive: true });
    sh('tar', ['-xzf', tarballs[`${VERSION}-native-codex-${platform}`], '-C', target, '--strip-components=1', '--no-same-owner']);
    const prBefore = checkInstall('bun PR tarball + extracted variant', prModules);
    await run('bun', ['install', '--backend=copyfile', '-g', 'issue-4050-other@1.0.0'], { env: prEnv, cwd: root });
    const prCodex = path.join(target, 'runtime', platform, 'codex');
    record('bun PR path: a later unrelated global install keeps the extracted variant (same inode)', prBefore !== null && fs.existsSync(prCodex) && statOf(prCodex).ino === prBefore);
  }

  // 4. npm alias@file: local tarballs (installed-runtime CI before a release).
  const fileInstall = path.join(root, 'npm-file');
  const prMainForNpm = path.join(root, 'stage', 'main-pr');
  const prArchive = fs.existsSync(prMainForNpm) ? fs.readdirSync(path.join(root, 'tarballs')).find(f => f.startsWith('link-assistant-hive-mind-9.9.9.tgz')) : null;
  void prArchive;
  try {
    await run('npm', ['install', '--prefix', fileInstall, '--ignore-scripts', '--omit=optional', mainPacked.file, `${alias(platform)}@file:${tarballs[`${VERSION}-native-codex-${platform}`]}`], { env: npmEnv });
    checkInstall('npm alias@file: with --omit=optional', path.join(fileInstall, 'node_modules'));
  } catch (error) {
    record(
      `npm alias@file: install (${String(error.stderr || error.message)
        .split('\n')
        .find(Boolean)})`,
      false
    );
  }
} finally {
  server.close();
  console.log(`\nRegistry requests: ${[...new Set(requests)].join(', ')}`);
  if (keep) console.log(`Kept ${root}`);
  else fs.rmSync(root, { recursive: true, force: true });
}
const failed = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exitCode = failed.length ? 1 : 0;
