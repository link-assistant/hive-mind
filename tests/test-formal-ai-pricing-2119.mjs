#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2119 - Formal AI provider and cost identity.
 *
 * `--model formal-ai` routes every request through a local Formal AI model
 * server started by `formal-ai with <tool> ...`. The requests never reach
 * OpenCode Zen, OpenAI, Anthropic, Google or Alibaba, and they are free.
 *
 * The reproduction PRs reported the opposite:
 *   - https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2
 *     "Provider: OpenCode Zen" and "Public pricing estimate: unknown"
 *   - https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2
 *     "Calculated by Anthropic: $0.252315"
 *
 * Every pricing producer must funnel through formal-ai-pricing.lib.mjs so the
 * same Link.Assistant / $0.00 identity appears in logs and GitHub comments.
 */

import assert from 'node:assert';

import { FORMAL_AI_PROVIDER_NAME, applyFormalAiPricingOverride, buildFormalAiPricingInfo, withFormalAiPricing } from '../src/formal-ai-pricing.lib.mjs';
import { FORMAL_AI_MODEL_ALIAS, FORMAL_AI_PROVIDER_MODEL_ID } from '../src/models/index.mjs';
import { calculateAgentPricing } from '../src/agent.lib.mjs';
import { calculateCodexPricing } from '../src/codex.lib.mjs';
import { buildGeminiPricingInfo } from '../src/gemini.lib.mjs';
import { buildQwenPricingInfo } from '../src/qwen.lib.mjs';
import { summarizeAgentCommanderResult } from '../src/agent-commander.lib.mjs';
import { buildCostInfoString } from '../src/github-cost-info.lib.mjs';

const tokenUsage = { inputTokens: 21677, outputTokens: 22834, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, stepCount: 1 };

const assertFormalAi = (pricingInfo, label) => {
  assert.ok(pricingInfo, `${label}: pricing info is present`);
  assert.equal(pricingInfo.provider, FORMAL_AI_PROVIDER_NAME, `${label}: provider is Link.Assistant`);
  assert.equal(pricingInfo.totalCostUSD, 0, `${label}: cost is $0.00`);
  assert.equal(pricingInfo.isFreeModel, true, `${label}: reported as a free model`);
};

// --- the shared record ------------------------------------------------------
assertFormalAi(buildFormalAiPricingInfo(FORMAL_AI_MODEL_ALIAS, tokenUsage), 'buildFormalAiPricingInfo');
assert.equal(buildFormalAiPricingInfo(FORMAL_AI_MODEL_ALIAS, tokenUsage).tokenUsage, tokenUsage, 'token usage stays reportable');
assert.equal(buildFormalAiPricingInfo(FORMAL_AI_MODEL_ALIAS).modelName, FORMAL_AI_MODEL_ALIAS, 'model name is the formal-ai alias');

// --- per-tool pricing calculators ------------------------------------------
assertFormalAi(await calculateAgentPricing(FORMAL_AI_MODEL_ALIAS, tokenUsage), 'agent alias');
assertFormalAi(await calculateAgentPricing(FORMAL_AI_PROVIDER_MODEL_ID, tokenUsage), 'agent provider id');
assertFormalAi(await calculateCodexPricing(FORMAL_AI_MODEL_ALIAS, tokenUsage), 'codex');
assertFormalAi(buildGeminiPricingInfo(FORMAL_AI_MODEL_ALIAS), 'gemini');
assertFormalAi(buildQwenPricingInfo({ tokenUsage }, FORMAL_AI_MODEL_ALIAS).pricingInfo, 'qwen');
assert.equal(buildQwenPricingInfo({ tokenUsage }, FORMAL_AI_MODEL_ALIAS).publicPricingEstimate, 0, 'qwen: public estimate is $0.00');

// A non-formal-ai model must keep its own provider identity.
assert.notEqual(buildGeminiPricingInfo('gemini-2.5-pro').provider, FORMAL_AI_PROVIDER_NAME, 'gemini keeps Google for its own models');

// --- withFormalAiPricing wrapper -------------------------------------------
let delegated = 0;
const wrapped = withFormalAiPricing(async () => {
  delegated += 1;
  return { provider: 'OpenCode Zen', totalCostUSD: 0.252315 };
});
assertFormalAi(await wrapped(FORMAL_AI_MODEL_ALIAS, tokenUsage), 'withFormalAiPricing');
assert.equal(delegated, 0, 'formal-ai short-circuits before the tool calculator runs');
assert.equal((await wrapped('grok-code', tokenUsage)).provider, 'OpenCode Zen', 'other models still reach the tool calculator');
assert.equal(delegated, 1, 'the tool calculator ran exactly once');

// --- result override --------------------------------------------------------
const overridden = applyFormalAiPricingOverride({
  model: FORMAL_AI_MODEL_ALIAS,
  pricingInfo: { provider: 'OpenCode Zen', modelName: 'grok-code', totalCostUSD: 0.5, opencodeCost: 0.5, isOpencodeFreeModel: false, tokenUsage },
  publicPricingEstimate: 0.5,
  anthropicTotalCostUSD: 0.252315,
});
assertFormalAi(overridden.pricingInfo, 'applyFormalAiPricingOverride');
assert.equal(overridden.publicPricingEstimate, 0, 'public estimate is $0.00');
assert.equal(overridden.anthropicTotalCostUSD, null, 'the Anthropic cost false positive is dropped');
assert.equal(overridden.pricingInfo.opencodeCost, undefined, 'the OpenCode Zen cost false positive is dropped');
assert.equal(overridden.pricingInfo.isOpencodeFreeModel, undefined, 'the OpenCode Zen free-model flag is dropped');

const untouched = applyFormalAiPricingOverride({
  model: 'sonnet',
  pricingInfo: { provider: 'Anthropic', totalCostUSD: 0.5 },
  publicPricingEstimate: 0.5,
  anthropicTotalCostUSD: 0.252315,
});
assert.equal(untouched.anthropicTotalCostUSD, 0.252315, 'non-formal-ai models keep their Anthropic cost');
assert.equal(untouched.pricingInfo.provider, 'Anthropic', 'non-formal-ai models keep their provider');

// --- agent-commander summaries ---------------------------------------------
const commanderSummary = summarizeAgentCommanderResult({
  tool: 'claude',
  model: FORMAL_AI_MODEL_ALIAS,
  result: {
    exitCode: 0,
    output: { plain: 'done' },
    usage: { inputTokens: 21677, outputTokens: 22834 },
    metadata: {
      success: true,
      anthropicTotalCostUSD: 0.252315,
      publicPricingEstimate: 0.252315,
      pricingInfo: { provider: 'Anthropic', modelName: 'claude-sonnet-4-5', totalCostUSD: 0.252315 },
      streamTokenUsage: { inputTokens: 21677, outputTokens: 22834 },
    },
  },
});
assertFormalAi(commanderSummary.pricingInfo, 'agent-commander metadata path');
assert.equal(commanderSummary.anthropicTotalCostUSD, null, 'agent-commander drops the Anthropic cost for formal-ai');
assert.equal(commanderSummary.publicPricingEstimate, 0, 'agent-commander reports a $0.00 estimate for formal-ai');

const commanderClaudeSummary = summarizeAgentCommanderResult({
  tool: 'claude',
  model: 'sonnet',
  result: {
    exitCode: 0,
    output: { plain: '', parsed: [{ type: 'result', result: 'done', total_cost_usd: 0.25 }] },
  },
});
assert.equal(commanderClaudeSummary.anthropicTotalCostUSD, 0.25, 'agent-commander keeps the Anthropic cost for a real Anthropic model');

// --- GitHub comment rendering ----------------------------------------------
const rendered = buildCostInfoString(0, null, buildFormalAiPricingInfo(FORMAL_AI_MODEL_ALIAS, tokenUsage));
assert.ok(rendered.includes(`- Provider: ${FORMAL_AI_PROVIDER_NAME}`), 'comment reports the Link.Assistant provider');
assert.ok(rendered.includes('- Public pricing estimate: $0.00 (Free model)'), 'comment reports a $0.00 estimate');
assert.ok(!rendered.includes('Calculated by Anthropic'), 'comment has no Anthropic cost line');
assert.ok(!rendered.includes('Calculated by OpenCode Zen'), 'comment has no OpenCode Zen cost line');
assert.ok(rendered.includes('21,677 input, 22,834 output'), 'comment still reports token usage');

// A free model with no usage-derived estimate must not render "unknown".
const renderedWithoutEstimate = buildCostInfoString(null, null, { modelName: FORMAL_AI_MODEL_ALIAS, provider: FORMAL_AI_PROVIDER_NAME, isFreeModel: true });
assert.ok(renderedWithoutEstimate.includes('- Public pricing estimate: $0.00 (Free model)'), 'a free model never renders "unknown"');

// A paid model with no estimate keeps reporting "unknown".
const renderedPaid = buildCostInfoString(null, null, { modelName: 'grok-code', provider: 'OpenCode Zen' });
assert.ok(renderedPaid.includes('- Public pricing estimate: unknown'), 'a paid model without an estimate still reports "unknown"');

console.log('PASS: issue #2119 formal-ai pricing reports Link.Assistant at $0.00 everywhere');
