#!/usr/bin/env node
/** Issue #2406: every tool is given the same complete-delivery goal, and Codex keeps its native goals. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ISSUE_COMPLETION_GOAL } from '../src/issue-completion.prompts.lib.mjs';
import { buildCodexAuxiliaryDisableConfigArgs, buildCodexEssentialFeatureConfigArgs, describeAuxiliaryModelCallsPolicy } from '../src/auxiliary-model-calls-policy.lib.mjs';
import { buildAgentCommanderToolOptions } from '../src/agent-commander.lib.mjs';
import { readFile } from 'node:fs/promises';

const tools = ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen'];
const params = { issueUrl: 'https://github.com/link-assistant/hive-mind/issues/2406', issueNumber: 2406, prNumber: 2407, prUrl: 'https://github.com/link-assistant/hive-mind/pull/2407', branchName: 'issue-2406', tempDir: '/tmp/work', workspaceTmpDir: '/tmp/work-tmp', owner: 'link-assistant', repo: 'hive-mind', argv: {} };

for (const tool of tools) {
  test(`${tool}: system, initial and continuation prompts carry the complete-delivery goal`, async () => {
    const prompts = await import(`../src/${tool}.prompts.lib.mjs`);
    for (const isContinueMode of [false, true]) {
      const user = prompts.buildUserPrompt({ ...params, isContinueMode });
      assert.ok(user.includes(ISSUE_COMPLETION_GOAL), `${tool} ${isContinueMode ? 'continuation' : 'initial'} prompt`);
      assert.ok(user.endsWith(isContinueMode ? 'Continue.\n' : 'Proceed.\n'));
    }
    const system = prompts.buildSystemPrompt(params);
    assert.ok(system.includes(ISSUE_COMPLETION_GOAL), `${tool} system prompt`);
    assert.match(system, /issue-requirements-snapshot\.mjs' 'link-assistant\/hive-mind' 2406 2407/);
    assert.match(system, /hive-mind:requirements:start/);
    assert.match(system, /"blocked"/);
  });
}

test('claude: the short minimal-context resume prompt still states the goal', async () => {
  const { buildUserPrompt } = await import('../src/claude.prompts.lib.mjs');
  const prompt = buildUserPrompt({ ...params, isContinueMode: true, feedbackLines: ['Minimal auto-restart prompt'], argv: { minimalRestartContext: true, resume: 'session-123' } });
  assert.equal(prompt, `Minimal auto-restart prompt\n${ISSUE_COMPLETION_GOAL}\n`);
});

test('codex: native goals stay enabled whether or not auxiliary calls are disabled', () => {
  assert.deepEqual(buildCodexEssentialFeatureConfigArgs(), ['-c', 'features.goals=true']);
  assert.ok(!buildCodexAuxiliaryDisableConfigArgs(true).includes('features.goals=false'));
  assert.doesNotMatch(describeAuxiliaryModelCallsPolicy('codex'), /goals/);
  for (const auxiliaryModelCallsDisabled of [true, false]) {
    const options = buildAgentCommanderToolOptions({ auxiliaryModelCallsDisabled }, 'codex');
    const args = options.extraArgs;
    const index = args.indexOf('features.goals=true');
    assert.ok(index > 0 && args[index - 1] === '-c', `agent-commander codex, aux disabled=${auxiliaryModelCallsDisabled}`);
    assert.ok(!args.includes('features.goals=false'));
  }
});

test('codex: the direct executor appends the goals flag outside the auxiliary policy', async () => {
  const source = await readFile(new URL('../src/codex.lib.mjs', import.meta.url), 'utf8');
  const goals = source.indexOf('buildCodexEssentialFeatureConfigArgs()');
  assert.ok(goals > 0, 'codex.lib.mjs appends the essential feature flags');
  assert.ok(source.lastIndexOf('if (', goals) < source.lastIndexOf('// Issue #2406', goals), 'the flags are not behind a policy condition');
});
