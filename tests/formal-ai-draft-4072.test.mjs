/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DRAFT_STEP, evaluateDraftHealth, findRepeatedFailure, isExecutedAttempt } from '../scripts/formal-ai-draft-health.lib.mjs';
import { DRAFT_DECISION_CODES, createdDraftPullRequestNumber, isAttemptPullRequest } from '../scripts/formal-ai-draft.lib.mjs';
import { parseDraftOutcome } from '../scripts/formal-ai-draft-outcome.lib.mjs';

const script = fileURLToPath(new URL('../scripts/formal-ai-draft.mjs', import.meta.url));
const repository = 'link-assistant/hive-mind';
const pullRequest = (number, headRefName = 'issue-4072-example', fields = {}) => ({ number, headRefName, isDraft: false, state: 'OPEN', ...fields });

function runDraft({ before = [], after = [], files = [], baseAfterFiles, created, status = 0, censusError = false, flags = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'formal-ai-draft-4072-'));
  try {
    const bin = join(root, 'bin');
    const event = join(root, 'event.json');
    const output = join(root, 'outputs');
    const config = join(root, 'config.json');
    const calls = join(root, 'calls.jsonl');
    mkdirSync(bin);
    writeFileSync(output, '');
    writeFileSync(calls, '');
    writeFileSync(event, JSON.stringify({ action: 'opened', issue: { number: 4072, html_url: `https://github.com/${repository}/issues/4072`, user: { type: 'User', login: 'test' } } }));
    writeFileSync(config, JSON.stringify({ before, after, files, baseAfterFiles, created, status, censusError, calls, repository }));
    const mock = String.raw`#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const { basename } = require('node:path');
const { before, after, files, baseAfterFiles, created, status, censusError, calls, repository } = JSON.parse(readFileSync(process.env.DRAFT_TEST_CONFIG));
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(calls, JSON.stringify([tool, ...args]) + '\n');
if (tool === 'docker' && args[0] === 'run') {
  if (created) {
    console.log('✅ PR created:               #' + created);
    console.log('📍 PR URL:                   https://github.com/' + repository + '/pull/' + created);
  }
  process.exitCode = status;
} else if (tool === 'gh' && args[0] === 'api') {
  if (censusError) { console.error('census unavailable'); process.exitCode = 1; }
  else if (args[1].includes('/files?')) files.forEach(file => console.log(JSON.stringify(file)));
  else console.log(JSON.stringify([before.map(pr => ({ number: pr.number, head: { ref: pr.headRefName } }))]));
} else if (tool === 'gh' && args[0] === 'pr' && args[1] === 'view') {
  const pr = after.find(pr => pr.number === Number(args[2]));
  if (pr && baseAfterFiles && readFileSync(calls, 'utf8').includes('/files?')) pr.baseRefOid = baseAfterFiles;
  console.log(JSON.stringify(pr && { createdAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), ...pr }));
} else if (tool === 'gh' && args[0] === 'pr' && args[1] === 'list') {
  console.log(JSON.stringify([...before, ...after]));
}
`;
    for (const tool of ['docker', 'gh']) writeFileSync(join(bin, tool), mock, { mode: 0o755 });
    const result = spawnSync(process.execPath, [script, ...flags], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        GITHUB_EVENT_NAME: 'issues',
        GITHUB_EVENT_PATH: event,
        GITHUB_REPOSITORY: repository,
        GITHUB_OUTPUT: output,
        FORMAL_AI_DRAFT_IMAGE: 'konard/hive-mind:test',
        FORMAL_AI_DRAFT_LOG_DIR: join(root, 'logs'),
        DRAFT_TEST_CONFIG: config,
      },
    });
    return { ...result, output: readFileSync(output, 'utf8'), calls: readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('an issue with an open PR at the end of the image pull skips Docker and GitHub mutations', { timeout: 30_000 }, () => {
  const result = runDraft({ before: [pullRequest(80)] });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(
    result.calls.map(call => call.slice(0, 2)),
    [
      ['docker', 'pull'],
      ['gh', 'api'],
    ]
  );
  assert.ok(result.calls[1].includes('--paginate'));
  assert.match(result.output, /^should_run=false$/m);
  assert.match(result.output, /^decision_code=issue-has-open-pull-request$/m);
  assert.match(result.stdout, /::notice title=Formal AI draft decision::issue-has-open-pull-request/u);
  assert.doesNotMatch(result.output, /head_branch|pull_request_number/);
});

test('a concurrent PR that the failed attempt did not create gets no finalization or outputs', { timeout: 30_000 }, () => {
  const result = runDraft({ after: [pullRequest(81)], status: 5 });
  assert.equal(result.status, 5, result.stdout + result.stderr);
  assert.deepEqual(
    result.calls.map(call => call.slice(0, 2)),
    [
      ['docker', 'pull'],
      ['gh', 'api'],
      ['docker', 'run'],
    ]
  );
  assert.doesNotMatch(result.output, /head_branch|pull_request_number/);
});

test('only the PR created by solve is drafted and labelled, even on failure with another new PR', { timeout: 30_000 }, () => {
  const result = runDraft({
    before: [pullRequest(80, 'issue-40720-other')],
    after: [pullRequest(81, 'issue-4072-draft'), pullRequest(82)],
    created: 81,
    status: 5,
  });
  assert.equal(result.status, 5, result.stdout + result.stderr);
  assert.deepEqual(
    result.calls.slice(0, 3).map(call => call.slice(0, 2)),
    [
      ['docker', 'pull'],
      ['gh', 'api'],
      ['docker', 'run'],
    ]
  );
  assert.ok(result.calls[2].includes('--no-auto-continue'));
  assert.deepEqual(
    result.calls.slice(3).map(call => call.slice(0, 4)),
    [
      ['gh', 'pr', 'view', '81'],
      ['gh', 'pr', 'ready', '81'],
      ['gh', 'pr', 'edit', '81'],
    ]
  );
  assert.ok(result.calls[4].includes('--undo'));
  assert.ok(result.calls[5].includes('formal-ai-draft'));
  assert.match(result.output, /^head_branch=issue-4072-draft\npull_request_number=81$/m);
});

test('a successful process with a diagnostics-only PR receives no implementation credit', { timeout: 30_000 }, () => {
  const files = ['.gitkeep', 'dev/log/solve.log', '.formal-ai/general-change-plan.lino', 'session-metadata.json'];
  const pr = pullRequest(81, 'issue-4072-draft', { baseRefOid: 'b'.repeat(40), headRefOid: 'a'.repeat(40), changedFiles: files.length });
  const result = runDraft({ after: [pr], files, created: 81 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const outcome = parseDraftOutcome(/^draft_outcome=(.*)$/m.exec(result.output)?.[1]);
  assert.equal(outcome.task.change, 'diagnostics_only');
  assert.equal(outcome.task.usefulChange, false);
  assert.equal(outcome.primary.code, 'no_requested_implementation');
  assert.match(result.stdout, /::warning title=Formal AI draft failed::No requested implementation was produced/u);
});

test('a draft diff on a moving base remains unverified', { timeout: 30_000 }, () => {
  const pr = pullRequest(81, 'issue-4072-draft', { baseRefOid: 'b'.repeat(40), headRefOid: 'a'.repeat(40), changedFiles: 1 });
  const result = runDraft({ after: [pr], files: ['src/fix.mjs'], baseAfterFiles: 'c'.repeat(40), created: 81 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const outcome = parseDraftOutcome(/^draft_outcome=(.*)$/m.exec(result.output)?.[1]);
  assert.equal(outcome.primary.code, 'unverified_effect');
  assert.equal(outcome.task.usefulChange, false);
});

test('a PR reported by solve that predates the attempt is left alone', { timeout: 30_000 }, () => {
  const result = runDraft({ after: [pullRequest(81, undefined, { createdAt: '2026-01-01T00:00:00Z' })], created: 81 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.calls.at(-1).slice(0, 4), ['gh', 'pr', 'view', '81']);
  assert.doesNotMatch(result.output, /head_branch|pull_request_number/);
});

test('the attempt fails closed when the open-PR census is unavailable', { timeout: 30_000 }, () => {
  const result = runDraft({ censusError: true });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(
    result.calls.map(call => call.slice(0, 2)),
    [
      ['docker', 'pull'],
      ['gh', 'api'],
    ]
  );
  assert.match(result.stdout, /Could not list open pull requests/);
});

test('the creation report must name a new open PR on the issue branch in the current repository', () => {
  const url = `https://github.com/${repository}/pull/81`;
  const summary = `[2026-11-22T12:30:00.000Z] ✅ PR created:   #81\n[2026-11-22T12:30:00.001Z] 📍 PR URL:   ${url}\n`;
  assert.equal(createdDraftPullRequestNumber(summary, repository), 81);
  assert.equal(createdDraftPullRequestNumber(`📍 PR URL: ${url}\n`, repository), null);
  assert.equal(createdDraftPullRequestNumber(summary, 'another/repo'), null);
  assert.equal(createdDraftPullRequestNumber(summary.replace('#81', '#82'), repository), null);

  const startedAt = Date.parse('2026-11-22T12:30:00.750Z');
  const options = { number: 81, issueNumber: 4072, startedAt, previousNumbers: new Set() };
  const row = pullRequest(81, 'issue-4072-draft', { createdAt: '2026-11-22T12:30:00Z' });
  assert.equal(isAttemptPullRequest(row, options), true, 'GitHub reports whole seconds');
  assert.equal(isAttemptPullRequest(row, { ...options, previousNumbers: new Set([81]) }), false);
  for (const fields of [{ state: 'CLOSED' }, { createdAt: null }, { headRefName: 'issue-40720-draft' }, { number: 82 }]) {
    assert.equal(isAttemptPullRequest({ ...row, ...fields }, options), false);
  }
});

test('the health check treats occupancy as a policy skip and counts only launched attempts', () => {
  const occupied = { event: 'issues', status: 'completed', conclusion: 'success', decisionCode: DRAFT_DECISION_CODES.occupied };
  const jobs = [{ steps: [{ name: DRAFT_STEP, started_at: '2026-11-22T12:30:00Z', conclusion: 'success' }] }];
  assert.equal(isExecutedAttempt(occupied, jobs, occupied.decisionCode), false);
  assert.equal(findRepeatedFailure([occupied], { threshold: 1 }), null);
  assert.equal(evaluateDraftHealth({ eligible: 1, attempts: 0, occupied: 1 }).healthy, true);
  assert.equal(evaluateDraftHealth({ eligible: 2, attempts: 0, occupied: 1 }).healthy, false);
});

test('the event decision and dry run do not check live occupancy', { timeout: 30_000 }, () => {
  for (const flag of ['--decide', '--dry-run']) {
    const result = runDraft({ flags: [flag], censusError: true });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.calls, []);
    assert.match(result.output, /^should_run=true$/m);
  }
});
