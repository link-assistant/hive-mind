#!/usr/bin/env node
/**
 * `/fix --update-all-dependencies` Dependabot auto-merge — Issue #2885
 *
 * The dependency mode merges open Dependabot PRs (sequentially, after CI)
 * before creating its issue. It is on by default and turned off with
 * `--no-auto-merge-dependabot`.
 *
 * Run with: node tests/test-fix-dependabot-merge-2885.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2885
 */

import assert from 'node:assert/strict';
import { FIX_OWNED_BOOLEAN_FLAGS, buildSolveArgs, parseAutoMergeDependabotFlag, partitionFixArgs } from '../src/fix.args.lib.mjs';
import { buildDependabotMergeContextLines, runDependabotAutoMerge, shouldAutoMergeDependabot } from '../src/fix.dependabot-merge.lib.mjs';
import { buildUpdateDependenciesIssueBody } from '../src/fix.update-dependencies.lib.mjs';
import { FIX_OWN_OPTIONS, validateFixCommandOptions } from '../src/telegram-fix-command.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

const repository = { owner: 'owner', repo: 'repo', fullName: 'owner/repo', url: 'https://github.com/owner/repo' };
const pr = number => ({ number, title: `bump dep ${number}`, url: `https://github.com/owner/repo/pull/${number}` });

console.log('\n📋 Issue #2885: /fix --[no-]auto-merge-dependabot parsing\n');

await test('auto-merge is on by default for --update-all-dependencies only', () => {
  assert.equal(shouldAutoMergeDependabot(partitionFixArgs(['owner/repo', '--update-all-dependencies'])), true);
  assert.equal(shouldAutoMergeDependabot(partitionFixArgs(['owner/repo', '--ci-cd'])), false);
});

await test('--no-auto-merge-dependabot turns it off and is not forwarded to /solve', () => {
  const parsed = partitionFixArgs(['owner/repo', '--update-all-dependencies', '--no-auto-merge-dependabot', '--tool', 'codex']);
  assert.equal(parsed.autoMergeDependabot, false);
  assert.equal(shouldAutoMergeDependabot(parsed), false);
  assert.deepEqual(parsed.passthrough, ['--tool', 'codex']);
  assert.equal(
    buildSolveArgs({ issueUrl: 'https://github.com/owner/repo/issues/1', passthrough: parsed.passthrough, mode: parsed.mode }).some(arg => arg.includes('dependabot')),
    false
  );
});

await test('--auto-merge-dependabot[=bool] forms are parsed', () => {
  assert.equal(parseAutoMergeDependabotFlag('--auto-merge-dependabot'), true);
  assert.equal(parseAutoMergeDependabotFlag('--no-auto-merge-dependabot'), false);
  assert.equal(parseAutoMergeDependabotFlag('--auto-merge-dependabot=false'), false);
  assert.equal(parseAutoMergeDependabotFlag('--auto-merge-dependabot=true'), true);
  assert.equal(parseAutoMergeDependabotFlag('--auto-merge'), null);
  assert.equal(shouldAutoMergeDependabot(partitionFixArgs(['owner/repo', '--update-all-dependencies', '--auto-merge-dependabot=off'])), false);
  assert.equal(shouldAutoMergeDependabot(partitionFixArgs(['owner/repo', '--ci-cd', '--auto-merge-dependabot'])), true);
});

await test('the flags are fix-owned for both the CLI and the Telegram validator', async () => {
  assert.ok(FIX_OWNED_BOOLEAN_FLAGS.includes('--no-auto-merge-dependabot'));
  assert.ok(FIX_OWN_OPTIONS.includes('--no-auto-merge-dependabot'));
  assert.equal(await validateFixCommandOptions(['https://github.com/owner/repo', '--update-all-dependencies', '--no-auto-merge-dependabot']), null);
  assert.equal(await validateFixCommandOptions(['https://github.com/owner/repo', '--update-all-dependencies', '--no-auto-merge-dependabt']), 'Unknown option "--no-auto-merge-dependabt". Did you mean "--no-auto-merge-dependabot"?');
});

console.log('\n📋 Issue #2885: runDependabotAutoMerge\n');

function stubProcessor({ init, items = [], runResult = { success: true } }) {
  const created = [];
  const createProcessor = async options => {
    created.push(options);
    return { items, initialize: async () => init, run: async () => runResult };
  };
  return { created, createProcessor };
}

await test('merges through a Dependabot-only merge queue and summarizes the outcome', async () => {
  const logs = [];
  const { created, createProcessor } = stubProcessor({
    init: { success: true, count: 3 },
    items: [
      { pr: pr(1), status: 'merged' },
      { pr: pr(2), status: 'failed', error: 'CI checks failed' },
      { pr: pr(3), status: 'pending' },
    ],
    runResult: { success: false, error: 'Post-merge CI failed' },
  });
  const summary = await runDependabotAutoMerge({ repository, createProcessor, log: message => logs.push(message) });
  assert.deepEqual(created, [{ owner: 'owner', repo: 'repo', verbose: false, dependabot: true, includeReadyPRs: false }]);
  assert.equal(summary.found, 3);
  assert.deepEqual(
    summary.merged.map(item => item.number),
    [1]
  );
  assert.deepEqual(
    summary.unmerged.map(item => [item.number, item.reason]),
    [
      [2, 'CI checks failed'],
      [3, 'not processed'],
    ]
  );
  assert.equal(summary.error, 'Post-merge CI failed');
  assert.ok(logs.some(line => line.includes('Merged #1')));
});

await test('nothing to merge is reported, not treated as an error', async () => {
  const logs = [];
  const { createProcessor } = stubProcessor({ init: { success: true, message: 'No open Dependabot PRs found' } });
  const summary = await runDependabotAutoMerge({ repository, createProcessor, log: message => logs.push(message) });
  assert.equal(summary.found, 0);
  assert.equal(summary.error, null);
  assert.ok(logs[0].includes('No open Dependabot PRs found'));
});

await test('a failure never throws, so /fix still creates the issue', async () => {
  const { createProcessor } = stubProcessor({ init: { success: false, error: 'HTTP 403' } });
  const summary = await runDependabotAutoMerge({ repository, createProcessor, log: () => {} });
  assert.equal(summary.error, 'HTTP 403');
  const throwing = await runDependabotAutoMerge({
    repository,
    log: () => {},
    createProcessor: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(throwing.error, 'boom');
});

await test('dry run only lists the Dependabot PRs and never builds a merge queue', async () => {
  const logs = [];
  const summary = await runDependabotAutoMerge({
    repository,
    dryRun: true,
    log: message => logs.push(message),
    fetchDependabotPullRequests: async () => [pr(4), pr(5)],
    createProcessor: async () => {
      throw new Error('must not merge in dry run');
    },
  });
  assert.equal(summary.found, 2);
  assert.equal(summary.merged.length, 0);
  assert.equal(summary.error, null);
  assert.ok(logs[0].includes('would merge 2'));
});

console.log('\n📋 Issue #2885: issue body context\n');

await test('the generated issue records merged and still-open Dependabot PRs', () => {
  const dependabotMerge = { dryRun: false, found: 2, merged: [pr(1)], unmerged: [{ ...pr(2), reason: 'CI checks failed' }], error: null };
  const lines = buildDependabotMergeContextLines(dependabotMerge);
  assert.deepEqual(lines, ['- **Dependabot PRs merged by `/fix`:** 1 (#1)', "- **Dependabot PRs left open:** #2 (CI checks failed). Cover these updates in this issue's pull request as well."]);
  const body = buildUpdateDependenciesIssueBody({ repository, defaultBranch: 'main', commit: null, languages: { JavaScript: 1 }, files: ['package.json'], dependabotMerge });
  for (const line of lines) assert.ok(body.includes(line), line);
  assert.equal(buildUpdateDependenciesIssueBody({ repository, defaultBranch: 'main', commit: null, languages: { JavaScript: 1 }, files: ['package.json'] }).includes('Dependabot PRs merged'), false);
  assert.deepEqual(buildDependabotMergeContextLines({ ...dependabotMerge, dryRun: true }), []);
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
