#!/usr/bin/env node

/**
 * Regression test for issue #1994.
 *
 * A solve run with --base-branch and --auto-merge initially created the PR
 * correctly, but the agent later retargeted the PR to the default branch with
 * `gh pr edit --base master`. The prompt must forbid that, and runtime guards
 * must restore the user-requested base before verification or auto-merge.
 */

import nodeAssert from 'node:assert/strict';
import { test, asyncTest, printSummary, getFailCount } from './test-helpers.mjs';
import { buildSystemPrompt as buildClaudeSystemPrompt } from '../src/claude.prompts.lib.mjs';
import { buildSystemPrompt as buildCodexSystemPrompt } from '../src/codex.prompts.lib.mjs';
import { buildSystemPrompt as buildGeminiSystemPrompt } from '../src/gemini.prompts.lib.mjs';
import { buildSystemPrompt as buildOpenCodeSystemPrompt } from '../src/opencode.prompts.lib.mjs';
import { buildSystemPrompt as buildAgentSystemPrompt } from '../src/agent.prompts.lib.mjs';
import { buildSystemPrompt as buildQwenSystemPrompt } from '../src/qwen.prompts.lib.mjs';
import { ensurePullRequestBaseBranch, getExpectedPullRequestBaseBranch } from '../src/solve.pr-base-guard.lib.mjs';

const promptBuilders = {
  claude: buildClaudeSystemPrompt,
  codex: buildCodexSystemPrompt,
  gemini: buildGeminiSystemPrompt,
  opencode: buildOpenCodeSystemPrompt,
  agent: buildAgentSystemPrompt,
  qwen: buildQwenSystemPrompt,
};

function basePromptParams(argv = {}) {
  return {
    owner: 'Payel-git-ol',
    repo: 'Octra',
    issueNumber: 107,
    prNumber: 108,
    branchName: 'issue-107-a16883408ed8',
    workspaceTmpDir: null,
    modelSupportsVision: false,
    forkedRepo: null,
    argv,
  };
}

function renderCommand(strings, values) {
  return strings.reduce((command, part, index) => command + part + (index < values.length ? String(values[index]) : ''), '');
}

function createFakeDollar(responses) {
  const commands = [];
  const $ = (strings, ...values) => {
    const command = renderCommand(strings, values);
    commands.push(command);
    const response = responses.shift();
    if (!response) {
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    return Promise.resolve({ code: 0, stdout: '', stderr: '', ...response });
  };
  $.commands = commands;
  return $;
}

test('all solver prompts lock explicit --base-branch and --auto-merge options', () => {
  for (const [tool, buildSystemPrompt] of Object.entries(promptBuilders)) {
    const prompt = buildSystemPrompt(basePromptParams({ baseBranch: 'create/new-concept', autoMerge: true }));

    nodeAssert.ok(prompt.includes('Locked solve options.'), `${tool} prompt should include locked options section`);
    nodeAssert.ok(prompt.includes('Requested base branch is locked: --base-branch create/new-concept'), `${tool} prompt should name the requested base branch`);
    nodeAssert.ok(prompt.includes('Do not retarget the pull request with gh pr edit --base'), `${tool} prompt should forbid PR base retargeting`);
    nodeAssert.ok(prompt.includes('--auto-merge was requested and is handled by hive-mind after verification.'), `${tool} prompt should keep auto-merge owned by hive-mind`);
  }
});

test('base branch guard only locks explicit --base-branch requests', () => {
  nodeAssert.equal(getExpectedPullRequestBaseBranch({ argv: { baseBranch: 'create/new-concept' } }), 'create/new-concept');
  nodeAssert.equal(getExpectedPullRequestBaseBranch({ argv: {} }), null);
});

await asyncTest('ensurePullRequestBaseBranch restores a retargeted pull request base', async () => {
  const $ = createFakeDollar([{ stdout: 'master\n' }, { stdout: '' }, { stdout: 'create/new-concept\n' }]);
  const logs = [];

  const result = await ensurePullRequestBaseBranch({
    owner: 'Payel-git-ol',
    repo: 'Octra',
    prNumber: 108,
    argv: { baseBranch: 'create/new-concept' },
    log: async message => logs.push(String(message)),
    formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
    $,
  });

  nodeAssert.deepEqual($.commands, ['gh pr view 108 --repo Payel-git-ol/Octra --json baseRefName --jq .baseRefName', 'gh pr edit 108 --repo Payel-git-ol/Octra --base create/new-concept', 'gh pr view 108 --repo Payel-git-ol/Octra --json baseRefName --jq .baseRefName']);
  nodeAssert.equal(result.restored, true);
  nodeAssert.equal(result.previousBaseBranch, 'master');
  nodeAssert.equal(result.currentBaseBranch, 'create/new-concept');
  nodeAssert.ok(logs.join('\n').includes('Base branch restored'));
});

await asyncTest('ensurePullRequestBaseBranch is a no-op without explicit --base-branch', async () => {
  const $ = createFakeDollar([]);

  const result = await ensurePullRequestBaseBranch({
    owner: 'Payel-git-ol',
    repo: 'Octra',
    prNumber: 108,
    argv: {},
    $,
  });

  nodeAssert.equal(result.checked, false);
  nodeAssert.equal(result.reason, 'no_explicit_base_branch');
  nodeAssert.deepEqual($.commands, []);
});

printSummary(80);

if (getFailCount() > 0) {
  process.exit(1);
}
