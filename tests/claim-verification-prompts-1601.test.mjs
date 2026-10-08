/**
 * Regression coverage for issue #1601: check claims and try to disprove
 * conclusions before accepting them, regardless of the solver backend.
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

const params = {
  owner: 'owner',
  repo: 'repo',
  issueNumber: 1601,
  prNumber: 2724,
  branchName: 'issue-1601',
};

for (const tool of ['claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini']) {
  const { buildSystemPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);

  for (const argv of [undefined, {}]) {
    test(`${tool} requires claim verification with ${argv ? 'empty' : 'omitted'} options`, () => {
      const prompt = buildSystemPrompt({ ...params, argv });
      assert.match(prompt, /Verify every factual claim/);
      assert.match(prompt, /claims from the user, external sources, other agents, and your own reasoning/);
      assert.match(prompt, /Do not agree with a claim merely because/);
      assert.match(prompt, /Before reaching a conclusion, first try to disprove it/);
      assert.match(prompt, /counterexamples, conflicting evidence, and alternative explanations/);
      assert.match(prompt, /If you disprove a proposed conclusion, reject it and revise your reasoning/);
      assert.match(prompt, /Never present a disproved conclusion as valid/);
      assert.match(prompt, /A failed attempt to disprove a claim does not prove it true/);
      assert.match(prompt, /distinguish facts from assumptions, and document uncertainty/);
    });
  }
}
