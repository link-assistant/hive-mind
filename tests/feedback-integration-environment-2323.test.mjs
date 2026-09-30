/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

test('feedback integration supplies Git identity on a fresh runner without changing its config', { timeout: 30_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'feedback-runner-'));
  try {
    const emptyConfig = join(root, 'gitconfig');
    writeFileSync(emptyConfig, '');
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith('GIT_CONFIG')) delete env[key];
    }
    Object.assign(env, {
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_SYSTEM: emptyConfig,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'init.defaultBranch',
      GIT_CONFIG_VALUE_0: 'main',
    });
    assert.equal(spawnSync('git', ['config', 'user.name'], { cwd: root, env }).status, 1, 'the runner has no Git identity');

    const mockPath = join(root, 'integration-mocks.mjs');
    writeFileSync(
      mockPath,
      `import assert from 'node:assert/strict';
import { execFileSync as run } from 'node:child_process';
import { writeFileSync } from 'node:fs';
export async function createGithubTestFixture() {
  return { repository: 'test/fixture', prNumber: 1, prUrl: 'https://github.com/test/fixture/pull/1', headBranch: 'feedback' };
}
export async function cleanupGithubTestFixture() { writeFileSync('cleanup-completed', 'yes'); }
export async function githubApi() { return { object: { sha: 'head' }, tree: { sha: 'tree' }, sha: 'baseline' }; }
export function execFileSync(command, args, options) {
  assert.equal(command, process.execPath);
  assert.ok(args.includes('--dry-run'));
  const gitOptions = { encoding: 'utf8', env: options.env || process.env };
  assert.match(run('git', ['config', 'user.name'], gitOptions).trim(), /\\S/);
  assert.match(run('git', ['config', 'user.email'], gitOptions).trim(), /@/);
  return 'Issue to solve: fixture\\nNew comments on the pull request: 2\\n';
}
`
    );
    const sourceUrl = new URL('./test-feedback-lines-integration.mjs', import.meta.url);
    let source = readFileSync(sourceUrl, 'utf8');
    source = source.replace("from 'node:child_process'", `from '${pathToFileURL(mockPath)}'`);
    source = source.replace(/from '(\.\.\/scripts\/[^']+)'/g, (match, specifier) => {
      const url = /github-(?:api|test-resources)\.lib\.mjs$/.test(specifier) ? pathToFileURL(mockPath) : new URL(specifier, sourceUrl);
      return `from '${url}'`;
    });
    const runner = join(root, 'feedback-integration.mjs');
    writeFileSync(runner, source);
    execFileSync(process.execPath, [runner], { cwd: root, env, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    assert.equal(readFileSync(join(root, 'cleanup-completed'), 'utf8'), 'yes', 'fixtures are cleaned up');
    assert.equal(readFileSync(emptyConfig, 'utf8'), '', 'the runner Git configuration is unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
