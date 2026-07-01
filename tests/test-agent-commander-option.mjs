#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { stdout } from 'node:process';

import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { AGENT_COMMANDER_TOOLS, buildAgentCommanderControllerOptions, buildAgentCommanderToolOptions, executeWithAgentCommander, summarizeAgentCommanderResult, validateAgentCommanderConnection } from '../src/agent-commander.lib.mjs';
import { buildAgentBudgetStats, buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';

const logs = [];
const log = async message => {
  logs.push(String(message));
};

assert.deepEqual([...AGENT_COMMANDER_TOOLS].sort(), ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen']);

const actualAgentCommanderModule = await import('agent-commander');
for (const toolName of AGENT_COMMANDER_TOOLS) {
  assert.equal(actualAgentCommanderModule.isToolSupported({ toolName }), true, `agent-commander should support ${toolName}`);
}

const flagDefinition = SOLVE_OPTION_DEFINITIONS['use-agent-commander'];
assert.equal(flagDefinition.type, 'boolean');
assert.equal(flagDefinition.default, false);
assert.equal(flagDefinition.hidden, true);
assert.ok(getSolvePassthroughOptionNames().includes('use-agent-commander'), 'hive should forward --use-agent-commander to solve workers');

const claudeToolOptions = buildAgentCommanderToolOptions({ verbose: true, fallbackModel: 'opus' }, 'claude');
assert.equal(claudeToolOptions.verbose, true);
assert.equal(claudeToolOptions.fallbackModel, 'opus');

const codexToolOptions = buildAgentCommanderToolOptions({ verbose: true, fallbackModel: 'opus' }, 'codex');
assert.deepEqual(codexToolOptions.extraArgs, ['-c', 'model_reasoning_effort=none', '-c', 'model_reasoning_summary=auto']);

const geminiToolOptions = buildAgentCommanderToolOptions({ verbose: true }, 'gemini');
assert.deepEqual(geminiToolOptions, { debug: true });

const claudeOptions = buildAgentCommanderControllerOptions({
  tool: 'claude',
  tempDir: '/tmp/repo',
  prompt: 'user prompt',
  systemPrompt: 'system prompt',
  argv: {
    model: 'sonnet',
    resume: 'session-123',
    verbose: true,
    fallbackModel: 'opus',
  },
});

assert.equal(claudeOptions.tool, 'claude');
assert.equal(claudeOptions.workingDirectory, '/tmp/repo');
assert.equal(claudeOptions.model, 'claude-sonnet-5');
assert.equal(claudeOptions.resume, 'session-123');
assert.equal(claudeOptions.json, true);
assert.equal(claudeOptions.toolOptions.verbose, true);
assert.equal(claudeOptions.toolOptions.fallbackModel, 'opus');

const agentOptions = buildAgentCommanderControllerOptions({
  tool: 'agent',
  tempDir: '/tmp/repo',
  prompt: 'user prompt',
  systemPrompt: 'system prompt',
  argv: { model: 'opus' },
});
assert.equal(agentOptions.json, false, 'native agent output is already parsed by agent-commander');

const geminiOptions = buildAgentCommanderControllerOptions({
  tool: 'gemini',
  tempDir: '/tmp/repo',
  prompt: 'user prompt',
  systemPrompt: 'system prompt',
  argv: { model: 'gemini' },
});
assert.equal(geminiOptions.json, true, 'Gemini stream-json output should be parsed by agent-commander');
assert.equal(geminiOptions.model, 'gemini-2.5-flash', 'Gemini alias should be normalized before passing to agent-commander');

const qwenOptions = buildAgentCommanderControllerOptions({
  tool: 'qwen',
  tempDir: '/tmp/repo',
  prompt: 'user prompt',
  systemPrompt: 'system prompt',
  argv: { model: 'qwen' },
});
assert.equal(qwenOptions.json, true, 'Qwen stream-json output should be parsed by agent-commander');
assert.equal(qwenOptions.model, 'qwen3-coder-plus', 'Qwen alias should be normalized before passing to agent-commander');

const validationCapture = {};
const validationModule = {
  isToolSupported: ({ toolName }) => toolName === 'opencode',
  agent: options => {
    validationCapture.options = options;
    return {
      start: async options => {
        validationCapture.start = options;
      },
    };
  },
};

assert.equal(
  await validateAgentCommanderConnection({
    tool: 'opencode',
    model: 'grok-code',
    log,
    agentCommanderModule: validationModule,
  }),
  true
);
assert.equal(validationCapture.options.tool, 'opencode');
assert.equal(validationCapture.options.model, 'opencode/grok-code');
assert.deepEqual(validationCapture.start, { dryRun: true, attached: false });

const executionCapture = {};
const executionModule = {
  isToolSupported: ({ toolName }) => AGENT_COMMANDER_TOOLS.has(toolName),
  agent: options => {
    executionCapture.options = options;
    return {
      start: async options => {
        executionCapture.start = options;
      },
      stop: async () => ({
        exitCode: 0,
        sessionId: 'codex-session-1',
        output: {
          plain: '{"type":"result","summary":"done from codex"}\n',
          parsed: [{ type: 'result', summary: 'done from codex', session_id: 'codex-session-1' }],
        },
        usage: {
          inputTokens: 11,
          outputTokens: 7,
        },
        metadata: {
          success: true,
          sessionId: 'codex-session-from-metadata',
          limitReached: false,
          limitResetTime: null,
          limitTimezone: null,
          anthropicTotalCostUSD: null,
          publicPricingEstimate: null,
          pricingInfo: null,
          resultSummary: 'done from metadata',
          resultModelUsage: { modelId: 'gpt-5.5' },
          streamTokenUsage: {
            inputTokens: 11,
            outputTokens: 7,
          },
          subAgentCalls: null,
          errorDuringExecution: false,
        },
      }),
    };
  },
};

const promptModule = {
  buildUserPrompt: params => `issue ${params.issueNumber} in ${params.workspaceTmpDir}`,
  buildSystemPrompt: params => `system for ${params.argv.tool}`,
};

const result = await executeWithAgentCommander({
  agentCommanderModule: executionModule,
  promptModule,
  issueUrl: 'https://github.com/link-assistant/hive-mind/issues/1043',
  issueNumber: 1043,
  prNumber: 1044,
  prUrl: 'https://github.com/link-assistant/hive-mind/pull/1044',
  branchName: 'issue-1043-824a8917a5fe',
  tempDir: '/tmp/repo',
  workspaceTmpDir: '/tmp/repo/tmp',
  isContinueMode: false,
  mergeStateStatus: null,
  forkedRepo: null,
  feedbackLines: [],
  forkActionsUrl: null,
  owner: 'link-assistant',
  repo: 'hive-mind',
  argv: {
    tool: 'codex',
    model: 'gpt-5.5',
    resume: 'codex-session-1',
    verbose: false,
  },
  log,
});

assert.equal(executionCapture.options.tool, 'codex');
assert.equal(executionCapture.options.workingDirectory, '/tmp/repo');
assert.equal(executionCapture.options.prompt, 'issue 1043 in /tmp/repo/tmp');
assert.equal(executionCapture.options.systemPrompt, 'system for codex');
assert.equal(executionCapture.options.model, 'gpt-5.5');
assert.equal(executionCapture.options.resume, 'codex-session-1');
assert.equal(executionCapture.options.json, true);
assert.equal(executionCapture.start.dryRun, false);
assert.equal(executionCapture.start.attached, true);
assert.equal(typeof executionCapture.start.onOutput, 'function');
assert.equal(result.success, true);
assert.equal(result.sessionId, 'codex-session-from-metadata');
assert.equal(result.resultSummary, 'done from metadata');
assert.deepEqual(result.resultModelUsage, { modelId: 'gpt-5.5' });
assert.deepEqual(result.streamTokenUsage, { inputTokens: 11, outputTokens: 7 });

const claudeSummary = summarizeAgentCommanderResult({
  tool: 'claude',
  result: {
    exitCode: 0,
    output: {
      plain: '',
      parsed: [{ type: 'result', result: 'done from claude', session_id: 'claude-session-1', total_cost_usd: 0.12 }],
    },
  },
});
assert.equal(claudeSummary.sessionId, 'claude-session-1');
assert.equal(claudeSummary.anthropicTotalCostUSD, 0.12);
assert.equal(claudeSummary.resultSummary, 'done from claude');

const agentUsageSummary = summarizeAgentCommanderResult({
  tool: 'agent',
  result: {
    exitCode: 0,
    output: {
      plain: 'done',
      parsed: [{ type: 'result', result: 'done' }],
    },
    usage: {
      inputTokens: 94,
      outputTokens: 6600,
      cacheReadTokens: 1_100_000,
      cacheWriteTokens: 61_200,
      totalCost: 0.219954,
      contextLimit: 200_000,
      outputLimit: 64_000,
      respondedModelId: 'opencode/claude-haiku-4-5',
    },
  },
});
assert.equal(agentUsageSummary.pricingInfo.tokenUsage.contextFillInputTokens, 61_294);
const agentBudgetStats = buildAgentBudgetStats(agentUsageSummary.pricingInfo.tokenUsage, agentUsageSummary.pricingInfo);
const agentBudgetComment = buildBudgetStatsString(agentBudgetStats);
assert.ok(agentBudgetComment.includes('- 61.3K / 200K (31%) input tokens, 6.6K / 64K (10%) output tokens'), agentBudgetComment);
assert.ok(agentBudgetComment.includes('Total: (94 new + 61.2K cache writes + 1.1M cache reads) input tokens'), agentBudgetComment);

stdout.write('agent-commander option tests passed\n');
