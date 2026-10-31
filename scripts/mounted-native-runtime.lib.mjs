/** Copy the exact root-image CLI and its loader into an offline peer fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const digest = async filename => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename, { highWaterMark: 65536 })) hash.update(chunk);
  return hash.digest('hex');
};

export async function prepareMountedNativeRuntime(entrypoint, runtime, basename) {
  assert.match(basename, /^[a-z]+$/u);
  await fs.mkdir(path.join(runtime, 'lib'), { mode: 0o700 });
  const nativeHash = await digest(entrypoint);
  await fs.copyFile(entrypoint, path.join(runtime, basename));
  await fs.chmod(path.join(runtime, basename), 0o700);
  assert.equal(await digest(path.join(runtime, basename)), nativeHash);
  const { stdout } = await execute('ldd', [entrypoint], { maxBuffer: 65536, signal: AbortSignal.timeout(15_000) });
  const libraries = [...new Set([...stdout.matchAll(/(?:=>\s*)?(\/(?:usr\/)?lib[^\s]*)\s+\(0x[0-9a-f]+\)/gu)].map(match => match[1]))];
  const loader = libraries.find(filename => /^ld-linux[^/]*\.so\./u.test(path.basename(filename)));
  assert.ok(loader && libraries.length < 32, 'Native runtime dependencies are incomplete.');
  const basenames = new Set();
  for (const filename of libraries) {
    const name = path.basename(filename);
    assert.ok(!basenames.has(name), 'Ambiguous native runtime dependency.');
    basenames.add(name);
    await fs.copyFile(filename, path.join(runtime, 'lib', name));
    await fs.chmod(path.join(runtime, 'lib', name), 0o500);
  }
  return `/__native_runtime/lib/${path.basename(loader)} --library-path /__native_runtime/lib /__native_runtime/${basename}`;
}
