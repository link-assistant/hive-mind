#!/usr/bin/env node
/**
 * Issue #4149: CI/CD false positives on main.
 *
 * F1 - report-checks of Formal AI Draft (runs 45629684702, 45618594320) failed
 *      on one `gh: unexpected end of JSON input`: GitHub answered an HTTP error
 *      whose body was empty or cut off, gh could not parse it and hid the
 *      status code. The retry loops did not know the message, and one failed
 *      poll ended the whole job. A truncated reply is now retried for
 *      read-only commands only (a blind write retry duplicates comments,
 *      issue #2571), and the poll loop tolerates a few failed polls.
 * F2 - the draft job (run 45618587462) failed with "Dispatched release.yml,
 *      but no run appeared" although run 45622194807 was created 3 s after the
 *      dispatch: the filtered `gh run list` stayed empty for 2 minutes. The
 *      dispatch now asks GitHub for the created run (`return_run_details`).
 */
// The gh command lines below are classifier fixtures and are never run against GitHub.
/* eslint-disable gh-paginate/require-gh-paginate */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyGitHubCommand, ghApiMethod, retryGitHubOperation } from '../src/github-operation-retry.lib.mjs';
import { execGhWithRetry, ghWithRateLimitRetry, isReadOnlyGhCommand, wrapDollarWithGhRetry } from '../src/github-rate-limit.lib.mjs';
import { describeTransientError, isTransientNetworkError, isTruncatedGitHubReply } from '../src/transient-errors.lib.mjs';
import { MAX_CONSECUTIVE_POLL_FAILURES, recordPollFailure } from '../scripts/formal-ai-draft-checks.lib.mjs';
import { ALLOWED_CHECK_WORKFLOWS, dispatchRequestBody, dispatchedRunUrl, findDispatchedRun, missingRunWarning } from '../scripts/dispatch-checks.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(repoRoot, path), 'utf8');
const noSleep = async () => {};
const quiet = () => {};
// The exact stderr of the failed report-checks step (run 45629684702).
const TRUNCATED = 'unexpected end of JSON input';
const failed = stderr => ({ code: 1, stdout: '', stderr });
const fast = { transientDelay: 0, log: quiet };

test('F1: a truncated reply is recognised but is not a general transient error', () => {
  assert.equal(isTruncatedGitHubReply(new Error(TRUNCATED)), true);
  assert.equal(isTruncatedGitHubReply({ stderr: `gh: ${TRUNCATED}` }), true);
  assert.equal(isTransientNetworkError(new Error(TRUNCATED)), false, 'writes must not retry it (issue #2571)');
  assert.equal(describeTransientError(new Error(TRUNCATED)).transient, false);
  assert.equal(describeTransientError(new Error(TRUNCATED), { truncatedReplyIsTransient: true }).transient, true);
  assert.equal(describeTransientError(new Error(TRUNCATED), { truncatedReplyIsTransient: true })?.category, 'github-truncated-reply');
});

test('F1: ghApiMethod follows gh api: explicit method, else POST with fields, else GET', () => {
  assert.equal(ghApiMethod(['repos/o/r/actions/runs']), 'GET');
  assert.equal(ghApiMethod(['repos/o/r/issues/1/comments', '-f', 'body=x']), 'POST');
  assert.equal(ghApiMethod(['repos/o/r/issues', '-fbody=x']), 'POST');
  assert.equal(ghApiMethod(['repos/o/r/statuses/abc', '--input', 'file.json']), 'POST');
  assert.equal(ghApiMethod(['search/issues', '-X', 'GET', '-f', 'q=x']), 'GET');
  assert.equal(ghApiMethod(['repos/o/r', '--method', 'PATCH']), 'PATCH');
  assert.equal(ghApiMethod(['repos/o/r', '--method=DELETE']), 'DELETE');
  assert.equal(ghApiMethod(['repos/o/r', '-XPUT']), 'PUT');
});

test('F1: classifyGitHubCommand marks reads read-only and writes not', () => {
  const readOnly = ['gh api repos/o/r/actions/runs?head_sha=abc', 'gh pr view 1 --json state', 'gh run list --limit 5', 'gh pr checks 1', 'gh pr diff 1', 'gh search issues x', "gh api graphql -f query='query { viewer { login } }'", 'gh api search/issues -X GET -f q=x'];
  const writes = ['gh api repos/o/r/issues/1/comments -f body=x', 'gh api repos/o/r/statuses/abc --method POST --input f.json', 'gh pr comment 1 --body x', 'gh pr merge 1', 'gh workflow run release.yml', "gh api graphql -f query='mutation { x }'", 'gh api repos/o/r/releases/1 -X PATCH --input -', 'gh api graphql -F query=@q.graphql'];
  for (const command of readOnly) assert.equal(classifyGitHubCommand(command)?.readOnly, true, command);
  for (const command of writes) assert.equal(classifyGitHubCommand(command)?.readOnly, false, command);
  assert.equal(classifyGitHubCommand('gh', ['api', 'repos/o/r/actions/runs', '--method', 'GET'])?.readOnly, true);
  assert.equal(isReadOnlyGhCommand('gh pr view 1'), true);
  assert.equal(isReadOnlyGhCommand('gh pr edit 1 --body x'), false);
});

test('F1: retryGitHubOperation retries a truncated reply only when asked to', async () => {
  let calls = 0;
  const flaky = async () => (++calls < 3 ? failed(TRUNCATED) : { code: 0, stdout: 'ok', stderr: '' });
  const result = await retryGitHubOperation(flaky, { sleep: noSleep, log: quiet, retryTruncatedReply: true });
  assert.equal(result.stdout, 'ok');
  assert.equal(calls, 3);

  calls = 0;
  const once = await retryGitHubOperation(flaky, { sleep: noSleep, log: quiet });
  assert.equal(calls, 1, 'a write is never replayed on a truncated reply');
  assert.equal(once.code, 1);
});

test('F1: ghWithRateLimitRetry forwards retryTruncatedReply', async () => {
  let calls = 0;
  const flaky = async () => {
    if (++calls < 2) throw Object.assign(new Error('Command failed: gh api repos/o/r/actions/runs'), { stderr: TRUNCATED });
    return { stdout: '{}' };
  };
  assert.deepEqual(await ghWithRateLimitRetry(flaky, { ...fast, retryTruncatedReply: true }), { stdout: '{}' });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(ghWithRateLimitRetry(flaky, fast), /Command failed/);
  assert.equal(calls, 1);
});

test('F1: wrapDollarWithGhRetry retries a truncated read but not a truncated write', async () => {
  const calls = [];
  const stub = (strings, ...values) => {
    const command = strings.reduce((text, part, index) => text + part + (index < values.length ? values[index] : ''), '');
    calls.push(command);
    return Promise.resolve(calls.filter(c => c === command).length < 2 ? failed(TRUNCATED) : { code: 0, stdout: 'ok', stderr: '' });
  };
  const $ = wrapDollarWithGhRetry(stub, fast);
  assert.equal((await $`gh api repos/o/r/actions/runs`).stdout, 'ok');
  assert.equal(calls.length, 2);
  calls.length = 0;
  assert.equal((await $`gh pr comment 1 --body ${'hi'}`).code, 1);
  assert.equal(calls.length, 1);
});

test('F1: execGhWithRetry decides from the command it runs', async () => {
  // A fake `gh` on PATH that always fails with the truncated reply and counts its calls.
  const directory = mkdtempSync(join(tmpdir(), 'gh-4149-'));
  const counter = join(directory, 'calls');
  writeFileSync(join(directory, 'gh'), `#!/bin/sh\nprintf x >> "${counter}"\necho '${TRUNCATED}' >&2\nexit 1\n`);
  chmodSync(join(directory, 'gh'), 0o755);
  const execOptions = { env: { ...process.env, PATH: `${directory}:${process.env.PATH}` } };
  const attempts = async command => {
    rmSync(counter, { force: true });
    await assert.rejects(execGhWithRetry(command, { ...fast, transientMaxAttempts: 3, execOptions }));
    return readFileSync(counter, 'utf8').length;
  };
  try {
    assert.equal(await attempts('gh pr view 1 --json state'), 3);
    assert.equal(await attempts('gh pr comment 1 --body x'), 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('F1: every gh wrapper and script helper forwards the read-only flag', () => {
  for (const path of ['scripts/github-actions.lib.mjs', 'scripts/github-retry.mjs', 'scripts/repair-release-notes.mjs', 'src/github-rate-limit.lib.mjs', 'src/github-operation-retry.lib.mjs']) {
    assert.match(read(path), /retryTruncatedReply/, `${path} decides whether a truncated reply is retried`);
  }
});

test('F1: report-checks tolerates a few failed polls and then gives up', () => {
  const error = new Error(TRUNCATED);
  let failures = 0;
  for (let poll = 1; poll < MAX_CONSECUTIVE_POLL_FAILURES; poll++) failures = recordPollFailure(failures, error);
  assert.equal(failures, MAX_CONSECUTIVE_POLL_FAILURES - 1);
  assert.throws(() => recordPollFailure(failures, error), error);
  const script = read('scripts/formal-ai-draft-checks.mjs');
  assert.match(script, /recordPollFailure\(failedPolls, error\)/);
  assert.match(script, /failedPolls = 0;/, 'a successful poll resets the count');
});

const run = (overrides = {}) => ({ id: 45622194807, head_sha: 'abc', event: 'workflow_dispatch', path: '.github/workflows/release.yml', created_at: '2026-11-24T10:00:03Z', html_url: 'https://github.com/o/r/actions/runs/45622194807', ...overrides });
const started = Date.parse('2026-11-24T10:00:00Z');

test('F2: the dispatch asks GitHub for the created run', () => {
  assert.deepEqual(dispatchRequestBody('feature'), { ref: 'feature', inputs: { mode: 'checks' }, return_run_details: true });
  assert.equal(dispatchedRunUrl({ workflow_run_id: 1, html_url: 'https://github.com/o/r/actions/runs/1' }), 'https://github.com/o/r/actions/runs/1');
  assert.equal(dispatchedRunUrl(null), '', 'HTTP 204 (no details) falls back to the lookup');
  assert.ok(ALLOWED_CHECK_WORKFLOWS.includes('release.yml'));
});

test('F2: the fallback lookup matches the workflow, commit, event and time', () => {
  const options = { workflow: 'release.yml', sha: 'abc', started };
  assert.equal(findDispatchedRun([run()], options)?.id, 45622194807);
  assert.equal(findDispatchedRun([run({ path: '.github/workflows/release.yml@refs/heads/feature' })], options)?.id, 45622194807);
  assert.equal(findDispatchedRun([run({ path: '.github/workflows/security.yml' })], options), null);
  assert.equal(findDispatchedRun([run({ head_sha: 'def' })], options), null);
  assert.equal(findDispatchedRun([run({ event: 'push' })], options), null);
  assert.equal(findDispatchedRun([run({ created_at: '2026-11-24T09:59:00Z' })], options), null, 'an earlier dispatch is not this one');
  assert.equal(findDispatchedRun(undefined, options), null);
});

test('F2: a run that is not listed yet is a warning, not a failed job', () => {
  assert.match(missingRunWarning('release.yml', 'abc'), /^::warning /);
  const script = read('scripts/dispatch-checks.mjs');
  assert.doesNotMatch(script, /throw new Error\(`Dispatched/, 'the old false positive');
  assert.doesNotMatch(script, /'run', 'list'/, 'the lagging filtered listing is not used');
  assert.match(script, /actions\/workflows\/\$\{workflow\}\/dispatches`, \{ method: 'POST'/);
});

test('CI/CD best practices state both rules in every language (principle 17)', () => {
  for (const suffix of ['', '.ru', '.zh', '.hi']) {
    const doc = read(`docs/CI-CD-BEST-PRACTICES${suffix}.md`);
    const principle = doc.slice(doc.indexOf('### 17.'), doc.indexOf('\n## ', doc.indexOf('### 17.')));
    assert.match(principle, /`unexpected end of JSON input`[^\n]*issue #2571[^\n]*issue #4149/, `${suffix || 'en'}: truncated reply rule`);
    assert.match(principle, /`return_run_details: true`[^\n]*issue #4149/, `${suffix || 'en'}: dispatch rule`);
  }
});
