// Run the current regression against an earlier workflow without changing the checkout.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const revision = process.argv[2] || '4c96f79544c327bd908c565472fce365c41be312';
assert.match(revision, /^[a-f0-9]{7,40}$/u);
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-release-before-'));
try {
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const { stdout } = await execute('git', ['show', `${revision}:.github/workflows/release.yml`], { env, maxBuffer: 256 * 1024 });
  const workflow = path.join(fixture, 'release.yml');
  await fs.writeFile(workflow, stdout);
  const source = await fs.readFile(new URL('../../tests/issue-3785-release-image-gate.test.mjs', import.meta.url), 'utf8');
  const selector = "new URL('../.github/workflows/release.yml', import.meta.url)";
  assert.equal(source.split(selector).length, 2);
  const test = path.join(fixture, 'before.test.mjs');
  await fs.writeFile(test, source.replace(selector, JSON.stringify(workflow)));
  const result = await execute(process.execPath, ['--test', test], { env, cwd: fileURLToPath(new URL('../../', import.meta.url)), maxBuffer: 256 * 1024 }).catch(error => {
    assert.ok(Number.isInteger(error.code), 'The regression subprocess must complete with a real exit status.');
    return { code: error.code, stdout: error.stdout };
  });
  process.stdout.write(result.stdout);
  process.exitCode = result.code || 0;
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
