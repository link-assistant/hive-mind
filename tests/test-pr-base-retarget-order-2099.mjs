/**
 * Regression test for issue #2099.
 *
 * Retargeting archcore-ai/plugin#26 from main to the unrelated dev branch
 * before pushing the local ancestry merge closed and stranded the PR.
 */

import assert from 'node:assert/strict';

const promptModules = {
  agent: await import('../src/agent.prompts.lib.mjs'),
  claude: await import('../src/claude.prompts.lib.mjs'),
  codex: await import('../src/codex.prompts.lib.mjs'),
  gemini: await import('../src/gemini.prompts.lib.mjs'),
  opencode: await import('../src/opencode.prompts.lib.mjs'),
  qwen: await import('../src/qwen.prompts.lib.mjs'),
};

const params = {
  owner: 'archcore-ai',
  repo: 'plugin',
  issueNumber: 24,
  prNumber: 26,
  branchName: 'issue-24-test',
  argv: {},
  modelSupportsVision: false,
};

for (const [tool, { buildSystemPrompt }] of Object.entries(promptModules)) {
  const prompt = buildSystemPrompt(params);
  assert.match(prompt, /Before changing an existing pull request's base branch/iu, `${tool} must warn about safe PR retarget ordering`);
  assert.match(prompt, /Push that ancestry first/iu, `${tool} must push the new base ancestry before retargeting`);
  assert.match(prompt, /verify it with the remote head SHA/iu, `${tool} must verify the pushed head before retargeting`);
}

console.log('PR base retarget ordering regression tests passed');
