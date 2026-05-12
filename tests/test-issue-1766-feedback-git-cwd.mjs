#!/usr/bin/env node

/**
 * Regression test for issue #1766.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { detectAndCountFeedback } from '../src/solve.feedback.lib.mjs';

function commandFromTemplate(strings, values) {
  return strings.reduce((command, part, index) => `${command}${part}${index < values.length ? String(values[index]) : ''}`, '');
}

function result(stdout = '', code = 0, stderr = '') {
  return {
    code,
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
  };
}

function createMockDollar({ repositoryPath, branchName }) {
  const calls = [];

  const run = (options, strings, values) => {
    const command = commandFromTemplate(strings, values);
    const cwd = options?.cwd || null;
    calls.push({ command, cwd });

    if (command === 'gh api user --jq .login') {
      return result('konard\n');
    }

    if (command === `git log -1 --format="%aI" origin/${branchName}` || command === `git log -1 --format="%aI" ${branchName}`) {
      if (cwd === repositoryPath) {
        return result('2026-05-08T18:11:57+00:00\n');
      }
      return result('', 128, 'fatal: not a git repository (or any of the parent directories): .git\n');
    }

    if (command.includes('/pulls/4/commits')) {
      return result('2026-05-08T18:11:57Z\n');
    }

    if (command.includes('/pulls/4/comments') || command.includes('/issues/4/comments') || command.includes('/issues/3/comments')) {
      return result('[]\n');
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  function $(first, ...rest) {
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw')) {
      return run(null, first, rest);
    }

    return (strings, ...values) => run(first, strings, values);
  }

  $.calls = calls;

  return $;
}

const branchName = 'issue-3-178d07ed7937';
const repositoryPath = '/tmp/gh-issue-solver-1778263915988';
const $ = createMockDollar({ repositoryPath, branchName });
const logs = [];

const feedback = await detectAndCountFeedback({
  prNumber: 4,
  branchName,
  owner: 'PONYAWKA',
  repo: 'diagnostic-and-monitoring-tests',
  issueNumber: 3,
  isContinueMode: false,
  argv: { verbose: true },
  mergeStateStatus: null,
  prState: null,
  workStartTime: null,
  log: async message => {
    logs.push(String(message));
  },
  formatAligned: (_icon, label, value) => `${label} ${value}`,
  cleanErrorMessage: error => error.message,
  $,
  repositoryPath,
});

const gitCalls = $.calls.filter(call => call.command.startsWith('git log '));
const fallbackCommitApiCalls = $.calls.filter(call => call.command.includes('/pulls/4/commits'));

assert.equal(gitCalls.length, 1, 'remote branch git log should succeed without the local-branch fallback');
assert.equal(gitCalls[0].cwd, repositoryPath, 'git log must run inside the cloned repository');
assert.equal(fallbackCommitApiCalls.length, 0, 'GitHub commit timestamp fallback should not run when local git succeeds');
assert.equal(feedback.feedbackLines.length, 0, 'empty comments should produce no feedback lines');
assert.ok(
  logs.some(line => line.includes('Repository path: /tmp/gh-issue-solver-1778263915988')),
  'verbose logs should show the repository path used for git'
);
assert.ok(
  logs.some(line => line.includes('Last commit time: 2026-05-08T18:11:57.000Z')),
  'last commit time should come from local git'
);

console.log('Issue #1766 feedback git cwd regression passed');
