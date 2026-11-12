/** @hive-mind-test-suite default */
// Issue #4050: npm refused the 249,485,829-byte main tarball (E413) because it
// bundled both native Codex executables. They are now per-platform variant
// versions of the same package, installed as optional dependency aliases.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { nativeCodexPackagingFixture as packagingFixture } from './helpers/native-codex-fixture.mjs';
import { checkNpmTarballSizes, findOversizedTarballs, formatOversizedReport, NPM_TARBALL_BUDGET_BYTES } from '../scripts/check-npm-tarball-size.mjs';
import { optionalDependenciesFor, packVariants, publishVariants, readPlatforms, variantManifest, variantName, variantTag, variantVersion, wirePackage } from '../scripts/native-codex-packages.mjs';

const supported = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch);
const platform = `linux-${process.arch}`;
const main = { name: '@link-assistant/hive-mind', version: '2.40.2', repository: { type: 'git', url: 'https://github.com/link-assistant/hive-mind' } };
const quiet = { log() {}, error() {} };

const temporary = async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-codex-packages-4050-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
};

test('the budget stays below the largest tarball npm is known to accept', () => {
  // @openai/codex@0.164.0-linux-x64 (165,142,849 bytes) was accepted; 249,485,829 was refused.
  assert.ok(NPM_TARBALL_BUDGET_BYTES < 165142849);
  assert.deepEqual(
    findOversizedTarballs([
      { filename: 'a.tgz', size: 249485829 },
      { filename: 'b.tgz', size: 1024 },
    ]),
    [{ filename: 'a.tgz', size: 249485829 }]
  );
  assert.equal(findOversizedTarballs([{ filename: 'unknown.tgz' }]).length, 1, 'an unknown size is never admitted');
});

test('an oversized tarball fails fast with an annotation naming the largest files', () => {
  const errors = [];
  const entry = {
    name: main.name,
    version: '2.40.0',
    size: 249485829,
    files: [
      { path: 'src/native-codex/runtime/linux-x64/codex', size: 160000000 },
      { path: 'README.md', size: 10 },
    ],
  };
  assert.equal(checkNpmTarballSizes([entry], { log() {}, error: message => errors.push(message) }), 1);
  assert.match(errors[0], /^::error title=npm tarball over the publish budget::@link-assistant\/hive-mind@2\.40\.0 is 249485829 bytes/u);
  assert.ok(errors[0].indexOf('linux-x64/codex') < errors[0].indexOf('README.md'), 'largest file first');
  assert.ok(formatOversizedReport([entry]).includes('src/native-codex/PACKAGES.md'));
  assert.equal(checkNpmTarballSizes([], { log() {}, error() {} }), 1, 'nothing to check is a failure, not a pass');
  assert.equal(checkNpmTarballSizes([{ ...entry, size: 1024 }], quiet), 0);
});

test('the CLI checks archives on disk and honours the budget override', async t => {
  const root = await temporary(t);
  const archive = path.join(root, 'big.tgz');
  await fs.writeFile(archive, Buffer.alloc(2048));
  const script = fileURLToPath(new URL('../scripts/check-npm-tarball-size.mjs', import.meta.url));
  const run = budget => spawnSync(process.execPath, [script, archive], { encoding: 'utf8', env: { ...process.env, HIVE_MIND_NPM_TARBALL_BUDGET_BYTES: budget }, timeout: 10000 });
  assert.equal(run('4096').status, 0);
  const refused = run('1024');
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /::error title=npm tarball over the publish budget::/u);
  assert.notEqual(run('not-a-number').status, 0);
});

test('variant identities pin each platform to the exact main version', async () => {
  assert.deepEqual(await readPlatforms(), ['linux-x64', 'linux-arm64']);
  assert.equal(variantName(main.name, 'linux-x64'), '@link-assistant/hive-mind-native-codex-linux-x64');
  assert.equal(variantVersion(main.version, 'linux-arm64'), '2.40.2-native-codex-linux-arm64');
  assert.equal(variantTag('linux-x64'), 'native-codex-linux-x64');
  const manifest = variantManifest(main, 'linux-arm64');
  assert.equal(manifest.name, main.name, 'same name keeps OIDC trusted publishing working');
  assert.deepEqual([manifest.os, manifest.cpu, manifest.files], [['linux'], ['arm64'], ['runtime']]);
  for (const key of ['scripts', 'bin', 'dependencies', 'optionalDependencies', 'main']) assert.equal(manifest[key], undefined, key);
  assert.deepEqual(optionalDependenciesFor(main, ['linux-x64', 'linux-arm64']), {
    '@link-assistant/hive-mind-native-codex-linux-x64': 'npm:@link-assistant/hive-mind@2.40.2-native-codex-linux-x64',
    '@link-assistant/hive-mind-native-codex-linux-arm64': 'npm:@link-assistant/hive-mind@2.40.2-native-codex-linux-arm64',
  });
});

test('wiring is idempotent and keeps unrelated optional dependencies', async t => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ ...main, optionalDependencies: { other: '^1.0.0' } }));
  const first = await wirePackage(root, { log() {} });
  const second = await wirePackage(root, { log() {} });
  assert.deepEqual(first, second);
  const written = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(written.optionalDependencies.other, '^1.0.0');
  assert.equal(Object.keys(written.optionalDependencies).length, 3);
});

const variants = [
  { platform: 'linux-x64', name: main.name, version: '2.40.2-native-codex-linux-x64', tag: 'native-codex-linux-x64', size: 1, archive: '/tmp/x64.tgz' },
  { platform: 'linux-arm64', name: main.name, version: '2.40.2-native-codex-linux-arm64', tag: 'native-codex-linux-arm64', size: 1, archive: '/tmp/arm64.tgz' },
];

test('publishing skips variants already on the registry and publishes the rest under their dist-tag', async () => {
  const calls = [];
  const runner = async (command, args) => {
    calls.push([command, ...args].join(' '));
    if (args[0] === 'view') return args[1].endsWith('linux-x64') ? { code: 0, stdout: `${variants[0].version}\n` } : { code: 1, stdout: '', stderr: 'npm error 404' };
    return { code: 0, stdout: '+ published', stderr: '' };
  };
  await publishVariants(variants, { runner, env: {}, logger: quiet });
  assert.deepEqual(
    calls.filter(call => call.startsWith('npm publish')),
    ['npm publish /tmp/arm64.tgz --tag native-codex-linux-arm64 --access public']
  );
});

test('a version conflict is the same success as a completed publication', async () => {
  const runner = async (command, args) => (args[0] === 'view' ? { code: 1, stdout: '' } : { code: 1, stdout: '', stderr: `npm error 403 You cannot publish over the previously published versions: ${args[1].includes('x64') ? variants[0].version : variants[1].version}.` });
  await publishVariants(variants, { runner, env: {}, logger: quiet });
});

test('a refused variant upload stops before the main package with an annotated, classified error', async () => {
  const errors = [];
  let published = 0;
  const runner = async (command, args) => {
    if (args[0] === 'view') return { code: 1, stdout: '' };
    published++;
    return { code: 1, stdout: '', stderr: 'npm error code E413\nnpm error 413 Payload Too Large - PUT https://registry.npmjs.org/@link-assistant%2fhive-mind' };
  };
  await assert.rejects(publishVariants(variants, { runner, env: {}, logger: { log() {}, error: message => errors.push(message) } }), /^Error: npm error native Codex variant @link-assistant\/hive-mind@2\.40\.2-native-codex-linux-x64 failed to publish/u);
  assert.equal(published, 1, 'a payload refusal is not retried and the next variant is not attempted');
  assert.match(errors[0], /^::error title=/u);
});

test('packing stages exactly the platform runtime with independent bytes', { timeout: 30000, skip: !supported }, async t => {
  const f = await packagingFixture(t);
  const runtime = path.dirname(f.runtime);
  const out = path.join(f.root, 'out');
  const packed = await packVariants({ out, runtime, main, platforms: [platform], verify: false, log() {} });
  assert.equal(packed.length, 1);
  assert.equal(packed[0].version, `2.40.2-native-codex-${platform}`);
  assert.deepEqual(packed[0].files.map(file => file.path).sort(), ['package.json', ...(await fs.readdir(f.runtime, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.relative(path.join(f.variant, ''), path.join(entry.parentPath, entry.name)))].sort());
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, 'variants.json'), 'utf8'))[0].alias, `@link-assistant/hive-mind-native-codex-${platform}`);
  await assert.rejects(packVariants({ out: path.join(f.root, 'refused'), runtime, main, platforms: [platform], verify: false, budget: 16, log() {} }), /npm tarball over the publish budget/u);
  await assert.rejects(packVariants({ out: path.join(f.root, 'unknown'), runtime, main, platforms: ['linux-riscv64'], verify: false, log() {} }), /Unsupported native Codex platforms/u);
  const linked = path.join(runtime, platform, 'licenses/LINKED');
  await fs.link(path.join(f.runtime, 'licenses/LICENSE'), linked);
  await assert.rejects(packVariants({ out: path.join(f.root, 'linked'), runtime, main, platforms: [platform], verify: false, log() {} }), /non-regular native runtime entry/u);
});

test('the runtime admits only the variant whose version pins the main package', { timeout: 10000, skip: !supported }, async t => {
  const healthy = await packagingFixture(t);
  assert.equal((await healthy.api.verifyNativeCodexRuntime(healthy.runtime)).version, '0.164.0');
  const stale = await packagingFixture(t, { variantVersion: `1.2.2-native-codex-${platform}` });
  await assert.rejects(stale.api.installNativeCodexRuntime({ destination: stale.destination }), /execution were refused/u);
  await assert.rejects(fs.lstat(stale.destination), { code: 'ENOENT' });
});

test('a missing variant refuses; debug output names the phase and code, never a path', { timeout: 10000, skip: !supported }, async t => {
  const f = await packagingFixture(t);
  await fs.rm(f.variant, { recursive: true });
  const script = `const api = await import(${JSON.stringify(new URL(`file://${f.root}/src/native-codex-runtime.lib.mjs`).href)}); await api.installNativeCodexRuntime({ destination: ${JSON.stringify(f.destination)} }).catch(error => { console.log(error.message); process.exitCode = 3; });`;
  const run = debug => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, HIVE_MIND_NATIVE_CODEX_DEBUG: debug }, timeout: 10000 });
  const silent = run('');
  assert.equal(silent.status, 3);
  assert.equal(silent.stderr, '');
  const verbose = run('1');
  assert.equal(verbose.status, 3);
  assert.match(verbose.stderr, /\[native-codex\] Refused during packaged artifact admission \((?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)\)\./u);
  assert.ok(!verbose.stderr.includes(f.root), 'debug output must not disclose paths');
});
