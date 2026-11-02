// Reuse the pinned Codex package's native search executable in the image PATH.
// Agent's shared data/bin is deliberately masked by a non-executable tmpfs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);

export async function installImageRipgrep({ codexRoot, destination, arch = process.arch }) {
  assert.ok(['x64', 'arm64'].includes(arch), 'Unsupported image search architecture.');
  const require = createRequire(path.join(codexRoot, 'package.json'));
  const codex = JSON.parse(await fs.readFile(path.join(codexRoot, 'package.json'), 'utf8'));
  assert.equal(codex.version, '0.164.0', 'Image search must come from the pinned Codex package.');
  const platformRoot = path.dirname(require.resolve(`@openai/codex-linux-${arch}/package.json`));
  const platform = JSON.parse(await fs.readFile(path.join(platformRoot, 'package.json'), 'utf8'));
  assert.equal(platform.version, `${codex.version}-linux-${arch}`, 'Image search platform package differs from the CLI pin.');
  const triple = arch === 'x64' ? 'x86_64-unknown-linux-musl' : 'aarch64-unknown-linux-musl';
  const source = path.join(platformRoot, 'vendor', triple, 'codex-path/rg');
  const previous = await fs.lstat(destination).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  assert.ok(!previous || (previous.isFile() && !previous.isSymbolicLink() && previous.nlink === 1), 'Unsafe image search destination.');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(path.dirname(destination), `.rg-${randomUUID()}`);
  try {
    await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
    await fs.chmod(temporary, 0o755);
    const { stdout } = await execute(temporary, ['--version'], { env: { PATH: '/usr/bin:/bin' }, cwd: path.dirname(temporary), maxBuffer: 16 * 1024, signal: AbortSignal.timeout(10_000) });
    assert.match(stdout, /^ripgrep \d+\.\d+\.\d+\b/u, 'Pinned image search executable did not start.');
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await installImageRipgrep({ codexRoot: process.argv[2], destination: process.argv[3] });
    console.log('Pinned native image search executable installed.');
  } catch {
    console.error('Could not install the pinned native image search executable.');
    process.exitCode = 1;
  }
}
