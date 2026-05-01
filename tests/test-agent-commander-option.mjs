#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { stdout } from 'node:process';

import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { AGENT_COMMANDER_TOOLS, buildAgentCommanderControllerOptions, buildAgentCommanderToolOptions, executeWithAgentCommander, summarizeAgentCommanderResult, validateAgentCommanderConnection } from '../src/agent-commander.lib.mjs';

const logs = [];
const log = async message => {
  logs.push(String(message));
};

assert.deepEqual([...AGENT_COMMANDER_TOOLS].sort(), ['agent', 'claude', 'codex', 'opencode']);

const flagDefinition = SOLVE_OPTION_DEFINITIONS['use-agent-commander'];
assert.equal(flagDefinition.type, 'boolean');
assert.equal(flagDefinition.default, false);
assert.equal(flagDefinition.hidden, true);
assert.ok(getSolvePassthroughOptionNames().includes('use-agent-commander'), 'hive should forward --use-agent-commander to solve workers');

assert.deepEqual(buildAgentCommanderToolOptions({ verbose: true, fallbackModel: 'opus' }, 'claude'), {
  verbose: true,
  fallbackModel: 'opus',
});
assert.deepEqual(buildAgentCommanderToolOptions({ verbose: true, fallbackModel: 'opus' }, 'codex'), {});

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
assert.equal(claudeOptions.model, 'sonnet');
assert.equal(claudeOptions.resume, 'session-123');
assert.equal(claudeOptions.json, true);
assert.deepEqual(claudeOptions.toolOptions, { verbose: true, fallbackModel: 'opus' });

const agentOptions = buildAgentCommanderControllerOptions({
  tool: 'agent',
  tempDir: '/tmp/repo',
  prompt: 'user prompt',
  systemPrompt: 'system prompt',
  argv: { model: 'opus' },
});
assert.equal(agentOptions.json, false, 'native agent output is already parsed by agent-commander');

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
assert.equal(validationCapture.options.model, 'grok-code');
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
assert.equal(result.sessionId, 'codex-session-1');
assert.equal(result.resultSummary, 'done from codex');
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

stdout.write('agent-commander option tests passed\n');
