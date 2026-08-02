#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2119: "We should also ensure uniform support
 * for gemini, and qwen for the Formal AI and Hive Mind."
 *
 * The reproduction runs used `--tool agent`, `--tool codex` and `--tool claude`,
 * and the agent run published "Token usage: 0 input, 0 output" for a session
 * that really used 21677 input / 22834 output tokens, because the stream reader
 * split the output on newlines while `formal-ai with <tool> --verbose` emits
 * pretty-printed, multi-line JSON records
 * (docs/case-studies/issue-2119/data/logs/agent-scala-solution-draft.log).
 *
 * Commit 21197003 fixed that for agent, opencode and codex. Gemini and Qwen
 * kept their own line-based parsers, so the very same defect was still present
 * on those two tools - invisible only because nobody had run them yet. This
 * test pins all of it down: the same stream shapes must produce the same token
 * accounting and the same Link.Assistant $0.00 pricing on every tool.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateAgentPricing } from '../src/agent.lib.mjs';
import { buildGeminiPricingInfo, parseGeminiJsonOutput } from '../src/gemini.lib.mjs';
import { buildQwenPricingInfo, parseQwenStreamJsonOutput } from '../src/qwen.lib.mjs';
import { FORMAL_AI_SUPPORTED_TOOLS } from '../src/formal-ai.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The model alias that routes a tool through the local Link.Assistant server. */
const FORMAL_AI_MODEL = 'formal-ai';
const FORMAL_AI_RELEASE_WITH_ISSUE_2119_FIXES = '0.317.0';

// --- gemini ------------------------------------------------------------------

const geminiResult = {
  type: 'result',
  session_id: 'gemini-formal-ai-session',
  response: 'implemented hello world',
  stats: {
    models: {
      [FORMAL_AI_MODEL]: { tokens: { input: 21677, output: 22834, total: 44511, contextLimit: 60000, outputLimit: 8192 } },
    },
  },
};

const assertGeminiUsage = (state, label) => {
  const usage = state.resultModelUsage?.[FORMAL_AI_MODEL];
  assert.ok(usage, `${label}: the result event must be parsed`);
  assert.equal(usage.inputTokens, 21677, `${label}: input tokens must be counted`);
  assert.equal(usage.outputTokens, 22834, `${label}: output tokens must be counted`);
  assert.equal(state.sessionId, 'gemini-formal-ai-session', `${label}: session id must be captured`);
  assert.equal(state.resultSummary, 'implemented hello world', `${label}: result text must be captured`);
};

// The shape `formal-ai with gemini --verbose` emits: indented, multi-line JSON.
assertGeminiUsage(parseGeminiJsonOutput(`${JSON.stringify(geminiResult, null, 2)}\n`, {}, FORMAL_AI_MODEL), 'gemini pretty-printed');

// Strict NDJSON, as gemini-cli emits on its own, must keep working.
assertGeminiUsage(parseGeminiJsonOutput(`${JSON.stringify(geminiResult)}\n`, {}, FORMAL_AI_MODEL), 'gemini ndjson');

// A pretty-printed record split across two process chunks must be assembled.
const geminiSerialized = JSON.stringify(geminiResult, null, 2);
const geminiSplitAt = geminiSerialized.indexOf('"stats"');
let geminiChunked = parseGeminiJsonOutput(geminiSerialized.slice(0, geminiSplitAt), {}, FORMAL_AI_MODEL);
assert.equal(geminiChunked.resultModelUsage, null, 'gemini: an incomplete record must not be applied yet');
geminiChunked = parseGeminiJsonOutput(`${geminiSerialized.slice(geminiSplitAt)}\n`, geminiChunked, FORMAL_AI_MODEL);
assertGeminiUsage(geminiChunked, 'gemini split across chunks');

// Records concatenated without a separator (issue #1250) must both be applied.
const geminiConcatenated = parseGeminiJsonOutput([JSON.stringify({ type: 'message', content: 'working' }), JSON.stringify({ type: 'tool_use', toolCall: { name: 'write_file' } }), JSON.stringify(geminiResult)].join(''), {}, FORMAL_AI_MODEL);
assert.equal(geminiConcatenated.messageCount, 2, 'gemini: concatenated message events must be counted');
assert.equal(geminiConcatenated.toolUseCount, 1, 'gemini: concatenated tool events must be counted');
assertGeminiUsage(geminiConcatenated, 'gemini concatenated');

// Plain, non-JSON tool chatter around the records must not break the framing.
assertGeminiUsage(parseGeminiJsonOutput(`Loaded cached credentials.\n${geminiSerialized}\nDone.\n`, {}, FORMAL_AI_MODEL), 'gemini mixed with plain text');

// The session belongs to Link.Assistant and costs nothing.
const geminiPricing = buildGeminiPricingInfo(FORMAL_AI_MODEL);
assert.equal(geminiPricing.provider, 'Link.Assistant', 'gemini: formal-ai runs are attributed to Link.Assistant');
assert.equal(geminiPricing.totalCostUSD, 0, 'gemini: formal-ai runs are free');

// --- qwen --------------------------------------------------------------------

const qwenResult = {
  type: 'result',
  session_id: 'qwen-formal-ai-session',
  result: 'implemented hello world',
  usage: { model: FORMAL_AI_MODEL, inputTokens: 21677, outputTokens: 22834, contextLimit: 60000, outputLimit: 8192 },
};

const assertQwenUsage = (state, label) => {
  assert.equal(state.tokenUsage.stepCount, 1, `${label}: the result event must be parsed`);
  assert.equal(state.tokenUsage.inputTokens, 21677, `${label}: input tokens must be counted`);
  assert.equal(state.tokenUsage.outputTokens, 22834, `${label}: output tokens must be counted`);
  assert.equal(state.sessionId, 'qwen-formal-ai-session', `${label}: session id must be captured`);
  assert.equal(state.lastTextContent, 'implemented hello world', `${label}: result text must be captured`);
};

assertQwenUsage(parseQwenStreamJsonOutput(`${JSON.stringify(qwenResult, null, 2)}\n`), 'qwen pretty-printed');
assertQwenUsage(parseQwenStreamJsonOutput(`${JSON.stringify(qwenResult)}\n`), 'qwen ndjson');

const qwenSerialized = JSON.stringify(qwenResult, null, 2);
const qwenSplitAt = qwenSerialized.indexOf('"usage"');
let qwenChunked = parseQwenStreamJsonOutput(qwenSerialized.slice(0, qwenSplitAt));
assert.equal(qwenChunked.tokenUsage.stepCount, 0, 'qwen: an incomplete record must not be applied yet');
qwenChunked = parseQwenStreamJsonOutput(`${qwenSerialized.slice(qwenSplitAt)}\n`, qwenChunked);
assertQwenUsage(qwenChunked, 'qwen split across chunks');

const qwenConcatenated = parseQwenStreamJsonOutput([JSON.stringify({ type: 'session.started', session_id: 'ignored' }), JSON.stringify(qwenResult)].join(''));
assert.equal(qwenConcatenated.eventCounts['session.started'], 1, 'qwen: concatenated records must both be applied');
assert.equal(qwenConcatenated.tokenUsage.stepCount, 1, 'qwen: concatenated usage must be counted');

assertQwenUsage(parseQwenStreamJsonOutput(`Loaded cached credentials.\n${qwenSerialized}\nDone.\n`), 'qwen mixed with plain text');

const qwenPricing = buildQwenPricingInfo(parseQwenStreamJsonOutput(`${qwenSerialized}\n`), FORMAL_AI_MODEL);
assert.equal(qwenPricing.pricingInfo.provider, 'Link.Assistant', 'qwen: formal-ai runs are attributed to Link.Assistant');
assert.equal(qwenPricing.pricingInfo.totalCostUSD, 0, 'qwen: formal-ai runs are free');
assert.equal(qwenPricing.publicPricingEstimate, 0, 'qwen: the public estimate for a free model is $0.00, not "unknown"');

// A tool run on its own model keeps its own provider - the fix must not make
// every session look like Link.Assistant.
assert.equal(buildGeminiPricingInfo('gemini-2.5-pro').provider, 'Google');
assert.equal(buildQwenPricingInfo(parseQwenStreamJsonOutput('{"type":"result","result":"ok","usage":{"model":"qwen3-coder-plus","inputTokens":5,"outputTokens":7}}\n'), 'qwen3-coder-plus').pricingInfo.provider, 'Qwen Code');

// --- uniformity across every formal-ai tool ----------------------------------

assert.deepEqual(FORMAL_AI_SUPPORTED_TOOLS, ['claude', 'agent', 'opencode', 'codex', 'qwen', 'gemini'], 'the supported tool list is the contract this test covers');

// Every tool that parses a JSON event stream must share one framing
// implementation, so a fix lands on all of them at once instead of being
// rediscovered per tool - which is exactly how gemini and qwen were missed.
const streamParsingLibs = ['gemini.lib.mjs', 'qwen.lib.mjs', 'agent.lib.mjs', 'opencode.lib.mjs', 'codex.lib.mjs'];
for (const file of streamParsingLibs) {
  const source = await readFile(path.join(repoRoot, 'src', file), 'utf8');
  assert.ok(source.includes("from './json-stream.lib.mjs'"), `${file} frames its stream with the shared scanner`);
}

// Every tool must route `--model formal-ai` through the same dispatcher and
// reach the same pricing helper, so provider and cost are reported identically.
// `opencode` reaches it indirectly: it prices through agent.lib.mjs, which is
// where the formal-ai short-circuit lives for both tools.
const PRICING_ENTRY_POINT_BY_TOOL = {
  claude: 'applyFormalAiPricingOverride',
  agent: 'buildFormalAiPricingInfo',
  opencode: 'calculateAgentPricing',
  codex: 'buildFormalAiPricingInfo',
  qwen: 'buildFormalAiPricingInfo',
  gemini: 'buildFormalAiPricingInfo',
};

for (const tool of FORMAL_AI_SUPPORTED_TOOLS) {
  const source = await readFile(path.join(repoRoot, 'src', `${tool}.lib.mjs`), 'utf8');
  assert.ok(source.includes('resolveFormalAiToolExecution'), `${tool}.lib.mjs dispatches through formal-ai.lib.mjs`);
  assert.ok(source.includes(PRICING_ENTRY_POINT_BY_TOOL[tool]), `${tool}.lib.mjs prices formal-ai sessions through ${PRICING_ENTRY_POINT_BY_TOOL[tool]}`);
}

// The shared entry point opencode relies on must itself be free of the
// OpenCode Zen attribution the issue reported.
const opencodePricing = await calculateAgentPricing(FORMAL_AI_MODEL, { inputTokens: 21677, outputTokens: 22834, stepCount: 1 });
assert.equal(opencodePricing.provider, 'Link.Assistant', 'opencode/agent: formal-ai runs are not attributed to OpenCode Zen');
assert.equal(opencodePricing.totalCostUSD, 0, 'opencode/agent: formal-ai runs are free');

// Formal AI v0.316.1 shipped the upstream half of issue #2119: workspace-effect
// validation and recovery, scratch exclusion, endpoint validation, and strict
// completion telemetry for all six clients. Keep every distributed Hive Mind
// image on the same current release so users actually receive those fixes.
for (const file of ['Dockerfile', 'Dockerfile.dind', 'Dockerfile.formal-ai', 'coolify/Dockerfile']) {
  const source = await readFile(path.join(repoRoot, file), 'utf8');
  assert.match(source, new RegExp(`^ARG FORMAL_AI_VERSION=${FORMAL_AI_RELEASE_WITH_ISSUE_2119_FIXES}$`, 'm'), `${file} installs the Formal AI release containing the upstream issue #2119 fixes`);
}

console.log(`✅ issue #2119: formal-ai stream parsing and pricing are uniform across ${FORMAL_AI_SUPPORTED_TOOLS.length} tools`);
