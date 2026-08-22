#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

const { parseArguments } = await import('../src/solve.config.lib.mjs');
const { resolveThinkingSettings, setClaudeVersion } = await import('../src/claude.lib.mjs');
const { getClaudeEnv } = await import('../src/config.lib.mjs');
const { resolveCodexReasoningEffort } = await import('../src/codex.options.lib.mjs');

const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/2032';

const parse = async args => {
  const originalArgv = process.argv;
  process.argv = ['node', 'solve.mjs', issueUrl, ...args];
  try {
    return await parseArguments();
  } finally {
    process.argv = originalArgv;
  }
};

const omitted = await parse(['--tool', 'agent', '--model', 'nemotron-3-super-free']);
assert.equal(omitted.think, 'off', 'omitting --think must normalize to the same internal value as --think off');

const explicit = await parse(['--tool', 'agent', '--model', 'nemotron-3-super-free', '--think', 'medium']);
assert.equal(explicit.think, 'medium', 'an explicit thinking level must override the off default');

const explicitBudget = await parse(['--tool', 'codex', '--model', 'gpt-5.5', '--thinking-budget', '16000']);
assert.equal(explicitBudget.think, undefined, 'an explicit thinking budget must not be overridden by the implicit off default');
assert.equal(resolveCodexReasoningEffort(explicitBudget).reasoningEffort, 'medium');

assert.deepEqual(resolveCodexReasoningEffort(omitted), {
  reasoningEffort: 'none',
  source: '--think off',
});

setClaudeVersion('2.1.12');
const resolvedClaude = await resolveThinkingSettings(omitted, async () => {});
assert.equal(resolvedClaude.thinkLevel, 'off');
assert.equal(resolvedClaude.thinkingBudget, 0);

const legacyClaudeEnv = getClaudeEnv({ model: 'haiku', thinkLevel: omitted.think, thinkingBudget: resolvedClaude.thinkingBudget });
assert.equal(legacyClaudeEnv.MAX_THINKING_TOKENS, '0');

const adaptiveClaudeEnv = getClaudeEnv({ model: 'sonnet', thinkLevel: omitted.think, thinkingBudget: resolvedClaude.thinkingBudget });
assert.equal(adaptiveClaudeEnv.CLAUDE_CODE_EFFORT_LEVEL, 'low', 'adaptive-only Claude models must use their lowest supported effort when thinking cannot be disabled');
assert.equal(adaptiveClaudeEnv.MAX_THINKING_TOKENS, undefined);

console.log('Issue #2032 default thinking-off regression tests passed.');
