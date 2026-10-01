#!/usr/bin/env node

/**
 * Regression test for issue #2395: konard/p-vs-np#623 was auto-merged
 * "unattached to issue".
 *
 * The description had "Fixes #567" until 20:08:28; at 20:10:37 it was rewritten
 * with only "Refs #567 and #568." and `--auto-merge` merged at 20:11:31 without
 * looking at the link again, leaving issue #567 open. The fixture is the exact
 * description the pull request was merged with.
 *
 * Required now: both auto-merge paths ensure the "Fixes #N" link right before
 * merging, restore it when it is missing, and hold the merge back when it
 * cannot be ensured.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2395
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureIssueLinkBeforeMerge, ISSUE_LINK_UNVERIFIED_REASON } from '../src/pr-issue-link-merge-gate.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ensurePullRequestIssueLink } = await import('../src/solve.results.lib.mjs');
const { buildAutoMergeBlockedComment } = await import('../src/automation-stop-reporting.lib.mjs');
const { attachLogAfterAutoMergeBlocked } = await import('../src/attach-logs-guarantee.lib.mjs');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

const bodyAtMerge = await readFile(join(repoRoot, 'tests', 'fixtures', 'issue-2395-p-vs-np-pr623-body-at-merge.md'), 'utf8');
const target = { owner: 'konard', repo: 'p-vs-np', issueNumber: 567, prNumber: 623, argv: {} };

/** A fake `gh` behind `$`: serves the PR body and records `gh pr edit` bodies. */
const fakeGh = ({ body, viewCode = 0, editCode = 0 }) => {
  const calls = [];
  const command = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? values[i] : ''), '');
    calls.push(text);
    if (text.startsWith('gh pr view')) return { code: viewCode, stdout: viewCode === 0 ? body : '', stderr: viewCode === 0 ? '' : 'HTTP 502: Bad Gateway' };
    if (text.startsWith('gh pr edit')) {
      const bodyFile = text.split('--body-file ')[1].trim();
      calls.push({ editedBody: await readFile(bodyFile, 'utf8').catch(() => '') });
      return { code: editCode, stdout: '', stderr: editCode === 0 ? '' : 'GraphQL: Resource not accessible by integration' };
    }
    return { code: 1, stdout: '', stderr: `unexpected command: ${text}` };
  };
  const ensureLink = params => ensurePullRequestIssueLink({ ...params, command, logger: async () => {} });
  return { calls, ensureLink };
};

console.log('Issue #2395: never auto-merge a pull request without its issue link\n');

await test('the fixture is the p-vs-np#623 description at merge time: it references #567 but does not close it', async () => {
  assert.match(bodyAtMerge, /Refs #567 and #568\./);
  assert.doesNotMatch(bodyAtMerge, /\b(fix(es|ed)?|close[sd]?|resolve[sd]?)\s+#567\b/i);
});

await test('the merge gate restores "Fixes #567" before merging and does not block', async () => {
  const gh = fakeGh({ body: bodyAtMerge });
  const blocker = await ensureIssueLinkBeforeMerge({ ...target, ensureLink: gh.ensureLink });
  assert.equal(blocker, null);
  const edit = gh.calls.find(call => call.editedBody !== undefined);
  assert.ok(edit, 'gh pr edit was called');
  assert.match(edit.editedBody, /Fixes #567/);
  assert.match(edit.editedBody, /Refs #567 and #568\./, 'the rest of the description is kept');
});

await test('an already linked pull request is left alone', async () => {
  const gh = fakeGh({ body: `${bodyAtMerge}\nFixes #567\n` });
  assert.equal(await ensureIssueLinkBeforeMerge({ ...target, ensureLink: gh.ensureLink }), null);
  assert.equal(gh.calls.filter(call => typeof call === 'string' && call.startsWith('gh pr edit')).length, 0);
});

await test('the merge is held back when the description cannot be read', async () => {
  const gh = fakeGh({ body: bodyAtMerge, viewCode: 1 });
  const blocker = await ensureIssueLinkBeforeMerge({ ...target, ensureLink: gh.ensureLink });
  assert.equal(blocker?.reason, ISSUE_LINK_UNVERIFIED_REASON);
  assert.match(blocker.details.join('\n'), /HTTP 502/);
});

await test('the merge is held back when the link cannot be written', async () => {
  const gh = fakeGh({ body: bodyAtMerge, editCode: 1 });
  const blocker = await ensureIssueLinkBeforeMerge({ ...target, ensureLink: gh.ensureLink });
  assert.equal(blocker?.reason, ISSUE_LINK_UNVERIFIED_REASON);
  assert.match(blocker.resolution, /Fixes #567/);
});

await test('the merge is held back when ensuring the link throws', async () => {
  const blocker = await ensureIssueLinkBeforeMerge({
    ...target,
    ensureLink: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(blocker?.reason, ISSUE_LINK_UNVERIFIED_REASON);
});

await test('without an issue there is nothing to link', async () => {
  assert.equal(await ensureIssueLinkBeforeMerge({ ...target, issueNumber: null, ensureLink: () => assert.fail('not called') }), null);
});

await test('the "held back" comment tells the user to fix the description, not to reopen the issue', async () => {
  const body = buildAutoMergeBlockedComment({ blockers: [{ reason: ISSUE_LINK_UNVERIFIED_REASON, message: 'm', details: [], resolution: 'Add "Fixes #567"' }], issueNumber: 567 });
  assert.doesNotMatch(body, /Reopen issue #567/);
  assert.match(body, /pull request description/);
});

await test('both auto-merge paths run the gate right before merging', async () => {
  for (const file of ['solve.auto-merge.lib.mjs', 'solve.auto-merge-attempt.lib.mjs']) {
    const source = await readFile(join(repoRoot, 'src', file), 'utf8');
    const gate = source.indexOf('await ensureIssueLinkBeforeMerge({ owner, repo, issueNumber, prNumber, argv, log })');
    const merge = source.indexOf('mergePullRequest(owner, repo, prNumber', gate);
    assert.ok(gate > 0, `${file} calls the gate`);
    assert.ok(merge > gate, `${file} merges after the gate`);
    assert.match(source.slice(gate, merge), /reportAutoMergeBlockedByIssue\(/, `${file} reports the blocker instead of merging`);
  }
});

/** Parameters for `attachLogAfterAutoMergeBlocked` that record every upload. */
const logUploadParams = (overrides = {}) => {
  const uploads = [];
  const messages = [];
  return {
    uploads,
    messages,
    params: {
      shouldAttachLogs: true,
      prNumber: 623,
      owner: 'konard',
      repo: 'p-vs-np',
      $: null,
      log: async message => messages.push(message),
      sanitizeLogContent: text => text,
      getLogFile: () => '/home/box/solve-2026-09-29T19-22-49-422Z.log',
      attachLogToGitHub: async options => uploads.push(options) > 0,
      argv: { tool: 'codex', model: 'gpt-6-sol' },
      ...overrides,
    },
  };
};
const heldBack = { success: false, reason: ISSUE_LINK_UNVERIFIED_REASON, mergeBlockers: [{ reason: ISSUE_LINK_UNVERIFIED_REASON }] };

await test('the full log is attached again when the auto-merge is held back', async () => {
  const { uploads, messages, params } = logUploadParams();
  assert.equal(await attachLogAfterAutoMergeBlocked({ ...params, autoMergeResult: heldBack }), true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].targetNumber, 623);
  assert.equal(uploads[0].logFile, '/home/box/solve-2026-09-29T19-22-49-422Z.log');
  assert.match(messages.join('\n'), /held back \(issue_link_unverified\)/);
});

await test('no extra log when the pull request was merged, nothing was blocked, or logs are off', async () => {
  for (const [autoMergeResult, overrides] of [
    [{ success: true }, {}],
    [{ success: false, reason: 'tool_failure' }, {}],
    [null, {}],
    [heldBack, { shouldAttachLogs: false }],
    [heldBack, { prNumber: null }],
  ]) {
    const { uploads, params } = logUploadParams(overrides);
    assert.equal(await attachLogAfterAutoMergeBlocked({ ...params, autoMergeResult }), false);
    assert.equal(uploads.length, 0);
  }
});

await test('an upload error never escapes', async () => {
  const { params } = logUploadParams({
    attachLogToGitHub: async () => {
      throw new Error('gist quota');
    },
  });
  assert.equal(await attachLogAfterAutoMergeBlocked({ ...params, autoMergeResult: heldBack }), false);
});

await test('solve.mjs attaches the log after a held-back auto-merge', async () => {
  const source = await readFile(join(repoRoot, 'src', 'solve.mjs'), 'utf8');
  const loop = source.indexOf('await startAutoRestartUntilMergeable(');
  const reattach = source.indexOf('await attachLogAfterAutoMergeBlocked({ autoMergeResult,', loop);
  assert.ok(loop > 0 && reattach > loop);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
