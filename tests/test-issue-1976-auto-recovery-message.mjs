#!/usr/bin/env node

import assert from 'node:assert/strict';
import { buildPrePullRequestFailureActionSection, notifyIssueAboutPrePullRequestFailure } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { buildForkReplacementBlockedReason } from '../src/solve.repository-recovery-message.lib.mjs';
import { resetTrackedToolCommentIds } from '../src/tool-comments.lib.mjs';

async function test(name, fn) {
  try {
    resetTrackedToolCommentIds();
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

const incidentReason = buildForkReplacementBlockedReason({
  existingRepository: 'konard/olproff-fastsbc_acli',
  expectedUpstream: 'olproff/fastsbc_acli',
  relationshipDescription: 'konard/olproff-fastsbc_acli is not a GitHub fork of olproff/fastsbc_acli.',
  safetyCheckDescription: 'GitHub compare returned 404 Not Found, so Hive Mind could not prove the repository has no unique commits.',
});

await test('issue #1976 reason explains the blocked fork replacement instead of using the old terse title', () => {
  assert.match(incidentReason, /^Repository setup halted - existing fork replacement could lose commits\./);
  assert.match(incidentReason, /Expected fork or replacement repository: konard\/olproff-fastsbc_acli/);
  assert.match(incidentReason, /Expected upstream: olproff\/fastsbc_acli/);
  assert.match(incidentReason, /not a GitHub fork/);
  assert.match(incidentReason, /GitHub compare returned 404 Not Found/);
  assert.match(incidentReason, /did not delete konard\/olproff-fastsbc_acli/);
  assert.match(incidentReason, /delete, rename, archive, or repair/);
  assert.match(incidentReason, /--allow-force-non-fork-repository-deletion/);
  assert.doesNotMatch(incidentReason, /^Auto-recovery skipped - repository may contain commits that would be lost$/);
});

await test('issue #1976 action section keeps the exact repository and user options visible', () => {
  const section = buildPrePullRequestFailureActionSection(incidentReason);

  assert.match(section, /konard\/olproff-fastsbc_acli/);
  assert.match(section, /olproff\/fastsbc_acli/);
  assert.match(section, /could not prove whether the existing repository has unique commits/);
  assert.match(section, /delete, rename, archive, or repair/);
  assert.match(section, /--allow-force-non-fork-repository-deletion/);
  assert.doesNotMatch(section, /gh auth refresh/);
});

await test('issue #1976 log-upload failure comments receive the expanded reason and specific action section', async () => {
  const globalState = { owner: 'olproff', repo: 'fastsbc_acli', issueNumber: 4 };
  const calls = [];

  const result = await notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason: incidentReason,
    argv: { tool: 'claude', model: 'opus' },
    globalState,
    shouldAttachLogs: true,
    getLogFile: () => '/tmp/solve.log',
    sanitizeLogContent: async value => value,
    log: async () => {},
    attachLogToGitHub: async options => {
      calls.push(options);
      return true;
    },
    postComment: async () => {
      throw new Error('fallback comment should not be posted after successful log upload');
    },
  });

  assert.deepEqual(result, { notified: true, method: 'log-upload' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].errorMessage, /existing fork replacement could lose commits/);
  assert.match(calls[0].errorMessage, /konard\/olproff-fastsbc_acli/);
  assert.match(calls[0].errorMessage, /GitHub compare returned 404 Not Found/);
  assert.match(calls[0].failureActionSection, /could not prove whether the existing repository has unique commits/);
  assert.match(calls[0].failureActionSection, /--allow-force-non-fork-repository-deletion/);
});
