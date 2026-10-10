#!/usr/bin/env node

/**
 * Regression test for issue #2313: every restart was byte-identical, so
 * `no_progress_between_sessions` was guaranteed.
 *
 * Kotlin run (2026-09-27, `--tool claude --model formal-ai`): the main session
 * committed `Main.kt` but `kotlinc` left `Main.jar` untracked. Auto-restart 1/5
 * sent Formal AI the private six-line prompt from `formal-ai-prompt.lib.mjs` -
 * the same prompt as the first session, with no word about `Main.jar` - and an
 * empty system prompt. The model re-did the same work, its `git commit` said
 * "nothing added to commit but untracked files present" (exit 1), solve called
 * that `Final tool result failed`, and after restart 2/5 stopped with
 * `no_progress_between_sessions`.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2313
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as agentPrompts from '../src/agent.prompts.lib.mjs';
import * as claudePrompts from '../src/claude.prompts.lib.mjs';
import * as codexPrompts from '../src/codex.prompts.lib.mjs';
import * as geminiPrompts from '../src/gemini.prompts.lib.mjs';
import * as opencodePrompts from '../src/opencode.prompts.lib.mjs';
import * as qwenPrompts from '../src/qwen.prompts.lib.mjs';
import { classifyToolResultError, collectClaudeStreamEventFacts, updateTerminalToolResult } from '../src/claude.stream-events.lib.mjs';
import { buildUncommittedChangesFeedback } from '../src/uncommitted-changes-feedback.lib.mjs';
import { noteSessionInput, recordSessionOutcome, resetSessionProgress, stopWhenSessionRepeated, takeRepeatedSessionFeedback } from '../src/session-progress.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  resetSessionProgress();
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

const promptModules = [
  ['agent', agentPrompts],
  ['claude', claudePrompts],
  ['codex', codexPrompts],
  ['gemini', geminiPrompts],
  ['opencode', opencodePrompts],
  ['qwen', qwenPrompts],
];

const kotlinParams = {
  issueUrl: 'https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/issues/1',
  issueNumber: 1,
  prNumber: 2,
  prUrl: 'https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2',
  branchName: 'issue-1-604f2202fd18',
  tempDir: '/tmp/gh-issue-solver-1790530000000',
  owner: 'konard',
  repo: 'test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a',
};

const porcelain = ['?? Main.jar'];

console.log('Issue #2313: the restart prompt carries the uncommitted files\n');

for (const model of ['formal-ai', 'sonnet']) {
  await test(`--model ${model}: the restart prompt differs from the first prompt and names Main.jar, for every tool`, () => {
    for (const [tool, prompts] of promptModules) {
      const first = prompts.buildUserPrompt({ ...kotlinParams, isContinueMode: false, argv: { model } });
      const restart = prompts.buildUserPrompt({ ...kotlinParams, isContinueMode: true, feedbackLines: buildUncommittedChangesFeedback(porcelain, 1, 5), argv: { model } });
      assert.notEqual(restart, first, `${tool}: a restart after uncommitted files must not repeat the first prompt`);
      assert.ok(restart.includes('\n?? Main.jar\n'), `${tool}: the exact git status --porcelain line`);
      assert.match(restart, /COMMIT it/, tool);
      assert.match(restart, /IGNORE it .*\.gitignore/, tool);
      assert.match(restart, /DELETE it/, tool);
    }
  });
}

await test('Formal AI gets the same system prompt as every other model (no empty system prompt)', () => {
  for (const [tool, prompts] of promptModules) {
    const params = { ...kotlinParams, workspaceTmpDir: null, modelSupportsVision: false, forkedRepo: null };
    const formalAi = prompts.buildSystemPrompt({ ...params, argv: { model: 'formal-ai' } });
    assert.notEqual(formalAi, '', tool);
    assert.equal(formalAi, prompts.buildSystemPrompt({ ...params, argv: { model: 'sonnet' } }), tool);
  }
});

await test('the Formal AI prompt dialect is gone', () => {
  assert.equal(existsSync(join(root, 'src', 'formal-ai-prompt.lib.mjs')), false);
  for (const [tool] of promptModules) {
    const source = readFileSync(join(root, 'src', `${tool}.prompts.lib.mjs`), 'utf8');
    assert.doesNotMatch(source, /isFormalAiModel|buildFormalAiRepositoryPrompt/, `${tool}.prompts.lib.mjs`);
  }
});

await test('all three uncommitted-changes paths build the same feedback', () => {
  for (const file of ['solve.auto-merge.lib.mjs', 'solve.preparation.lib.mjs', 'solve.watch.lib.mjs']) {
    const source = readFileSync(join(root, 'src', file), 'utf8');
    assert.match(source, /buildUncommittedChangesFeedback\(/, file);
    assert.doesNotMatch(source, /REVERTING them if they are not needed/, `${file} must not keep its own wording`);
  }
});

console.log('\nIssue #2313: "nothing to commit" is not a failed session\n');

await test("the Kotlin restart's final `git commit` result is benign", () => {
  const content = 'Exit code 1\nOn branch issue-1-604f2202fd18\nYour branch is up to date with \'origin/issue-1-604f2202fd18\'.\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tMain.jar\n\nnothing added to commit but untracked files present (use "git add" to track)';
  const facts = collectClaudeStreamEventFacts({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content }] } });
  assert.equal(facts.toolResultErrorCategory, 'nothing_to_commit');
  const terminal = updateTerminalToolResult(null, facts);
  assert.equal(terminal.failed && !terminal.benign, false, 'claude.lib.mjs must not report "Final tool result failed"');
  assert.equal(classifyToolResultError('Exit code 1\nOn branch main\nnothing to commit, working tree clean').category, 'nothing_to_commit');
});

await test('a real compiler failure is still a failed final tool result (#2263 unchanged)', () => {
  const classification = classifyToolResultError('Exit code 1\nMain.java:3: error: not a statement\n1 error');
  assert.equal(classification.benign, false);
});

console.log('\nIssue #2313: no_progress_between_sessions requires a changed input\n');

const kotlinOutcome = { finalMessage: 'The command failed: Exit code 1 ... nothing added to commit but untracked files present', gitStatus: '?? Main.jar', head: '4337bf1c' };
const stopParams = { owner: 'konard', repo: 'test', prNumber: null, tempDir: null, branchName: null, $: async () => ({ code: 1, stdout: '', stderr: '' }) };

await test('same input + same outcome -> no stop; the next input names the stall', async () => {
  noteSessionInput(buildUncommittedChangesFeedback(porcelain, 1, 5));
  recordSessionOutcome(kotlinOutcome);
  // Only the restart counter differs: that is not a different input.
  noteSessionInput(buildUncommittedChangesFeedback(porcelain, 2, 5));
  const verdict = recordSessionOutcome(kotlinOutcome);
  assert.equal(verdict.repeated, true);
  assert.equal(verdict.inputChanged, false);
  assert.equal(await stopWhenSessionRepeated(stopParams), null, 'must not conclude "no progress" from an unchanged input');
  const escalation = takeRepeatedSessionFeedback();
  assert.match(escalation.join('\n'), /LAST TWO WORKING SESSIONS ENDED IDENTICALLY/);
  assert.ok(escalation.includes('?? Main.jar'));
  assert.deepEqual(takeRepeatedSessionFeedback(), [], 'the escalation is used once');
});

await test('changed input + same outcome -> the no-progress verdict stands', async () => {
  noteSessionInput(buildUncommittedChangesFeedback(porcelain, 1, 5));
  recordSessionOutcome(kotlinOutcome);
  noteSessionInput([...buildUncommittedChangesFeedback(porcelain, 2, 5), '🔁 THE LAST TWO WORKING SESSIONS ENDED IDENTICALLY:']);
  const verdict = recordSessionOutcome(kotlinOutcome);
  assert.equal(verdict.repeated, true);
  assert.equal(verdict.inputChanged, true);
});

await test('every restart records its input and appends the escalation (executeToolIteration)', () => {
  const source = readFileSync(join(root, 'src', 'solve.restart-shared.lib.mjs'), 'utf8');
  // #2316 appends the repeated-tool-call breaker's reason to the same input, so it counts as a changed input too.
  assert.match(source, /const feedbackLines = \[\.\.\.\(params\.feedbackLines \|\| \[\]\), \.\.\.takeRepeatedSessionFeedback\(\)(, \.\.\.takeRepeatedToolCallFeedback\(\))?\];[^\n]*\n\s+noteSessionInput\(feedbackLines\);/);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
