/**
 * @hive-mind-test-suite default
 * A failed run never marks a placeholder [WIP] pull request ready for review (#3434).
 * The run-end restore of #2312 reads the title and body first; a placeholder (or an
 * unreadable title/body) keeps the pull request a draft.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3434
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensurePullRequestIsDraft, ensurePullRequestStaysDraftAfterFailure, getPullRequestLeftInDraft, getPullRequestPlaceholderState, markPullRequestCreatedByThisRun, resetWorkingSessionDrafts, restoreDeliberateDraftsAtRunEnd } from '../src/pr-draft-state.lib.mjs';
import * as placeholderLib from '../src/pr-placeholder.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

const PLACEHOLDER_BODY = ['## 🤖 AI-Powered Solution Draft', '', 'This pull request is being automatically generated to solve issue #5.', '', '### 🚧 Status', '**Work in Progress** - The AI assistant is currently analyzing and implementing the solution draft.', '', '_Details will be added as the solution draft is developed..._'].join('\n');
const REAL_BODY = '## Summary\nRefactors the design system modules.\n\nFixes #5';
const pr = { owner: 'Godmy', repo: 'stylist-svelte', prNumber: 6 };
const OOM = 'CLAUDE execution failed with Claude command failed with exit code 137';

/** A fake `gh` that keeps a PR's draft flag, title and body and records every command. */
const createFakeGh = ({ isDraft, title, body, failTitleBody = null }) => {
  const state = { isDraft, title, body };
  const commands = [];
  const logs = [];
  const $ = (strings, ...values) => {
    const command = strings.reduce((out, part, index) => out + part + (index < values.length ? String(values[index]) : ''), '');
    commands.push(command);
    if (command.includes('--json isDraft,state')) return Promise.resolve({ code: 0, stdout: JSON.stringify({ isDraft: state.isDraft, state: 'OPEN' }), stderr: '' });
    if (command.includes('--json title,body')) {
      if (failTitleBody === 'throw') return Promise.reject(new Error('network unreachable'));
      if (failTitleBody === 'exit') return Promise.resolve({ code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' });
      if (failTitleBody === 'garbage') return Promise.resolve({ code: 0, stdout: '<html>', stderr: '' });
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ title: state.title, body: state.body }), stderr: '' });
    }
    if (command.startsWith('gh pr ready')) {
      state.isDraft = command.includes('--undo');
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    return Promise.resolve({ code: 1, stdout: '', stderr: `unexpected command: ${command}` });
  };
  const log = async message => logs.push(String(message));
  return { $, state, commands, logs, log };
};

const readyCommands = gh => gh.commands.filter(command => command.startsWith('gh pr ready') && !command.includes('--undo'));

const failRunCreatedByThisRun = async gh => {
  markPullRequestCreatedByThisRun(pr);
  await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: gh.$, log: gh.log, reason: OOM });
};

test.beforeEach(() => resetWorkingSessionDrafts());

test('the placeholder helpers live in a dependency-free module and are re-exported by solve.results', () => {
  const src = readSrc('pr-placeholder.lib.mjs');
  assert.doesNotMatch(src, /^\s*import\b/m, 'pr-placeholder.lib.mjs must not import anything');
  assert.equal(placeholderLib.hasPRTitlePlaceholder('[WIP] Hive Mind refactoring'), true);
  assert.ok(!placeholderLib.hasPRTitlePlaceholder('Hive Mind refactoring'));
  assert.equal(placeholderLib.hasPRBodyPlaceholder(PLACEHOLDER_BODY), true);
  assert.ok(!placeholderLib.hasPRBodyPlaceholder(REAL_BODY));
  const results = readSrc('solve.results.lib.mjs');
  assert.match(results, /export \{ PR_TITLE_PLACEHOLDER_PREFIX, PR_BODY_PLACEHOLDER_PATTERNS, hasPRTitlePlaceholder, hasPRBodyPlaceholder \}/);
  assert.match(results, /from '\.\/pr-placeholder\.lib\.mjs'/);
  assert.doesNotMatch(results, /export const hasPRTitlePlaceholder/, 'one definition only');
  assert.doesNotMatch(readSrc('pr-draft-state.lib.mjs'), /solve\.results\.lib\.mjs'/, 'pr-draft-state must not import solve.results');
});

test('failed session + placeholder title and body -> the PR stays a draft (Godmy/stylist-svelte#6)', async () => {
  const gh = createFakeGh({ isDraft: true, title: '[WIP] Hive Mind refactoring', body: PLACEHOLDER_BODY });
  await failRunCreatedByThisRun(gh);
  const results = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: gh.log, reason: `run end (${OOM})` });
  assert.equal(results.length, 1);
  assert.equal(results[0].reason, 'placeholder_pr');
  assert.deepEqual(results[0].placeholder, { title: true, body: true });
  assert.equal(gh.state.isDraft, true);
  assert.equal(readyCommands(gh).length, 0, 'gh pr ready must not run');
  assert.ok(
    gh.logs.some(line => /PR #6 stays a draft: its title and description still have the placeholder text/.test(line)),
    gh.logs.join('\n')
  );
  assert.ok(getPullRequestLeftInDraft(pr), 'the deliberate draft is still recorded');
});

test('failed session + placeholder title only -> stays a draft', async () => {
  const gh = createFakeGh({ isDraft: true, title: '[WIP] Hive Mind refactoring', body: REAL_BODY });
  await failRunCreatedByThisRun(gh);
  const [result] = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: gh.log });
  assert.equal(result.reason, 'placeholder_pr');
  assert.deepEqual(result.placeholder, { title: true, body: false });
  assert.equal(gh.state.isDraft, true);
  assert.ok(gh.logs.some(line => /its title still has the placeholder text/.test(line)));
});

test('failed session + placeholder body only -> stays a draft', async () => {
  const gh = createFakeGh({ isDraft: true, title: 'Refactor the design system', body: PLACEHOLDER_BODY });
  await failRunCreatedByThisRun(gh);
  const [result] = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: gh.log });
  assert.equal(result.reason, 'placeholder_pr');
  assert.deepEqual(result.placeholder, { title: false, body: true });
  assert.equal(gh.state.isDraft, true);
  assert.ok(gh.logs.some(line => /its description still has the placeholder text/.test(line)));
});

test('failed session + real title on a PR that was ready before the run -> restored to ready (#2312 unchanged)', async () => {
  const gh = createFakeGh({ isDraft: false, title: 'Master plan: phase 2', body: REAL_BODY });
  await ensurePullRequestIsDraft({ ...pr, $: gh.$, log: gh.log });
  await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: gh.$, log: gh.log, reason: 'CODEX execution failed with exit code 137' });
  assert.equal(gh.state.isDraft, true);
  const [result] = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: gh.log });
  assert.equal(result.ok, true);
  assert.notEqual(result.reason, 'placeholder_pr');
  assert.equal(gh.state.isDraft, false);
  assert.equal(readyCommands(gh).length, 1);
  assert.equal(getPullRequestLeftInDraft(pr), null);
});

test('failed session + real title on a PR created by this run -> ready at run end', async () => {
  const gh = createFakeGh({ isDraft: true, title: 'Refactor the design system', body: REAL_BODY });
  await failRunCreatedByThisRun(gh);
  await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: gh.log });
  assert.equal(gh.state.isDraft, false);
});

for (const failTitleBody of ['exit', 'throw', 'garbage']) {
  test(`gh cannot read the title and body (${failTitleBody}) -> no crash, the PR stays a draft and the log says why`, async () => {
    const gh = createFakeGh({ isDraft: true, title: 'Refactor the design system', body: REAL_BODY, failTitleBody });
    await failRunCreatedByThisRun(gh);
    const [result] = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: gh.log });
    assert.equal(result.reason, 'placeholder_check_failed');
    assert.equal(result.skipped, true);
    assert.ok(result.error);
    assert.equal(gh.state.isDraft, true);
    assert.equal(readyCommands(gh).length, 0);
    assert.ok(gh.logs.some(line => /PR #6 stays a draft: could not read its title and description/.test(line)));
  });
}

test('getPullRequestPlaceholderState ignores missing or non-string fields', async () => {
  const $ = () => Promise.resolve({ code: 0, stdout: JSON.stringify({ title: null, body: 42 }), stderr: '' });
  assert.deepEqual(await getPullRequestPlaceholderState({ ...pr, $ }), { ok: true, title: false, body: false, error: null });
});

test('the existing skip reasons still win before the placeholder read', async () => {
  const gh = createFakeGh({ isDraft: true, title: '[WIP] x', body: PLACEHOLDER_BODY });
  await ensurePullRequestIsDraft({ ...pr, $: gh.$, log: gh.log });
  await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: gh.$, log: gh.log, reason: OOM });
  const [result] = await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log: gh.log });
  assert.equal(result.reason, 'human_draft');
  assert.ok(!gh.commands.some(command => command.includes('--json title,body')));
});
