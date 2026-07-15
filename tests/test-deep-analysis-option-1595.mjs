#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { buildUserPrompt as buildAgentUserPrompt } from '../src/agent.prompts.lib.mjs';
import { buildUserPrompt as buildClaudeUserPrompt } from '../src/claude.prompts.lib.mjs';
import { buildUserPrompt as buildCodexUserPrompt } from '../src/codex.prompts.lib.mjs';
import { buildUserPrompt as buildGeminiUserPrompt } from '../src/gemini.prompts.lib.mjs';
import { buildUserPrompt as buildOpenCodeUserPrompt } from '../src/opencode.prompts.lib.mjs';
import { buildUserPrompt as buildQwenUserPrompt } from '../src/qwen.prompts.lib.mjs';
import { buildDeepAnalysisPrompt, buildIssueResearchPrompt, isDeepAnalysisEnabled } from '../src/deep-analysis.lib.mjs';
import { isIssueTypeAwarePromptEnabled } from '../src/development-log.lib.mjs';

const option = SOLVE_OPTION_DEFINITIONS['deep-analysis'];
assert.ok(option, '--deep-analysis should be defined');
assert.equal(option.type, 'boolean');
assert.equal(option.default, false);
assert.ok(getSolvePassthroughOptionNames().includes('deep-analysis'), '--deep-analysis should pass through hive');

assert.equal(isDeepAnalysisEnabled({ deepAnalysis: true }), true);
assert.equal(isDeepAnalysisEnabled({ 'deep-analysis': true }), true);
assert.equal(isDeepAnalysisEnabled({}), false);
assert.equal(isIssueTypeAwarePromptEnabled({ deepAnalysis: true }), true);
assert.equal(isIssueTypeAwarePromptEnabled({ developmentLog: true }), true);
assert.equal(isIssueTypeAwarePromptEnabled({}), false);
assert.equal(buildDeepAnalysisPrompt({ argv: {}, issueNumber: 1595, prNumber: 2068 }), '');

const featureWithoutLogs = buildDeepAnalysisPrompt({
  argv: { deepAnalysis: true },
  issueNumber: 1595,
  prNumber: 2068,
  issueType: 'Feature',
});
assert.ok(featureWithoutLogs.includes('deep analysis'));
assert.ok(featureWithoutLogs.includes('search online for additional facts and data'));
assert.ok(featureWithoutLogs.includes('list each and every requirement'));
assert.ok(featureWithoutLogs.includes('existing components/libraries'));
assert.ok(featureWithoutLogs.includes('entire codebase'));
assert.ok(!featureWithoutLogs.includes('./dev/log/'), 'deep analysis alone must not activate development logging');
assert.ok(!featureWithoutLogs.includes('Download all logs'));
assert.ok(!featureWithoutLogs.includes('add debug output and a verbose mode'));

const unspecifiedTypePrompt = buildDeepAnalysisPrompt({
  argv: { deepAnalysis: true },
  issueNumber: 1595,
  prNumber: 2068,
});
assert.ok(unspecifiedTypePrompt.includes('Do a deep analysis'));
assert.ok(!unspecifiedTypePrompt.includes('Download all logs'));
assert.ok(!unspecifiedTypePrompt.includes('add debug output and a verbose mode'));

const featureWithLogs = buildDeepAnalysisPrompt({
  argv: { deepAnalysis: true, developmentLog: true },
  issueNumber: 1595,
  prNumber: 2068,
  issueType: 'Task',
});
assert.ok(featureWithLogs.includes('Collect data related about the issue'));
assert.ok(featureWithLogs.includes('./dev/log/issues/1595/pulls/2068'));
assert.ok(!featureWithLogs.includes('Download all logs'));

const bugWithLogs = buildDeepAnalysisPrompt({
  argv: { 'deep-analysis': true, 'development-log': true },
  issueNumber: 1595,
  prNumber: 2068,
  issueType: 'Bug',
});
assert.ok(bugWithLogs.includes('Download all logs and collect data related about the issue'));
assert.ok(bugWithLogs.includes('reconstruct the timeline/sequence of events'));
assert.ok(bugWithLogs.includes('root cause of each problem'));
assert.ok(bugWithLogs.includes('add debug output and a verbose mode'));
assert.ok(bugWithLogs.includes('default state switched off'));
assert.ok(bugWithLogs.includes('report issues on GitHub'));
assert.ok(bugWithLogs.includes('reproducible examples, workarounds, and suggestions'));
assert.equal((bugWithLogs.match(/Download all logs/g) || []).length, 1, 'combined prompt should not duplicate development-log collection');

const developmentLogOnly = buildIssueResearchPrompt({
  argv: { developmentLog: true },
  issueNumber: 1595,
  prNumber: 2068,
  issueType: 'Bug',
});
assert.ok(developmentLogOnly.includes('Download all logs'));
assert.ok(!developmentLogOnly.includes('reconstruct the timeline/sequence of events'));

const promptParams = {
  owner: 'link-assistant',
  repo: 'hive-mind',
  issueNumber: 1595,
  prNumber: 2068,
  prUrl: 'https://github.com/link-assistant/hive-mind/pull/2068',
  issueUrl: 'https://github.com/link-assistant/hive-mind/issues/1595',
  branchName: 'issue-1595-test',
  tempDir: '/tmp/hive-mind',
  isContinueMode: false,
  feedbackLines: [],
  argv: { deepAnalysis: true, developmentLog: true, issueType: 'Bug' },
};

const promptBuilders = {
  agent: buildAgentUserPrompt,
  claude: buildClaudeUserPrompt,
  codex: buildCodexUserPrompt,
  gemini: buildGeminiUserPrompt,
  opencode: buildOpenCodeUserPrompt,
  qwen: buildQwenUserPrompt,
};

for (const [tool, buildUserPrompt] of Object.entries(promptBuilders)) {
  const prompt = buildUserPrompt(promptParams);
  assert.ok(prompt.includes('Download all logs and collect data related about the issue'), `${tool} user prompt should include bug deep-analysis instructions`);
  assert.ok(prompt.includes('reconstruct the timeline/sequence of events'), `${tool} user prompt should include deep-analysis work`);
}

console.log('✅ --deep-analysis option tests passed');
