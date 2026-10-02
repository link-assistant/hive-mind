/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { ISSUE_COMPLETION_GOAL, getIssueCompletionSubPrompt } from '../src/issue-completion.prompts.lib.mjs';
import { buildAutoMergeBlockedComment } from '../src/automation-stop-reporting.lib.mjs';

for (const tool of ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen']) {
  const { buildSystemPrompt, buildUserPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);
  for (const isContinueMode of [false, true]) {
    test(`${tool} ${isContinueMode ? 'continuation' : 'initial'} prompt requires full completion without optional flags`, () => {
      const prompt = buildSystemPrompt({ owner: 'link-assistant', repo: 'agent', issueNumber: 322, prNumber: 326, branchName: 'issue-322-example', tempDir: '/tmp/example', isContinueMode, argv: {} });
      assert.ok(prompt.includes(ISSUE_COMPLETION_GOAL));
      assert.match(prompt, /thread\/goal\/set/);
      assert.match(prompt, /each requirement, including prose requirements and later feedback/);
      assert.match(prompt, /original issue and every required issue/);
      assert.match(prompt, /issue-requirements-snapshot\.mjs.*322 326/);
      assert.match(prompt, /Never fabricate evidence/);
      assert.match(prompt, /blocked.*keep the pull request unmerged/);
      assert.ok(buildUserPrompt({ owner: 'link-assistant', repo: 'agent', issueNumber: 322, prNumber: 326, isContinueMode, argv: {} }).includes(ISSUE_COMPLETION_GOAL));
    });
  }
}

test('Codex enables essential native goals independently of auxiliary calls', async () => {
  const source = await readFile(new URL('../src/codex.lib.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes("shellQuote('features.goals=true')"));
  assert.ok(source.indexOf("shellQuote('features.goals=true')") < source.indexOf('const auxiliaryDisableArgs'));
});

test('completion blockers never tell the user that unfinished work is ready to merge manually', () => {
  for (const reason of ['incomplete_issue_requirements', 'missing_closing_references', 'unverified_issue_links', 'issue_completion_verification_failed']) {
    const comment = buildAutoMergeBlockedComment({ blockers: [{ reason, message: 'Criterion unverified', details: ['Peer install still blocked'] }], issueNumber: 322 });
    assert.match(comment, /issue completion has not been verified/);
    assert.match(comment, /Criterion unverified/);
    assert.doesNotMatch(comment, /All merge requirements are satisfied|merge this pull request manually|Reopen issue/);
  }
});

test('the report command quotes its arguments and keeps placeholders for unknown numbers', () => {
  const known = getIssueCompletionSubPrompt({ owner: "o'wner", repo: 'repo', issueNumber: 322, prNumber: 326 });
  assert.match(known, /'o'\\''wner\/repo' 322 326/);
  const unknown = getIssueCompletionSubPrompt();
  assert.match(unknown, /<issue-number> <pull-request-number>/);
  assert.ok(unknown.includes(ISSUE_COMPLETION_GOAL));
});
