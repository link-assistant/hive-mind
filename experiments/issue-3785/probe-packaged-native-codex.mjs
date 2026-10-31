/** Run through the actual installed npm module and its published native bytes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { pathToFileURL, fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const installed = await fs.realpath(process.argv[2]);
const output = path.resolve(process.argv[3]);
await fs.mkdir(output, { mode: 0o700 });
const { installNativeCodexRuntime, verifyNativeCodexRuntime } = await import(pathToFileURL(path.join(installed, 'src/native-codex-runtime.lib.mjs')));
const { installNativeCodexCommand, verifyNativeCodexCommand } = await import(pathToFileURL(path.join(installed, 'src/native-codex-command.lib.mjs')));
const source = path.join(installed, 'src/native-codex/runtime', `linux-${process.arch}`);
const sourceBefore = await fs.stat(path.join(source, 'codex'));
const destination = path.join(output, 'runtime');
const ready = await installNativeCodexRuntime({ destination });
assert.equal(ready.version, '0.164.0');
assert.equal((await verifyNativeCodexRuntime(destination)).entrypoint, ready.entrypoint);
const published = await fs.lstat(destination);
assert.equal((await installNativeCodexRuntime({ destination })).entrypoint, ready.entrypoint);
assert.equal((await fs.lstat(destination)).ino, published.ino);
assert.equal((await fs.stat(path.join(source, 'codex'))).ino, sourceBefore.ino);
console.log('PASS: actual npm module installs and verifies an idempotent native generation without changing its source.');

const binary = await fs.open(ready.entrypoint, 'r+');
const original = Buffer.alloc(1);
await binary.read(original, 0, 1, 64);
try {
  await binary.write(Buffer.from([original[0] ^ 255]), 0, 1, 64);
  await binary.sync();
  await assert.rejects(verifyNativeCodexRuntime(destination), /execution were refused/u);
} finally {
  await binary.write(original, 0, 1, 64);
  await binary.sync();
  await binary.close();
}
await verifyNativeCodexRuntime(destination);
const extra = path.join(ready.root, 'unadmitted-executable');
await fs.writeFile(extra, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
await assert.rejects(verifyNativeCodexRuntime(destination), /execution were refused/u);
await fs.unlink(extra);
await fs.chmod(ready.entrypoint, 0o600);
await assert.rejects(verifyNativeCodexRuntime(destination), /execution were refused/u);
await fs.chmod(ready.entrypoint, 0o755);
await verifyNativeCodexRuntime(destination);
const collision = path.join(output, 'collision');
await fs.writeFile(collision, 'existing runtime evidence\n', { mode: 0o600 });
const collisionBefore = await fs.stat(collision);
await assert.rejects(installNativeCodexRuntime({ destination: collision }), /execution were refused/u);
assert.equal(await fs.readFile(collision, 'utf8'), 'existing runtime evidence\n');
assert.equal((await fs.stat(collision)).ino, collisionBefore.ino);
assert.equal((await fs.readdir(output)).filter(name => name.startsWith('.hive-native-codex-')).length, 1);
console.log('PASS: changed binary bytes, extra executable, missing execution permission and destination collisions refuse without corrupting healthy source or prior state.');

const command = path.resolve(process.argv[4]);
const stock = await fs.realpath(command);
const stockBefore = await fs.stat(stock);
const stockBytes = await fs.readFile(stock);
const selected = await installNativeCodexCommand({ command });
assert.equal((await verifyNativeCodexCommand({ command })).entrypoint, selected.entrypoint);
const selectedLink = await fs.lstat(command);
assert.equal((await installNativeCodexCommand({ command })).entrypoint, selected.entrypoint);
assert.equal((await fs.lstat(command)).ino, selectedLink.ino);
assert.equal((await fs.stat(stock)).ino, stockBefore.ino);
assert.deepEqual(await fs.readFile(stock), stockBytes);
assert.equal(await fs.realpath(command), selected.entrypoint);
console.log('PASS: the actual npm-installed stock command selects the checked native generation idempotently while preserving the upstream launcher.');

for (const selection of ['configuration', 'cli', 'logs']) {
  const file = fileURLToPath(new URL('probe-codex-native-sqlite-authority.py', import.meta.url));
  await verifyNativeCodexCommand({ command });
  const result = await execute('python3', [file, command, '--case', selection], { maxBuffer: 262144 });
  process.stdout.write(result.stdout);
}

await verifyNativeCodexCommand({ command });
const capabilityProbe = fileURLToPath(new URL('probe-codex-native-capability-auth.mjs', import.meta.url));
// JITless avoids V8's large executable reservation under the inherited data
// bound; the real native Codex process keeps the same 512 MiB/16 MiB limits.
const capabilityResult = await execute('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', process.execPath, '--jitless', '--max-old-space-size=96', capabilityProbe, command, installed], { maxBuffer: 262144 });
process.stdout.write(capabilityResult.stdout);

await verifyNativeCodexCommand({ command });
const catalogueProbe = fileURLToPath(new URL('probe-codex-native-model-catalogue.mjs', import.meta.url));
const catalogueResult = await execute('prlimit', ['--data=536870912', '--stack=16777216', '--core=0', '--', process.execPath, '--jitless', '--max-old-space-size=96', catalogueProbe, command, installed], { maxBuffer: 262144 });
process.stdout.write(catalogueResult.stdout);

for (const [probe, flags] of [
  ['probe-codex-native-auth-root.mjs', []],
  ['probe-codex-native-request-auth.mjs', []],
  ['probe-codex-native-request-auth.mjs', ['--provider-overrides']],
  ['probe-codex-native-request-auth.mjs', ['--provider-constructors']],
]) {
  const file = fileURLToPath(new URL(probe, import.meta.url));
  await verifyNativeCodexCommand({ command });
  const result = await execute(process.execPath, ['--max-old-space-size=256', file, command, ...flags], { maxBuffer: 262144 });
  process.stdout.write(result.stdout);
}
console.log('PASS: complete native authentication and model-request controls use the selected command installed from the actual npm package.');

for (const probe of ['probe-codex-native-compression.py', 'probe-codex-native-tui-history.py', 'probe-codex-native-agent-identity.py']) {
  const file = fileURLToPath(new URL(probe, import.meta.url));
  await verifyNativeCodexCommand({ command });
  const result = await execute('python3', [file, command], { maxBuffer: 262144 });
  process.stdout.write(result.stdout);
}
for (const flags of [[], ['--repair-malformed']]) {
  const file = fileURLToPath(new URL('probe-codex-native-refresh-crash.mjs', import.meta.url));
  await verifyNativeCodexCommand({ command });
  const result = await execute(process.execPath, ['--max-old-space-size=256', file, command, ...flags], { maxBuffer: 262144 });
  process.stdout.write(result.stdout);
}
console.log('PASS: the installed selected command preserves peer history after private disposal, rejects unsafe TUI history and stale identity publication, and refuses uncertain refresh predecessors.');
