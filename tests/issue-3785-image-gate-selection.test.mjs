/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const detector = fileURLToPath(new URL('../scripts/detect-code-changes.mjs', import.meta.url));

test('the real detector requires image checks for packaged runtime and gate updates', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-image-selection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = args => execute('git', args, { cwd: root, env, maxBuffer: 64 * 1024 });
  await git(['init', '--initial-branch=main']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'base']);
  const base = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  for (const [file, expected] of [
    ['src/isolation-runner.lib.mjs', true],
    ['src/codex-stock-skills-0.164.0.json', true],
    ['package.json', true],
    ['package-lock.json', true],
    ['scripts/docker-pr-verify-mount-backing.mjs', true],
    ['scripts/verify-mounted-task-backing.mjs', true],
    ['scripts/verify-docker-image.sh', true],
    ['scripts/verify-dind-exec-defaults.sh', true],
    ['coolify/start.sh', true],
    ['docs/case-studies/issue-3785/README.md', false],
    ['experiments/issue-3785/probe-mount-namespace.mjs', false],
    ['tests/unrelated-unit.test.mjs', false],
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), 'synthetic fixture');
    await git(['add', file]);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'candidate']);
    const head = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const { stdout } = await execute(process.execPath, [detector], { cwd: root, env: { ...env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_ACTION: 'opened', GITHUB_BASE_SHA: base, GITHUB_HEAD_SHA: head }, maxBuffer: 128 * 1024 });
    assert.match(stdout, new RegExp(`^docker=${expected}$`, 'mu'), file);
    await git(['reset', '--hard', base]);
  }
});
