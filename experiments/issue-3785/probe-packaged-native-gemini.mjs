#!/usr/bin/env node
/** Verify the published-package installation path against the tested native CLI. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const [installedPackage, upstreamPackage, testedPackage, destination] = process.argv.slice(2);
assert.ok(destination, 'Provide installed Hive Mind, pristine Gemini, tested Gemini and a fresh destination.');
assert.equal(JSON.parse(await fs.readFile(path.join(installedPackage, 'package.json'), 'utf8')).name, '@link-assistant/hive-mind');
const installer = path.join(installedPackage, 'src/native-gemini-package.lib.mjs');
assert.ok(
  await fs.stat(installer).then(
    () => true,
    () => false
  ),
  'The actual installed npm artifact must include its native Gemini installer.'
);
const { installNativeGemini, verifyNativeGemini } = await import(pathToFileURL(installer));
const result = await installNativeGemini({ source: upstreamPackage, destination });
assert.equal(result.version, '0.65.0');
const verified = await verifyNativeGemini(destination);
assert.equal(verified.version, '0.65.0');
assert.equal(await fs.realpath(destination), result.root);
assert.ok((await fs.lstat(destination)).isSymbolicLink(), 'Publish the complete generation with an exclusive directory link.');
for (const file of await fs.readdir(path.join(testedPackage, 'bundle'))) {
  if (!file.startsWith('hive-') && !['chunk-DKZARV6U.js', 'chunk-XHQ6TTKH.js', 'chunk-YTHYCFAB.js', 'gemini-GLQ4MVLB.js', 'interactiveCli-AVD3AKNJ.js'].includes(file)) continue;
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(await fs.readFile(path.join(destination, 'bundle', file))), digest(await fs.readFile(path.join(testedPackage, 'bundle', file))), `Installed native bytes must match the tested adapter: ${file}`);
}
console.log('PASS: the installed npm package produces the exact tested native Gemini adapter.');
const inventory = JSON.parse(await fs.readFile(path.join(installedPackage, 'src/native-gemini/recipe/upstream.json'), 'utf8'));
for (const [name, entry] of Object.entries(inventory)) {
  assert.equal(
    createHash('sha256')
      .update(await fs.readFile(path.join(upstreamPackage, name)))
      .digest('hex'),
    entry.split(':')[0],
    `Preserve the complete original upstream package: ${name}`
  );
}
const parent = path.dirname(destination);
const before = (await fs.readdir(parent)).sort();
assert.equal((await installNativeGemini({ source: upstreamPackage, destination })).root, result.root);
assert.deepEqual((await fs.readdir(parent)).sort(), before, 'Idempotent installation must not allocate another generation.');
console.log('PASS: every original upstream file is unchanged and reinstall retains the verified generation.');
const sourceLicense = path.join(upstreamPackage, 'LICENSE');
const licenseBytes = await fs.readFile(sourceLicense);
const refusedDestination = destination + '-changed-source';
await fs.writeFile(sourceLicense, 'synthetic changed upstream input\n');
try {
  await assert.rejects(installNativeGemini({ source: upstreamPackage, destination: refusedDestination }), /execution were refused/u);
  assert.equal(await fs.readFile(sourceLicense, 'utf8'), 'synthetic changed upstream input\n');
  await assert.rejects(fs.lstat(refusedDestination), { code: 'ENOENT' });
} finally {
  await fs.writeFile(sourceLicense, licenseBytes);
}
assert.deepEqual((await fs.readdir(parent)).sort(), before, 'Failed source verification leaves no incomplete executable generation.');
console.log('PASS: a changed upstream file refuses publication without overwriting that input or leaving a generation.');
const unexpected = path.join(destination, 'bundle/unapproved-adapter.mjs');
await fs.writeFile(unexpected, 'throw new Error("synthetic unapproved native executable");\n', { flag: 'wx' });
try {
  await assert.rejects(verifyNativeGemini(destination), /execution were refused/u);
} finally {
  await fs.unlink(unexpected);
}
const target = path.join(destination, 'bundle/hive-gemini-publication.mjs');
const original = await fs.readFile(target);
await fs.writeFile(target, Buffer.concat([original, Buffer.from('\n// synthetic changed installed helper\n')]));
try {
  await assert.rejects(verifyNativeGemini(destination), /execution were refused/u);
} finally {
  await fs.writeFile(target, original);
}
await verifyNativeGemini(destination);
console.log('PASS: extra executable files and changed native helper bytes refuse admission; the restored exact generation verifies.');
const { installNativeGeminiCommand, verifyNativeGeminiCommand } = await import(pathToFileURL(path.join(installedPackage, 'src/native-gemini-command.lib.mjs')));
const bin = path.join(path.dirname(installedPackage), 'bin');
await fs.mkdir(bin);
const command = path.join(bin, 'gemini');
await fs.symlink(path.join(upstreamPackage, 'bundle/gemini.js'), command);
await assert.rejects(verifyNativeGeminiCommand({ command }), /execution were refused/u);
const activated = await installNativeGeminiCommand({ command });
assert.equal(await fs.realpath(command), activated.entrypoint);
assert.equal((await verifyNativeGeminiCommand({ command: 'gemini', searchPath: bin })).root, activated.root);
const beforeReinstall = await fs.lstat(command);
assert.equal((await installNativeGeminiCommand({ command })).root, activated.root);
assert.equal((await fs.lstat(command)).ino, beforeReinstall.ino);
// No provider credentials/configuration or preload hooks enter this native probe.
const runtimeHome = path.join(path.dirname(installedPackage), 'version-home');
await fs.mkdir(runtimeHome);
const { stdout } = await promisify(execFile)(command, ['--version'], { env: { PATH: process.env.PATH, HOME: runtimeHome, GEMINI_CLI_HOME: runtimeHome }, cwd: runtimeHome, timeout: 30000, maxBuffer: 65536 });
assert.equal(stdout.trim(), '0.65.0');
await fs.writeFile(path.join(path.dirname(installedPackage), 'activated-root.txt'), activated.root + '\n', { flag: 'wx' });
console.log('PASS: the installed artifact rejects stock admission, activates the verified command, runs its native version and retains its bin inode on reinstall.');
