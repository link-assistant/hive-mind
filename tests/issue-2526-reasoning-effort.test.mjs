/**
 * @hive-mind-test-suite default
 * Regression for https://github.com/link-assistant/hive-mind/issues/2526
 */
import assert from 'node:assert/strict';
import { resolveCodexReasoningEffort } from '../src/codex.options.lib.mjs';
import { REASONING_EFFORT_ORDER, normalizeReasoningCapabilities, selectSupportedReasoningEffort } from '../src/model-reasoning.lib.mjs';
import { buildAgentCommanderToolOptions } from '../src/agent-commander.lib.mjs';
import { buildOrganizationInvocation } from '../src/organize.ai.lib.mjs';

assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol', think: 'off' }).reasoningEffort, 'low', 'GPT-6.1 Sol rejects none; off must use its lowest supported effort');
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol', thinkingBudget: 0 }).reasoningEffort, 'low');
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol', think: 'minimal' }).reasoningEffort, 'low');
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol' }).reasoningEffort, 'low');

for (const model of ['openai/gpt-6.1-sol', 'openai.gpt-6.1-sol', 'gpt-6-astra']) {
  assert.equal(resolveCodexReasoningEffort({ model, think: 'off' }).reasoningEffort, 'low');
}
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6-sol', think: 'off' }).reasoningEffort, 'none', 'preserve disabled reasoning when supported');
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol', thinkingBudget: 1 }).reasoningEffort, 'low');
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol', think: 'high', thinkingBudget: 0 }).reasoningEffort, 'low', 'budget retains precedence');
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol', think: 'high' }).reasoningEffort, 'high');
assert.equal(resolveCodexReasoningEffort({ model: 'gpt-6.1-sol', think: 'ultra' }).rolloutTokenBudget, 500000);
const limited = { supportedReasoningEfforts: ['low', 'medium', 'high'] };
const clamped = resolveCodexReasoningEffort({ model: 'future', think: 'ultra' }, { capabilities: limited });
assert.equal(clamped.reasoningEffort, 'high');
assert.equal(clamped.rolloutTokenBudget, undefined, 'a fallback must not retain a delegation budget');
assert.match(clamped.source, /ultra -> high/);
const planningCapabilities = { supportedReasoningEfforts: ['none', 'ultra'] };
const planningSettings = resolveCodexReasoningEffort({ model: 'future', think: 'xhigh' }, { capabilities: planningCapabilities, maxEffort: 'xhigh' });
assert.equal(planningSettings.reasoningEffort, 'none', 'planning must select within its ceiling even when ultra is closer');
assert.equal(planningSettings.rolloutTokenBudget, undefined);
assert.throws(() => resolveCodexReasoningEffort({ model: 'future', think: 'xhigh' }, { capabilities: { supportedReasoningEfforts: ['ultra'] }, maxEffort: 'xhigh' }), /at or below xhigh/, 'an incompatible model must not enable delegation in planning');
assert.equal(resolveCodexReasoningEffort({ model: 'future' }).reasoningEffort, null, 'unknown capabilities use the model default');
assert.equal(resolveCodexReasoningEffort({ model: 'future', think: 'off' }, { capabilities: { supportedReasoningEfforts: ['auto', 'low'] } }).reasoningEffort, 'auto');
assert.equal(selectSupportedReasoningEffort('medium', { supportedReasoningEfforts: ['high', 'low'] }), 'low', 'ties prefer less expensive effort independently of source ordering');
assert.equal(selectSupportedReasoningEffort('max', { supportedReasoningEfforts: ['high', 'xhigh'] }), 'xhigh');
assert.equal(normalizeReasoningCapabilities({ supported_reasoning_levels: ['invented', null, {}, 'low', { effort: 'low' }] }).supportedReasoningEfforts.join(','), 'low');
assert.equal(normalizeReasoningCapabilities({ supported_reasoning_levels: 'low' }), null);
assert.equal(normalizeReasoningCapabilities(null), null);

// Exhaust all finite subsets to verify selection always returns the nearest supported tier.
for (let mask = 1; mask < 2 ** REASONING_EFFORT_ORDER.length; mask++) {
  const supported = REASONING_EFFORT_ORDER.filter((_, index) => mask & (1 << index));
  for (const requested of REASONING_EFFORT_ORDER) {
    const actual = selectSupportedReasoningEffort(requested, { supportedReasoningEfforts: supported });
    assert.ok(supported.includes(actual));
    const distance = effort => Math.abs(REASONING_EFFORT_ORDER.indexOf(effort) - REASONING_EFFORT_ORDER.indexOf(requested));
    assert.equal(distance(actual), Math.min(...supported.map(distance)));
  }
}

const options = buildAgentCommanderToolOptions({ model: 'gpt-6.1-sol', think: 'off' }, 'codex');
assert.ok(options.extraArgs.includes('model_reasoning_effort=low'));
const unknownOptions = buildAgentCommanderToolOptions({ model: 'future', think: 'off' }, 'codex');
assert.ok(!unknownOptions.extraArgs.some(arg => arg.startsWith('model_reasoning_effort=')));
const invocation = buildOrganizationInvocation({ tool: 'codex', model: 'gpt-6.1-sol', think: 'off', systemPrompt: 'system', userPrompt: 'user', tempDir: '/tmp/organize' });
assert.ok(invocation.args.includes('model_reasoning_effort="low"'));
assert.throws(() => buildOrganizationInvocation({ tool: 'codex', model: 'future', codexReasoningSettings: { reasoningEffort: 'ultra' }, systemPrompt: 'system', userPrompt: 'user', tempDir: '/tmp/organize' }), /planning.*ultra/, 'the command builder must reject an injected delegation setting');
const adaptiveClaude = buildAgentCommanderToolOptions({ model: 'opus', think: 'off', thinkingBudget: 0 }, 'claude');
assert.equal(adaptiveClaude.extraEnv.MAX_THINKING_TOKENS, undefined, 'adaptive-only Claude models must not receive a zero manual thinking budget');
assert.equal(adaptiveClaude.extraEnv.CLAUDE_CODE_EFFORT_LEVEL, 'low');
const claudePlanning = buildOrganizationInvocation({ tool: 'claude', model: 'claude-opus-5', think: 'xhigh', systemPrompt: 'system', userPrompt: 'user', tempDir: '/tmp/organize' });
assert.equal(claudePlanning.args[claudePlanning.args.indexOf('--effort') + 1], 'xhigh', 'organization planning must preserve a supported effort');

console.log('Issue #2526 reasoning effort regression tests passed.');
