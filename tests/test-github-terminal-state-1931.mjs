#!/usr/bin/env node

/**
 * Unit Tests: Issue #1931 - stop when watched GitHub entities disappear
 *
 * Reproduces the stuck auto-merge/watch failure where a deleted or inaccessible
 * repository produced repeated GitHub 404 / GraphQL repository errors, but the
 * watcher kept treating that as an unknown CI status and slept forever.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1931
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkGitHubTerminalState, isTerminalGitHubEntityError } from '../src/github-terminal-state.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${error.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const out = value => ({
  toString: () => (typeof value === 'string' ? value : JSON.stringify(value)),
});

const commandText = (strings, values) => strings.reduce((acc, part, index) => `${acc}${part}${index < values.length ? String(values[index]) : ''}`, '');

function createRunner(responses) {
  const calls = [];
  const runner = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);
    const response = responses.find(entry => command.includes(entry.includes));
    if (!response) {
      throw new Error(`Unexpected command: ${command}`);
    }
    if (response.throw) {
      const error = new Error(response.stderr || response.stdout || 'Command failed');
      error.stderr = out(response.stderr || '');
      error.stdout = out(response.stdout || '');
      error.code = response.code || 1;
      throw error;
    }
    return {
      code: response.code ?? 0,
      stdout: out(response.stdout ?? ''),
      stderr: out(response.stderr ?? ''),
    };
  };
  runner.calls = calls;
  return runner;
}

const repoOk = {
  full_name: 'acme/widgets',
  default_branch: 'main',
};

const openPr = {
  number: 7,
  state: 'open',
  merged: false,
  head: {
    ref: 'issue-7-fix',
    repo: { full_name: 'acme/widgets' },
  },
  base: {
    ref: 'main',
    repo: { full_name: 'acme/widgets' },
  },
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1931 - GitHub terminal entity state');
console.log('================================================================================\n');

await test('Recognizes deleted/inaccessible repository errors as terminal', async () => {
  assert(isTerminalGitHubEntityError("GraphQL: Could not resolve to a Repository with the name 'acme/widgets'. (repository)"), 'GraphQL repository lookup failure must be terminal');
  assert(isTerminalGitHubEntityError('gh: Not Found (HTTP 404)'), 'REST 404 must be terminal');
  assert(isTerminalGitHubEntityError('HTTP 410: Gone'), 'deleted issue 410 responses must be terminal');
  assert(!isTerminalGitHubEntityError('HTTP 500: server error'), 'HTTP 500 should stay retryable');
});

await test('Repository 404 fails immediately with repository_unavailable', async () => {
  const runner = createRunner([
    {
      includes: 'repos/acme/widgets',
      code: 1,
      stderr: "GraphQL: Could not resolve to a Repository with the name 'acme/widgets'. (repository)",
    },
  ]);

  const result = await checkGitHubTerminalState({
    owner: 'acme',
    repo: 'widgets',
    issueNumber: 3,
    prNumber: 7,
    commandRunner: runner,
  });

  assert(result.terminal === true, 'repository loss should be terminal');
  assert(result.success === false, 'repository loss is a failure');
  assert(result.reason === 'repository_unavailable', `unexpected reason: ${result.reason}`);
  assert(runner.calls.length === 1, 'should fail before checking PR/issue/branches');
});

await test('Closed issue fails an open PR watch loop', async () => {
  const runner = createRunner([
    { includes: 'repos/acme/widgets --jq', stdout: repoOk },
    { includes: 'repos/acme/widgets/pulls/7', stdout: openPr },
    { includes: 'repos/acme/widgets/branches/issue-7-fix', stdout: { name: 'issue-7-fix' } },
    { includes: 'repos/acme/widgets/branches/main', stdout: { name: 'main' } },
    { includes: 'repos/acme/widgets/issues/3', stdout: { number: 3, state: 'closed' } },
  ]);

  const result = await checkGitHubTerminalState({
    owner: 'acme',
    repo: 'widgets',
    issueNumber: 3,
    prNumber: 7,
    commandRunner: runner,
  });

  assert(result.terminal === true, 'closed linked issue should stop the loop');
  assert(result.reason === 'issue_closed', `unexpected reason: ${result.reason}`);
  assert(result.message.includes('Issue #3'), 'message should identify the issue');
});

await test('Deleted source branch fails immediately', async () => {
  const runner = createRunner([
    { includes: 'repos/acme/widgets --jq', stdout: repoOk },
    { includes: 'repos/acme/widgets/pulls/7', stdout: openPr },
    { includes: 'repos/acme/widgets/branches/issue-7-fix', code: 1, stderr: 'gh: Not Found (HTTP 404)' },
  ]);

  const result = await checkGitHubTerminalState({
    owner: 'acme',
    repo: 'widgets',
    issueNumber: 3,
    prNumber: 7,
    commandRunner: runner,
  });

  assert(result.terminal === true, 'deleted source branch should be terminal');
  assert(result.reason === 'source_branch_unavailable', `unexpected reason: ${result.reason}`);
  assert(result.message.includes('issue-7-fix'), 'message should identify the missing branch');
});

await test('Merged PR is a successful terminal state before issue/branch checks', async () => {
  const runner = createRunner([
    { includes: 'repos/acme/widgets --jq', stdout: repoOk },
    {
      includes: 'repos/acme/widgets/pulls/7',
      stdout: {
        ...openPr,
        state: 'closed',
        merged: true,
      },
    },
  ]);

  const result = await checkGitHubTerminalState({
    owner: 'acme',
    repo: 'widgets',
    issueNumber: 3,
    prNumber: 7,
    commandRunner: runner,
  });

  assert(result.terminal === true, 'merged PR should stop the loop');
  assert(result.success === true, 'merged PR is successful');
  assert(result.reason === 'pull_request_merged', `unexpected reason: ${result.reason}`);
  assert(!runner.calls.some(call => call.includes('/issues/3')), 'merged PR should not be failed because its linked issue closed');
});

await test('Auto-merge and CI polling are wired to the terminal state helper', async () => {
  const root = join(import.meta.dirname, '..');
  const autoMergeSrc = readFileSync(join(root, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
  const watchSrc = readFileSync(join(root, 'src', 'solve.watch.lib.mjs'), 'utf8');
  const githubMergeSrc = readFileSync(join(root, 'src', 'github-merge.lib.mjs'), 'utf8');
  const queueSrc = readFileSync(join(root, 'src', 'telegram-merge-queue.lib.mjs'), 'utf8');

  assert(autoMergeSrc.includes('checkGitHubTerminalState'), 'auto-restart-until-mergeable should check terminal GitHub state');
  assert(watchSrc.includes('checkGitHubTerminalState'), 'watch mode should check terminal GitHub state');
  assert(githubMergeSrc.includes('terminal_github_entity_error'), 'CI polling should expose terminal GitHub entity errors');
  assert(githubMergeSrc.includes('terminal: true'), 'mergeability checks should mark terminal GitHub entity errors');
  assert(queueSrc.includes('mergeableCheck.terminal'), 'merge queue should fail terminal GitHub entity errors instead of skipping them');
});

console.log('\n================================================================================');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
