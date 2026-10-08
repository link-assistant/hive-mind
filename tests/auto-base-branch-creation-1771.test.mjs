/**
 * @hive-mind-test-suite default
 * Regression coverage for https://github.com/link-assistant/hive-mind/issues/1771.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseCliArgumentsWithLino } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig as solveConfig } from '../src/solve.config.lib.mjs';
import { createYargsConfig as hiveConfig, getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';

const issueUrl = 'https://github.com/o/r/issues/1';
const baseBranch = 'release/next';
const sha = 'a'.repeat(40);
const ok = stdout => ({ code: 0, stdout, stderr: '' });
const missing = { code: 1, stdout: '', stderr: 'gh: Branch not found (HTTP 404)' };

function parse(args, createYargsConfig = solveConfig) {
  return parseCliArgumentsWithLino({ argv: ['node', 'solve', issueUrl, ...args], createYargsConfig, positionalAliases: ['issue-url'], lenv: { enabled: false } });
}

function fakeGh(responses) {
  const calls = [];
  const run = async (strings, ...values) => {
    const command = strings.reduce((text, part, index) => text + part + (index < values.length ? values[index] : ''), '');
    calls.push(command);
    assert.ok(responses.length, `Unexpected command: ${command}`);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  };
  const $ = (first, ...values) => (Array.isArray(first) ? run(first, ...values) : run);
  return { $, calls };
}

async function ensure($, options = {}) {
  const { ensureBaseBranchExists } = await import('../src/solve.base-branch.lib.mjs');
  return ensureBaseBranchExists({ owner: 'o', repo: 'r', baseBranch, autoBaseBranchCreation: true, $, ...options });
}

test('CLI accepts the opt-in flag and boolean negation', { timeout: 30000 }, () => {
  assert.equal(parse(['--base-branch', baseBranch, '--auto-base-branch-creation']).autoBaseBranchCreation, true);
  assert.equal(parse([]).autoBaseBranchCreation, false);
  assert.equal(parse(['--auto-base-branch-creation=true']).autoBaseBranchCreation, true);
  assert.equal(parse(['--no-auto-base-branch-creation']).autoBaseBranchCreation, false);
  assert.equal(parse(['--auto-base-branch-creation=false']).autoBaseBranchCreation, false);
  assert.equal(parse(['--auto-base-branch-creation']).baseBranch, undefined);
});

test('hive accepts and forwards the flag', { timeout: 30000 }, () => {
  assert.equal(parse(['--auto-base-branch-creation'], hiveConfig).autoBaseBranchCreation, true);
  assert.ok(getSolvePassthroughOptionNames().includes('auto-base-branch-creation'));
});

test('creation is a no-op without the flag or an explicit base branch', { timeout: 30000 }, async () => {
  const { $, calls } = fakeGh([]);
  await ensure($, { autoBaseBranchCreation: false });
  await ensure($, { baseBranch: undefined });
  assert.deepEqual(calls, []);
});

test('existing branches are preserved without reading the default or posting a ref', { timeout: 30000 }, async () => {
  const { $, calls } = fakeGh([ok(baseBranch)]);
  await ensure($);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /branches\/release%2Fnext/);
});

test('a missing base branch is created in the target repository from its actual default branch', { timeout: 30000 }, async () => {
  const { $, calls } = fakeGh([missing, ok('trunk'), ok(sha), ok('refs/heads/release/next')]);
  const logs = [];
  await ensure($, { log: async message => logs.push(message) });
  assert.equal(calls.length, 4);
  assert.match(calls[1], /gh api repos\/o\/r --jq .default_branch/);
  assert.match(calls[2], /branches\/trunk --jq .commit.sha/);
  assert.match(calls[3], /gh api repos\/o\/r\/git\/refs.*--method POST/);
  assert.ok(calls[3].includes(`ref=refs/heads/${baseBranch}`));
  assert.ok(calls[3].includes(`sha=${sha}`));
  assert.ok(logs.some(line => line.includes(baseBranch) && line.includes('trunk')));
});

test('another worker creating the branch concurrently is accepted without overwriting it', { timeout: 30000 }, async () => {
  const { $, calls } = fakeGh([missing, ok('main'), ok(sha), { code: 1, stdout: '', stderr: 'Reference already exists (HTTP 422)' }, ok(baseBranch)]);
  await ensure($);
  assert.equal(calls.length, 5);
  assert.equal(calls.filter(command => command.includes('--method POST')).length, 1);
  assert.ok(calls.every(command => !command.includes('PATCH') && !command.includes('force')));
});

test('permission errors during creation are reported with target repository and branch', { timeout: 30000 }, async () => {
  const { $, calls } = fakeGh([missing, ok('main'), ok(sha), { code: 1, stdout: '', stderr: 'Resource not accessible by integration (HTTP 403)' }]);
  await assert.rejects(ensure($), /Cannot create base branch 'release\/next' in o\/r.*write access.*HTTP 403/s);
  assert.equal(calls.length, 4);
});

for (const failure of [{ code: 1, stdout: '', stderr: 'HTTP 401: Bad credentials' }, { code: 1, stdout: '', stderr: 'HTTP 503: Service Unavailable' }, new Error('connection failed')]) {
  test(`an indeterminate branch check never creates a ref (${failure.stderr || failure.message})`, { timeout: 30000 }, async () => {
    const { $, calls } = fakeGh([failure]);
    await assert.rejects(ensure($), /release\/next/);
    assert.equal(calls.length, 1);
  });
}

test('an unavailable or empty default branch never causes a POST', { timeout: 30000 }, async () => {
  for (const responses of [
    [missing, ok('')],
    [missing, ok('main'), missing],
    [missing, ok('main'), ok('null')],
  ]) {
    const { $, calls } = fakeGh(responses);
    await assert.rejects(ensure($), /default branch/);
    assert.ok(calls.every(command => !command.includes('--method POST')));
  }
});

test('invalid branch names are rejected before issuing commands', { timeout: 30000 }, async () => {
  const { $, calls } = fakeGh([]);
  await assert.rejects(ensure($, { baseBranch: 'https://github.com/o/r' }), /Invalid base branch/);
  assert.deepEqual(calls, []);
});

test('read-only entity preflight allows a missing base only when creation is enabled', { timeout: 30000 }, async () => {
  const { validateGitHubEntityExistence } = await import('../src/github-entity-validation.lib.mjs');
  for (const autoBaseBranchCreation of [false, true]) {
    const { $, calls } = fakeGh(autoBaseBranchCreation ? [ok('o'), ok('o/r')] : [ok('o'), ok('o/r'), missing, ok('main')]);
    const result = await validateGitHubEntityExistence({ owner: 'o', repo: 'r', baseBranch, autoBaseBranchCreation, $ });
    assert.equal(result.valid, autoBaseBranchCreation);
    if (!autoBaseBranchCreation) assert.equal(result.level, 'branch');
    assert.ok(calls.every(command => !command.includes('POST')));
  }
});

test('opting in still rejects missing users and repositories during read-only validation', { timeout: 30000 }, async () => {
  const { validateGitHubEntityExistence } = await import('../src/github-entity-validation.lib.mjs');
  for (const [responses, level] of [
    [[missing], 'user'],
    [[ok('o'), missing], 'repo'],
  ]) {
    const { $, calls } = fakeGh(responses);
    const result = await validateGitHubEntityExistence({ owner: 'o', repo: 'r', baseBranch, autoBaseBranchCreation: true, $ });
    assert.equal(result.valid, false);
    assert.equal(result.level, level);
    assert.ok(calls.every(command => !command.includes('POST')));
  }
});

test('CLI and Telegram pass the parsed option to preflight, and CLI creates after validation', { timeout: 30000 }, async () => {
  const solve = await readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  const telegram = await readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  const setup = await readFile(new URL('../src/solve.repo-setup.lib.mjs', import.meta.url), 'utf8');
  assert.match(solve, /validateGitHubEntityExistence\(\{[^\n]*autoBaseBranchCreation:.*argv\.autoBaseBranchCreation/);
  assert.match(telegram, /validateGitHubEntityExistence\(\{[^\n]*autoBaseBranchCreation:.*parsedSolveArgs\?\.autoBaseBranchCreation/);
  const validationPosition = solve.indexOf('if (!entityCheck.valid)');
  assert.ok(solve.indexOf('await setupRepositoryAndClone(') > validationPosition);
  assert.ok(setup.indexOf('await ensureBaseBranchExists(') < setup.indexOf('await cloneRepository('));
  assert.equal(telegram.includes('ensureBaseBranchExists('), false);
});
