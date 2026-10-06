/**
 * Issue #2549: completion must preserve the agent's PR description.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as changes from '../src/pull-request-changes.lib.mjs';
import { ensureIssueLinkInPullRequestBody } from '../src/pr-issue-linking.lib.mjs';
import { repairRequiredIssueLinks } from '../src/pr-issue-link-repair.lib.mjs';
import { createProgressMonitor, normalizeDisplayMode } from '../src/solve.progress-monitoring.lib.mjs';

const read = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const changeBindings = Object.fromEntries(Object.entries(changes).filter(([name]) => name !== 'default'));
const context = { owner: 'o', repo: 'r', issueNumber: 1, prNumber: 2 };
const placeholder = '_Details will be added as the solution draft is developed..._';
const description = 'Implements the fix.\r\n\r\n### Changes\r\n- A hand-written explanation.\r\n\r\nFixes #1\r\n';

function fixture(body) {
  const calls = [];
  const ready = [];
  const $ = (strings, ...values) => {
    if (!Array.isArray(strings)) return $;
    const command = strings.reduce((text, part, i) => text + part + (i < values.length ? String(values[i]) : ''), '');
    calls.push(command);
    if (command.startsWith('gh pr diff')) return Promise.resolve({ code: 0, stdout: 'diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1 +1 @@\n-before\n+after\n' });
    if (command.startsWith('gh pr view')) return Promise.resolve({ code: 0, stdout: JSON.stringify(['OPEN', body]) });
    if (command.startsWith('gh issue view')) return Promise.resolve({ code: 0, stdout: 'Example issue' });
    if (command.startsWith('gh pr edit') && command.includes('--body-file')) body = readFileSync(values.at(-1), 'utf8');
    return Promise.resolve({ code: 0, stdout: '{"id":900}', stderr: '' });
  };
  const repair = async () => {
    const result = ensureIssueLinkInPullRequestBody(body, context);
    body = result.body;
    return result;
  };
  return { $, calls, ready, repair, body: () => body };
}

// Execute the production completion blocks with injected GitHub and readiness
// boundaries, avoiding CLI bootstrap, network access, and process exit handlers.
async function complete(body, restart = false, argv = {}) {
  const f = fixture(body);
  const source = read(restart ? 'solve.restart-shared.lib.mjs' : 'solve.results.lib.mjs');
  const start = source.indexOf(restart ? '      // Repair links even when' : '        let prTitleHasPlaceholder = false;');
  const end = source.indexOf(restart ? '\n    }\n  }\n};' : '        // Upload log file to PR if requested', start);
  assert.ok(start >= 0 && end > start, 'production finalization block is present');
  const block = source.slice(start, end).replace(/await import\('\.\/[^']+'\)/g, 'deps');
  const deps = {
    ...changeBindings,
    repairRequiredIssueLinks: f.repair,
    ensurePullRequestIsReady: async options => f.ready.push(options),
    ensurePullRequestStaysDraftAfterFailure: async () => {},
  };
  const bindings = {
    ...context,
    ensurePullRequestIsReady: deps.ensurePullRequestIsReady,
    ensurePullRequestStaysDraftAfterFailure: deps.ensurePullRequestStaysDraftAfterFailure,
    $: f.$,
    log: async () => {},
    formatAligned: (...parts) => parts.join(' '),
    reportError: error => {
      throw error;
    },
    argv,
    pr: { number: 2, title: 'Example' },
    isPrMerged: false,
    toolResult: { success: true },
    ensurePullRequestIssueLink: f.repair,
    hasPRTitlePlaceholder: title => title.startsWith('[WIP]'),
    hasPRBodyPlaceholder: text => text.includes(placeholder),
    postNoChangesProducedComment: async () => {},
    sanitizeForPublication: async text => text,
    writeSanitizedPublicationFile: async (file, text) => (await import('node:fs/promises')).writeFile(file, text),
    buildIssueReference: () => '#1',
    use: async name => import(`node:${name}`),
    deps,
    ...changeBindings,
  };
  const run = new AsyncFunction(...Object.keys(bindings), `${block}\n${restart ? '' : 'return { prBodyHasPlaceholder };'}`);
  const result = await run(...Object.values(bindings));
  return { ...f, result };
}

for (const restart of [false, true]) {
  test(`${restart ? 'restart' : 'normal'} completion preserves an already linked description byte for byte`, { timeout: 5000 }, async () => {
    const f = await complete(description, restart);
    assert.equal(f.body(), description);
    assert.equal(f.calls.filter(call => call.includes('--body-file')).length, 0);
    assert.equal(f.ready.length, 1);
    assert.equal(f.ready[0].requireChanges, true, 'empty-diff readiness gate remains');
  });
}

test('an untouched placeholder is still replaced by the generated description (issue #1162)', { timeout: 5000 }, async () => {
  const f = await complete(`${placeholder}\n\nFixes #1`, false, { autoRestartOnNonUpdatedPullRequestDescription: false });
  assert.equal(f.result.prBodyHasPlaceholder, true);
  assert.equal(f.calls.filter(call => call.includes('--body-file')).length, 1);
  assert.ok(!f.body().includes(placeholder), 'the placeholder is gone');
  assert.match(f.body(), /^## Summary\n\nThis pull request implements a solution for #1: Example issue\n/);
  assert.match(f.body(), /### Changes\n- 1 file\(s\) modified/);
  assert.match(f.body(), /### Issue Reference\nFixes #1/);
});

test('with auto-restart on a non-updated description, the placeholder is left for the agent', { timeout: 5000 }, async () => {
  const f = await complete(`${placeholder}\n\nFixes #1`, false, { autoRestartOnNonUpdatedPullRequestDescription: true });
  assert.equal(f.body(), `${placeholder}\n\nFixes #1`);
  assert.equal(f.result.prBodyHasPlaceholder, true);
  assert.equal(f.calls.filter(call => call.includes('--body-file')).length, 0);
});

test('completion has no post-agent Changes regeneration left', () => {
  for (const file of ['solve.results.lib.mjs', 'solve.restart-shared.lib.mjs', 'pull-request-changes.lib.mjs']) {
    assert.doesNotMatch(read(file), /refreshPullRequestChangesSection|replaceChangesSection/, file);
  }
});

test('single-issue repair appends only the missing link after a separator', () => {
  const body = 'Agent text.\r\n  ';
  const next = ensureIssueLinkInPullRequestBody(body, context);
  assert.equal(next.body, `${body}\n\n---\n\nFixes #1`);
  assert.equal(ensureIssueLinkInPullRequestBody(next.body, context).updated, false);
});

test('multi-issue repair preserves every byte and appends only missing links once', { timeout: 30000 }, async () => {
  let body = 'Agent text.\r\n\r\nFixes #1\r\n  ';
  const original = body;
  let edits = 0;
  const run = async args => {
    let data;
    if (args[0] === 'pr') {
      body = readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
      edits++;
      data = {};
    } else if (args[1].endsWith('/pulls/2')) data = { body };
    else if (args[1].endsWith('/issues/1')) data = { number: 1, body: '', title: 'Primary' };
    else if (args[1].endsWith('/issues/1/sub_issues')) data = [[{ number: 3, body: '', title: 'Child', repository_url: 'https://api.github.com/repos/o/r' }]];
    else if (args[1].endsWith('/issues/3')) data = { number: 3, body: '', title: 'Child' };
    else if (args[1].endsWith('/issues/3/sub_issues')) data = [[]];
    else throw new Error(`unexpected: ${args.join(' ')}`);
    return { code: 0, stdout: JSON.stringify(data) };
  };
  const result = await repairRequiredIssueLinks({ ...context, run });
  assert.equal(result.checked, true, result.error);
  assert.equal(body, `${original}\n\n---\n\nFixes #3`);
  assert.equal((await repairRequiredIssueLinks({ ...context, run })).updated, false);
  assert.equal(edits, 1);
});

test('default live progress posts a comment without editing the description', { timeout: 5000 }, async () => {
  const f = fixture(description);
  const monitor = createProgressMonitor({ ...context, $: f.$, log: async () => {} });
  assert.equal(await monitor.updateProgress([{ content: 'Implement fix', status: 'completed' }], true), true);
  assert.ok(f.calls.some(call => call.includes('/issues/2/comments')));
  assert.ok(f.calls.every(call => !call.startsWith('gh pr edit') && !call.startsWith('gh pr view')));
  assert.equal(f.body(), description);
});

test('the opt-in pr live progress mode is kept', () => {
  assert.equal(normalizeDisplayMode('pr'), 'pr');
  assert.equal(createProgressMonitor({ ...context, $: async () => ({}), log: async () => {}, displayMode: 'pr' }).displayMode, 'pr');
});
