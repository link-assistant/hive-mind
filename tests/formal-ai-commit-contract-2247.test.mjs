#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2247 (H6): the Formal AI prompt must state the
 * commit/push contract.
 *
 * In the Scala reproduction run the model wrote `Main.scala`, answered "Created
 * and verified", and never ran `git commit`. The file stayed untracked, the
 * pull request diff stayed empty, and the run was reported as complete. The
 * prompt it had been given said only "Keep the solution on branch <name>" —
 * a sentence a model can satisfy by writing a file into a checkout of that
 * branch. Nothing in it asked for a commit, and nothing asked for a push.
 *
 * The claude and codex prompts state the contract explicitly; this one is the
 * short repository objective sent to Formal AI, and it is the only prompt the
 * `--model formal-ai` runs receive.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 */

import assert from 'node:assert/strict';

import { buildFormalAiRepositoryPrompt } from '../src/formal-ai-prompt.lib.mjs';

const params = {
  argv: { model: 'formal-ai' },
  issueUrl: 'https://github.com/konard/test-hello-world-scala/issues/1',
  branchName: 'issue-1-abc',
  prUrl: 'https://github.com/konard/test-hello-world-scala/pull/2',
  prNumber: 2,
};

{
  const prompt = buildFormalAiRepositoryPrompt(params);
  assert.ok(prompt.includes('Commit the changes and push them to the branch before reporting completion.'), 'the exact sentence issue #2247 asks for');
  assert.ok(prompt.includes('Implement and verify the solution before reporting completion.'), 'the pre-existing implement/verify line stays');
  assert.ok(prompt.includes(`Keep the solution on branch ${params.branchName}.`), 'the branch line stays too — it is still true, it was just not sufficient');
  assert.ok(prompt.trim().endsWith('Proceed.'), 'the closing instruction stays last');
}

{
  // Continue mode is the auto-restart shape, where the untracked-file failure
  // repeated five times. It needs the contract just as much.
  const prompt = buildFormalAiRepositoryPrompt({ ...params, isContinueMode: true, issueNumber: 1, owner: 'konard', repo: 'test-hello-world-scala' });
  assert.ok(prompt.includes('Commit the changes and push them to the branch before reporting completion.'));
  assert.ok(prompt.trim().endsWith('Continue.'));
}

// Non-Formal-AI models keep their own, much longer prompts untouched.
assert.equal(buildFormalAiRepositoryPrompt({ ...params, argv: { model: 'sonnet' } }), null);

console.log('PASS: issue #2247 (H6) the Formal AI prompt states the commit/push contract');
