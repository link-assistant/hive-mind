/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const fixture = new URL('../experiments/issue-4161/', import.meta.url);
const solver = fileURLToPath(new URL('../src/solve.mjs', import.meta.url));
const root = mkdtempSync(path.join(os.tmpdir(), 'solve-dry-run-'));
after(() => rmSync(root, { recursive: true, force: true }));

const bin = path.join(root, 'bin');
mkdirSync(bin);
for (const command of ['gh', 'git']) {
  const destination = path.join(bin, command);
  copyFileSync(new URL(`${command}.sh`, fixture), destination);
  chmodSync(destination, 0o755);
}
const agent = path.join(bin, 'agent');
writeFileSync(agent, '#!/bin/sh\nprintf "WRITE started AI tool\\n" >> "$SOLVE_FIXTURE_COMMANDS"\nexit 1\n', { mode: 0o755 });
const git = (...args) => execFileSync('git', args, { stdio: 'pipe' });
const remote = path.join(root, 'remote');
git('init', '--initial-branch=main', remote);
git('-C', remote, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '--allow-empty', '--message=Base');
git('-C', remote, 'branch', 'issue-16-abcd1234');
git('-C', remote, 'branch', 'release');
git('-C', remote, 'update-ref', 'refs/pull/17/head', 'HEAD');
const emptyRemote = path.join(root, 'empty-remote');
git('init', '--initial-branch=main', emptyRemote);

const repoUrl = 'https://github.com/fixture/repo';
async function solveFixture(scenario, target, ...options) {
  const home = path.join(root, scenario);
  mkdirSync(home);
  writeFileSync(path.join(home, '.gitconfig'), '[user]\n  name = Fixture\n  email = fixture@example.test\n');
  const commandsPath = path.join(home, 'commands');
  writeFileSync(commandsPath, '');
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    HOME: home,
    TMPDIR: home,
    CI: 'true',
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_CONFIG_NOSYSTEM: '1',
    HIVE_MIND_DISABLE_GIT_AUTH_TRANSPORT: 'true',
    SOLVE_FIXTURE_COMMANDS: commandsPath,
    SOLVE_FIXTURE_CASE: scenario,
    SOLVE_FIXTURE_REAL_PATH: process.env.PATH,
    SOLVE_FIXTURE_REMOTE: scenario === 'empty' ? emptyRemote : remote,
  };
  const result = await exec(process.execPath, ['--import', fileURLToPath(new URL('preload.mjs', fixture)), solver, `${repoUrl}${target}`, '--tool', 'agent', '--language', 'en', '--no-share-geolocation', '--no-sentry', '--min-disk-space', '1', '--working-directory', path.join(home, 'work'), ...options], { cwd: home, env, timeout: 30_000, maxBuffer: 512 * 1024 }).catch(error => ({ ...error, code: error.code }));
  const commands = readFileSync(commandsPath, 'utf8');
  assert.doesNotMatch(commands, /^WRITE /m, commands);
  return { code: result.code ?? 0, output: `${result.stdout}\n${result.stderr}`, commands };
}

for (const { scenario, target, options, branch } of [
  { scenario: 'existing', target: '/issues/16', options: ['--dry-run', '--verbose'], branch: 'issue-16-abcd1234' },
  { scenario: 'pull', target: '/pull/17', options: ['--only-prepare-command', '--watch', '--base-branch', 'release', '--auto-merge-default-branch-to-pull-request-branch'], branch: 'issue-16-abcd1234' },
  { scenario: 'new', target: '/issues/16', options: ['--dry-run', '--no-auto-continue'], branch: 'issue-16-[a-f0-9]{12}' },
  { scenario: 'orphan', target: '/issues/16', options: ['--only-prepare-command'], branch: 'issue-16-abcd1234' },
  { scenario: 'fork', target: '/issues/16', options: ['--dry-run', '--fork', '--no-auto-continue'], branch: 'issue-16-[a-f0-9]{12}' },
  { scenario: 'fork-pull', target: '/pull/17', options: ['--only-prepare-command', '--fork', '--allow-to-push-to-contributors-pull-requests-as-maintainer'], branch: 'contributor-work' },
]) {
  test(`solve prepares the ${scenario} target without writing to GitHub`, { timeout: 35_000 }, async () => {
    const { code, output, commands } = await solveFixture(scenario, target, ...options);
    assert.equal(code, 0, output);
    assert.match(output, /Command prepared; AI execution skipped/);
    assert.match(output, /Raw command:/);
    assert.match(output, new RegExp(`Current branch:\\s+${branch}\\s`));
    assert.match(commands, /^gh repo clone /m);
    if (scenario === 'existing') {
      assert.match(output, /Using existing PR:\s+#17/);
      assert.match(output, /skipping session-start comment and draft conversion/);
    }
    if (scenario === 'fork-pull') assert.match(output, /Fetched PR ref:\s+refs\/pull\/17\/head/);
  });
}

test('the agent-commander adapter exits after printing its prepared command', { timeout: 35_000 }, async () => {
  const { code, output } = await solveFixture('commander', '/pull/17', '--dry-run', '--use-agent-commander', '--watch');
  assert.equal(code, 0, output);
  assert.match(output, /Dry run - command that would be executed:/);
  assert.match(output, /Command prepared; AI execution skipped/);
});

test('solve previews the repository plan without creating or updating a combined issue', { timeout: 35_000 }, async () => {
  const { code, output, commands } = await solveFixture('repository', '', '--dry-run');
  assert.equal(code, 0, output);
  assert.match(output, /combined issue plan prepared/);
  assert.match(commands, /^gh api .*\/issues\?/m);
});

test('a failed preparation does not initialize the repository or publish failure reports', { timeout: 35_000 }, async () => {
  const { code, output } = await solveFixture('empty', '/issues/16', '--dry-run', '--no-auto-continue', '--auto-init-repository', '--attach-logs', '--auto-close-pull-request-on-fail');
  assert.equal(code, 1, output);
  assert.match(output, /Command preparation needs a repository with at least one commit/);
});
