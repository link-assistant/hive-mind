#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Formal AI parity across /claude, /codex and /agent (issue #3279).
 *
 * One matrix: tool x {Anthropic, OpenAI, Formal AI}. A Formal AI session must
 * be attributed (the four #2229 trailers plus the evidence bundle in the same
 * commit), priced at $0.00 by Link.Assistant, named `formal-ai`, and rendered
 * in the attached-log comment the same way whichever client drove it. A vendor
 * session must stay unattributed and keep its vendor cost.
 *
 * The attribution half is behavioural: each client's real command wrapper runs
 * against a real git repository, with a stubbed CLI that commits mid-stream
 * exactly as the model would, and the commit is read back with `git show`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3279
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_RETRY_BACKOFF_MULTIPLIER = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';
process.env.HIVE_MIND_MODELS_HOT_LOAD = '0';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-formal-ai-parity-3279-'));
process.env.HIVE_MIND_STATE_DIR = path.join(workspace, 'state');
after(() => fs.rmSync(workspace, { recursive: true, force: true }));

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { executeCodexCommand, calculateCodexPricing } = await import('../src/codex.lib.mjs');
const { executeAgentCommand, calculateAgentPricing } = await import('../src/agent.lib.mjs');
const { ATTRIBUTION_CLIENTS, FORMAL_AI_TRAILER_KEYS, extractAttributionSessionId, parseCommitTrailers, resolveAttributionMode, resolveFormalAiAttributionSession } = await import('../src/formal-ai-attribution.lib.mjs');
const { applyServedModelPricing, servedModelPricingInfo, FORMAL_AI_PROVIDER_NAME } = await import('../src/formal-ai-pricing.lib.mjs');
const { buildCostInfoString } = await import('../src/github-cost-info.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../src/anthropic-cost-accumulator.lib.mjs');

const VERSION = '0.354.0';
const ISSUE = 3279;
const PR_NUMBER = 3390;
const PR_URL = `https://github.com/link-assistant/hive-mind/pull/${PR_NUMBER}`;
const EVIDENCE = `dev/log/self-authored/issue-${ISSUE}/evidence`;
// A model id that is neither Formal AI's alias nor a hosted model: with
// `--attribution formal-ai` it exercises the attribution path without
// starting a local Formal AI server.
const LOCAL_MODEL = 'local-coder';

const git = (cwd, args, env = {}) => {
  try {
    return { code: 0, output: String(execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })) };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

const makeRepo = name => {
  const repo = path.join(workspace, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '--quiet', '--initial-branch', 'main']);
  git(repo, ['config', 'user.email', 'parity@example.com']);
  git(repo, ['config', 'user.name', 'Parity Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# repo\n');
  git(repo, ['add', 'README.md']);
  git(repo, ['commit', '--quiet', '-m', 'chore: initial']);
  return repo;
};

const trailersOf = (repo, ref = 'HEAD') => {
  const parsed = parseCommitTrailers(git(repo, ['show', '-s', '--format=%B', ref]).output);
  return Object.fromEntries(Object.values(FORMAL_AI_TRAILER_KEYS).map(key => [key, (parsed[key.toLowerCase()] || [])[0] ?? null]));
};

const hermeticAttribution = params => resolveFormalAiAttributionSession({ ...params, readVersion: async () => VERSION, sanitize: async text => text, flushRecordThreshold: 1 });

/** What the model does when it finishes a change, using the environment the client process was given. */
const commitAsTheModel = (repo, env) => {
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'work\n');
  git(repo, ['add', 'feature.txt'], env);
  return git(repo, ['commit', '--quiet', '-m', 'feat: the change'], env).code;
};

const common = repo => ({
  tempDir: repo,
  branchName: 'main',
  prompt: 'Solve the issue.',
  systemPrompt: '',
  log: async (...args) => (process.env.DEBUG_3279 ? console.error(...args) : undefined),
  formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
  getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
  forkedRepo: null,
  feedbackLines: [],
  issueNumber: ISSUE,
  prNumber: PR_NUMBER,
  prUrl: PR_URL,
  createAttributionSession: hermeticAttribution,
});

const runClaude = async ({ repo, argv, commit = true }) => {
  resetCumulativeAnthropicCost();
  const sessionId = '7d1c3e52-3279-4a0b-9c11-0c1a2b3c4d5e';
  let logFile = path.join(repo, '..', `${path.basename(repo)}.log`);
  fs.writeFileSync(logFile, '');
  const state = { env: null, commitCode: null };
  const $ = options => () => {
    state.env = options?.env || null;
    return {
      result: { code: 0 },
      kill() {},
      async *stream() {
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId, model: 'formal-ai' })}\n`) };
        if (commit) state.commitCode = commitAsTheModel(repo, state.env);
        const assistant = { type: 'assistant', session_id: sessionId, message: { id: 'msg_1', role: 'assistant', model: 'formal-ai', content: [{ type: 'text', text: 'Done.' }] } };
        const result = { type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: 'Done.', num_turns: 1, total_cost_usd: 0.252315, modelUsage: { 'formal-ai': { inputTokens: 10, outputTokens: 5, costUSD: 0.252315 } } };
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify(assistant)}\n${JSON.stringify(result)}\n`) };
      },
    };
  };
  const result = await executeClaudeCommand({
    ...common(repo),
    argv: { tool: 'claude', url: `https://github.com/link-assistant/hive-mind/issues/${ISSUE}`, verbose: false, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false, ...argv },
    getLogFile: () => logFile,
    setLogFile: value => {
      logFile = value;
    },
    claudePath: 'claude',
    $,
  });
  return { result, ...state };
};

const runCodex = async ({ repo, argv, commit = true }) => {
  const state = { env: null, commitCode: null };
  const $ = options => () => {
    state.env = options?.env || null;
    return {
      async *stream() {
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify({ type: 'thread.started', thread_id: '019a2b3c-3279-7e00-8f00-112233445566' })}\n${JSON.stringify({ type: 'turn.started' })}\n`) };
        if (commit) state.commitCode = commitAsTheModel(repo, state.env);
        const events = [
          { type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'Done.' } },
          { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } },
        ];
        yield { type: 'stdout', data: Buffer.from(events.map(event => JSON.stringify(event)).join('\n')) };
        yield { type: 'exit', code: 0 };
      },
    };
  };
  const result = await executeCodexCommand({ ...common(repo), argv: { tool: 'codex', resume: null, think: 'off', verbose: false, baseBranch: '', ...argv }, codexPath: 'codex', $, calculatePricing: async () => null });
  return { result, ...state };
};

const runAgent = async ({ repo, argv, commit = true }) => {
  const state = { env: null, commitCode: null };
  const $ = options => {
    state.env = options?.env || null;
    return () => ({
      stream: async function* stream() {
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify({ type: 'session.started', sessionID: 'ses_agent3279' })}\n`) };
        if (commit) state.commitCode = commitAsTheModel(repo, state.env);
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify({ type: 'session.idle' })}\n`) };
        yield { type: 'exit', code: 0 };
      },
    });
  };
  const result = await executeAgentCommand({ ...common(repo), argv: { tool: 'agent', verbose: false, ...argv }, agentPath: 'agent', $, calculatePricing: async () => ({ totalCostUSD: 0 }) });
  return { result, ...state };
};

const CLIENTS = {
  claude: { run: runClaude, session: '7d1c3e52-3279-4a0b-9c11-0c1a2b3c4d5e' },
  codex: { run: runCodex, session: '019a2b3c-3279-7e00-8f00-112233445566' },
  agent: { run: runAgent, session: 'ses_agent3279' },
};

describe('issue #3279: Formal AI commit attribution through every client', () => {
  for (const [tool, client] of Object.entries(CLIENTS)) {
    test(`--tool ${tool}: the commit carries the four trailers and its own evidence bundle`, async () => {
      const repo = makeRepo(`attributed-${tool}`);
      const run = await client.run({ repo, argv: { model: LOCAL_MODEL, attribution: 'formal-ai' } });
      assert.equal(run.commitCode, 0, 'the model can commit');
      assert.deepEqual(trailersOf(repo), {
        [FORMAL_AI_TRAILER_KEYS.session]: client.session,
        [FORMAL_AI_TRAILER_KEYS.model]: `formal-ai/${VERSION}`,
        [FORMAL_AI_TRAILER_KEYS.evidence]: EVIDENCE,
        [FORMAL_AI_TRAILER_KEYS.pullRequest]: PR_URL,
      });
      const streamFile = ATTRIBUTION_CLIENTS[tool].streamFilename;
      assert.equal(streamFile, `${tool}-stream.jsonl`);
      assert.match(git(repo, ['show', `HEAD:${EVIDENCE}/session-id.txt`]).output, new RegExp(`formal-ai session ${client.session}`));
      assert.equal(git(repo, ['show', `HEAD:${EVIDENCE}/${streamFile}`]).code, 0, `the ${tool} stream is committed alongside the session id`);
      assert.equal(git(repo, ['status', '--porcelain']).output.trim(), '', 'and the working tree is left clean');
    });

    test(`--tool ${tool}: a vendor run is not attributed and is given no hooks`, async () => {
      const repo = makeRepo(`plain-${tool}`);
      const run = await client.run({ repo, argv: { model: LOCAL_MODEL, attribution: 'none' } });
      assert.equal(run.commitCode, 0);
      assert.equal(Object.values(run.env || {}).includes('core.hooksPath'), false, 'no core.hooksPath override reaches the client');
      assert.deepEqual(Object.values(trailersOf(repo)), [null, null, null, null]);
    });
  }

  test('a hosted model answering a Claude Code generation is never published as Formal AI work', async () => {
    const repo = makeRepo('claude-hosted-fallback');
    const sessionId = '5e4d3c2b-3279-4a0b-9c11-aabbccddeeff';
    let logFile = path.join(workspace, 'claude-hosted.log');
    fs.writeFileSync(logFile, '');
    let commitCode = null;
    const $ = options => () => ({
      result: { code: 0 },
      kill() {},
      async *stream() {
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId })}\n${JSON.stringify({ type: 'assistant', session_id: sessionId, message: { id: 'msg_h', role: 'assistant', model: 'claude-sonnet-4-5', content: [] } })}\n`) };
        commitCode = commitAsTheModel(repo, options.env);
        yield { type: 'stdout', data: Buffer.from(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: 'Done.', num_turns: 1 })}\n`) };
      },
    });
    resetCumulativeAnthropicCost();
    await executeClaudeCommand({ ...common(repo), argv: { tool: 'claude', model: LOCAL_MODEL, attribution: 'formal-ai', verbose: false, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false }, getLogFile: () => logFile, setLogFile: value => (logFile = value), claudePath: 'claude', $ });
    assert.equal(commitCode, 0, 'the commit still lands');
    assert.equal(trailersOf(repo)[FORMAL_AI_TRAILER_KEYS.session], null, 'but carries no Formal AI trailers');
  });

  test('each client stream reports its session id in its own field', () => {
    assert.equal(extractAttributionSessionId('claude', { type: 'system', session_id: 's1' }), 's1');
    assert.equal(extractAttributionSessionId('codex', { type: 'thread.started', thread_id: 't1' }), 't1');
    assert.equal(extractAttributionSessionId('codex', { type: 'turn.started', thread_id: 't1' }), null);
    assert.equal(extractAttributionSessionId('agent', { type: 'session.started', sessionID: 'a1' }), 'a1');
  });
});

// tool x provider: the model each client is asked for, and what it would report on its own.
const PROVIDERS = {
  Anthropic: { claude: 'opus', codex: null, agent: null },
  OpenAI: { claude: null, codex: 'gpt-5', agent: null },
  'Formal AI': { claude: 'formal-ai', codex: 'formal-ai', agent: 'formal-ai' },
};
const TOOL_REPORTS = {
  // Claude Code prices every model at Anthropic list prices.
  claude: { pricingInfo: null, publicPricingEstimate: 0.252315, anthropicTotalCostUSD: 0.252315 },
  codex: { pricingInfo: { modelName: 'GPT-5', provider: 'OpenAI', totalCostUSD: 0.12 }, publicPricingEstimate: 0.12, anthropicTotalCostUSD: null },
  agent: { pricingInfo: { modelName: 'Some Model', provider: 'OpenCode Zen', totalCostUSD: 0.05, opencodeCost: 0.05 }, publicPricingEstimate: 0.05, anthropicTotalCostUSD: null },
};

describe('issue #3279: tool x {Anthropic, OpenAI, Formal AI} report cost and model the same way', () => {
  for (const [provider, models] of Object.entries(PROVIDERS)) {
    for (const [tool, model] of Object.entries(models)) {
      if (!model) continue;
      test(`${tool} x ${provider}`, async () => {
        const priced = applyServedModelPricing({ tool, model, ...TOOL_REPORTS[tool] });
        const attribution = resolveAttributionMode({ model });
        if (provider === 'Formal AI') {
          assert.equal(attribution.mode, 'formal-ai', 'attributed');
          assert.equal(priced.costSource, 'served-model-registry');
          assert.equal(priced.pricingInfo.modelName, 'formal-ai');
          assert.equal(priced.pricingInfo.provider, FORMAL_AI_PROVIDER_NAME);
          assert.equal(priced.pricingInfo.totalCostUSD, 0);
          assert.equal(priced.publicPricingEstimate, 0);
          assert.equal(priced.anthropicTotalCostUSD, null, 'no vendor cost line survives');
          const comment = buildCostInfoString(priced.publicPricingEstimate, priced.anthropicTotalCostUSD, priced.pricingInfo);
          assert.equal(comment, ['', '', '### 💰 **Cost estimation:**', '- Model: formal-ai', `- Provider: ${FORMAL_AI_PROVIDER_NAME}`, '- Public pricing estimate: $0.00 (Free model)'].join('\n'), 'the attached-log comment is identical for every client');
        } else {
          assert.equal(attribution.mode, 'none', 'a vendor model is not attributed');
          assert.equal(priced.costSource, 'tool', 'and keeps the cost its own client reported');
          assert.equal(priced.publicPricingEstimate, TOOL_REPORTS[tool].publicPricingEstimate);
          assert.equal(priced.anthropicTotalCostUSD, TOOL_REPORTS[tool].anthropicTotalCostUSD);
        }
      });
    }
  }

  test('every per-tool calculator asks the same served-model registry', async () => {
    const usage = { inputTokens: 10, outputTokens: 5 };
    const expected = servedModelPricingInfo('formal-ai', usage);
    assert.deepEqual(await calculateCodexPricing('formal-ai', usage), expected);
    assert.deepEqual(await calculateAgentPricing('formal-ai', usage), expected);
    assert.equal(servedModelPricingInfo('gpt-5', usage), null, 'a vendor model is left to models.dev');
  });

  test('the served model decides the price, not the model named on the command line', () => {
    const priced = applyServedModelPricing({ tool: 'claude', model: LOCAL_MODEL, servedModels: ['formal-ai'], ...TOOL_REPORTS.claude });
    assert.equal(priced.pricingInfo.totalCostUSD, 0);
    assert.equal(priced.anthropicTotalCostUSD, null);
  });

  test('a router behind ANTHROPIC_BASE_URL that serves real Claude models keeps the Anthropic cost', () => {
    const priced = applyServedModelPricing({ tool: 'claude', model: 'sonnet', servedModels: ['claude-sonnet-4-5'], baseUrl: 'https://router.example.com', ...TOOL_REPORTS.claude });
    assert.equal(priced.costSource, 'tool');
    assert.equal(priced.anthropicTotalCostUSD, 0.252315);
  });

  test('every Claude or OpenAI spelling a router can name keeps its vendor cost, and is never published as Formal AI', async () => {
    const { isVendorModel } = await import('../src/formal-ai-pricing.lib.mjs');
    const { detectHostedModel } = await import('../src/formal-ai-attribution.lib.mjs');
    const vendorModels = { claude: ['opus', 'sonnet-5-5', 'opusplan', 'best', 'fable', 'mythos-5', 'claude-haiku-5-5', 'us.anthropic.claude-opus-4-8', 'bedrock/anthropic.claude-sonnet-4-5'], codex: ['gpt-5.5', 'o3', 'o4-mini', 'openai.sol', 'openai/gpt-6.1-sol', 'codex-auto-review'] };
    for (const [tool, models] of Object.entries(vendorModels)) {
      for (const model of models) {
        assert.equal(isVendorModel({ tool, modelId: model }), true, `${tool} vendor serves ${model}`);
        assert.ok(detectHostedModel(model), `${model} is a hosted model`);
        const priced = applyServedModelPricing({ tool, model, servedModels: [model], baseUrl: 'https://router.example.com', ...TOOL_REPORTS[tool] });
        assert.equal(priced.costSource, 'tool', `${tool} ${model} keeps the cost its client reported`);
      }
    }
    for (const model of ['formal-ai', 'Formal-AI', 'formalai/formal-ai']) {
      assert.equal(isVendorModel({ tool: 'claude', modelId: model }), false, model);
      assert.equal(detectHostedModel(model), null, model);
    }
  });

  test('any other model behind a non-Anthropic ANTHROPIC_BASE_URL loses the Anthropic list price', () => {
    const resultModelUsage = { 'qwen3-coder': { inputTokens: 10, outputTokens: 5, costUSD: 0.252315 } };
    const priced = applyServedModelPricing({ tool: 'claude', model: 'qwen3-coder', servedModels: ['qwen3-coder'], baseUrl: 'http://127.0.0.1:8080/v1', ...TOOL_REPORTS.claude, resultModelUsage });
    assert.equal(priced.costSource, 'served-model');
    assert.equal(priced.anthropicTotalCostUSD, null);
    assert.equal(priced.publicPricingEstimate, null);
    assert.equal(priced.pricingInfo.modelName, 'qwen3-coder');
    assert.equal(priced.pricingInfo.provider, '127.0.0.1');
    assert.deepEqual(priced.resultModelUsage, { 'qwen3-coder': { inputTokens: 10, outputTokens: 5 } }, 'so the token counter cannot fall back to Claude’s own price');
    assert.match(buildCostInfoString(priced.publicPricingEstimate, priced.anthropicTotalCostUSD, priced.pricingInfo), /Public pricing estimate: unknown/);
  });

  test('a Formal AI session through Claude Code returns $0, not the Anthropic list price', async () => {
    const repo = makeRepo('claude-pricing');
    const run = await runClaude({ repo, argv: { model: LOCAL_MODEL, attribution: 'none' }, commit: false });
    assert.equal(run.result.pricingInfo?.totalCostUSD, 0, 'the served model (formal-ai) prices the session');
    assert.equal(run.result.pricingInfo?.provider, FORMAL_AI_PROVIDER_NAME);
    assert.equal(run.result.anthropicTotalCostUSD, null);
  });
});
