#!/usr/bin/env node

/**
 * Regression test for issue #1994.
 *
 * A solve run with --base-branch and --auto-merge initially created the PR
 * correctly, but the agent later retargeted the PR to the default branch with
 * `gh pr edit --base master`. The user prompt must preserve the requested
 * base-branch fact without exposing --auto-merge, runtime guards must restore
 * the user-requested base before verification, and auto-merge must fail clearly
 * if the PR base was retargeted.
 */

import nodeAssert from 'node:assert/strict';
import { test, asyncTest, printSummary, getFailCount } from './test-helpers.mjs';
import { buildSystemPrompt as buildClaudeSystemPrompt, buildUserPrompt as buildClaudeUserPrompt } from '../src/claude.prompts.lib.mjs';
import { buildSystemPrompt as buildCodexSystemPrompt, buildUserPrompt as buildCodexUserPrompt } from '../src/codex.prompts.lib.mjs';
import { buildSystemPrompt as buildGeminiSystemPrompt, buildUserPrompt as buildGeminiUserPrompt } from '../src/gemini.prompts.lib.mjs';
import { buildSystemPrompt as buildOpenCodeSystemPrompt, buildUserPrompt as buildOpenCodeUserPrompt } from '../src/opencode.prompts.lib.mjs';
import { buildSystemPrompt as buildAgentSystemPrompt, buildUserPrompt as buildAgentUserPrompt } from '../src/agent.prompts.lib.mjs';
import { buildSystemPrompt as buildQwenSystemPrompt, buildUserPrompt as buildQwenUserPrompt } from '../src/qwen.prompts.lib.mjs';
import { buildPullRequestBaseBranchInterventionMessage, detectForbiddenPullRequestBaseChangeCommand, ensurePullRequestBaseBranch, extractToolCommandTextsFromStreamEvent, getExpectedPullRequestBaseBranch } from '../src/solve.pr-base-guard.lib.mjs';

const promptBuilders = {
  claude: { buildSystemPrompt: buildClaudeSystemPrompt, buildUserPrompt: buildClaudeUserPrompt },
  codex: { buildSystemPrompt: buildCodexSystemPrompt, buildUserPrompt: buildCodexUserPrompt },
  gemini: { buildSystemPrompt: buildGeminiSystemPrompt, buildUserPrompt: buildGeminiUserPrompt },
  opencode: { buildSystemPrompt: buildOpenCodeSystemPrompt, buildUserPrompt: buildOpenCodeUserPrompt },
  agent: { buildSystemPrompt: buildAgentSystemPrompt, buildUserPrompt: buildAgentUserPrompt },
  qwen: { buildSystemPrompt: buildQwenSystemPrompt, buildUserPrompt: buildQwenUserPrompt },
};

function basePromptParams(argv = {}) {
  return {
    owner: 'Payel-git-ol',
    repo: 'Octra',
    issueUrl: 'https://github.com/Payel-git-ol/Octra/issues/107',
    issueNumber: 107,
    prNumber: 108,
    prUrl: 'https://github.com/Payel-git-ol/Octra/pull/108',
    branchName: 'issue-107-a16883408ed8',
    tempDir: '/tmp/gh-issue-solver-107',
    workspaceTmpDir: null,
    isContinueMode: false,
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

test('all solver user prompts include only the explicit --base-branch fact', () => {
  for (const [tool, { buildSystemPrompt, buildUserPrompt }] of Object.entries(promptBuilders)) {
    const params = basePromptParams({ baseBranch: 'create/new-concept', autoMerge: true });
    const userPrompt = buildUserPrompt(params);
    const systemPrompt = buildSystemPrompt(params);
    const combinedPrompt = `${userPrompt}\n${systemPrompt}`;

    nodeAssert.ok(userPrompt.includes('Requested by user --base-branch: create/new-concept'), `${tool} user prompt should name the requested base branch`);
    nodeAssert.ok(userPrompt.includes('The user expects the pull request base branch to remain create/new-concept.'), `${tool} user prompt should state the expected PR base`);
    nodeAssert.equal(systemPrompt.includes('Requested by user --base-branch: create/new-concept'), false, `${tool} system prompt should not include the base-branch directive`);
    nodeAssert.equal(combinedPrompt.includes('Locked solve options.'), false, `${tool} prompt should not include the old locked-options block`);
    nodeAssert.equal(combinedPrompt.includes('--auto-merge'), false, `${tool} prompt should not expose --auto-merge`);
  }
});

test('base branch guard only locks explicit --base-branch requests', () => {
  nodeAssert.equal(getExpectedPullRequestBaseBranch({ argv: { baseBranch: 'create/new-concept' } }), 'create/new-concept');
  nodeAssert.equal(getExpectedPullRequestBaseBranch({ argv: {} }), null);
});

test('forbidden PR base retarget commands are detected from tool events', () => {
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'Bash',
          input: {
            command: 'cd /tmp/repo && gh pr edit 108 --base master',
          },
        },
      ],
    },
  };

  const commands = extractToolCommandTextsFromStreamEvent(event);
  nodeAssert.deepEqual(commands, ['cd /tmp/repo && gh pr edit 108 --base master']);

  const violation = detectForbiddenPullRequestBaseChangeCommand(commands[0], {
    expectedBaseBranch: 'create/new-concept',
    prNumber: 108,
  });

  nodeAssert.equal(violation.attemptedBaseBranch, 'master');
  nodeAssert.equal(violation.expectedBaseBranch, 'create/new-concept');
  nodeAssert.equal(violation.commandKind, 'gh_pr_edit');
  nodeAssert.equal(
    detectForbiddenPullRequestBaseChangeCommand('gh pr edit --repo Payel-git-ol/Octra 108 --base master', {
      expectedBaseBranch: 'create/new-concept',
      prNumber: 108,
    }).attemptedBaseBranch,
    'master'
  );
  nodeAssert.equal(
    detectForbiddenPullRequestBaseChangeCommand('gh pr edit 108 --base master && gh pr edit 108 --base create/new-concept', {
      expectedBaseBranch: 'create/new-concept',
      prNumber: 108,
    }).attemptedBaseBranch,
    'master'
  );
  nodeAssert.equal(
    detectForbiddenPullRequestBaseChangeCommand('gh pr edit 108 --base create/new-concept', {
      expectedBaseBranch: 'create/new-concept',
      prNumber: 108,
    }),
    null
  );
  nodeAssert.equal(
    detectForbiddenPullRequestBaseChangeCommand('gh pr edit 109 --base master', {
      expectedBaseBranch: 'create/new-concept',
      prNumber: 108,
    }),
    null
  );
});

test('equivalent gh api PR base updates are detected', () => {
  const violation = detectForbiddenPullRequestBaseChangeCommand('gh api repos/Payel-git-ol/Octra/pulls/108 -X PATCH -f base=master', {
    expectedBaseBranch: 'create/new-concept',
    prNumber: 108,
  });

  nodeAssert.equal(violation.attemptedBaseBranch, 'master');
  nodeAssert.equal(violation.commandKind, 'gh_api_pull_update');
});

test('base branch intervention message tells the agent to continue finishing the PR', () => {
  const message = buildPullRequestBaseBranchInterventionMessage({
    prNumber: 108,
    expectedBaseBranch: 'create/new-concept',
    attemptedBaseBranch: 'master',
    command: 'gh pr edit 108 --base master',
  });

  nodeAssert.ok(message.includes('The user requested --base-branch create/new-concept.'));
  nodeAssert.ok(message.includes('Do not change PR #108'));
  nodeAssert.ok(message.includes('continue finishing the pull request and make it ready for review'));
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

await asyncTest('ensurePullRequestBaseBranch fails clearly instead of restoring before auto-merge', async () => {
  const $ = createFakeDollar([{ stdout: 'master\n' }]);

  await nodeAssert.rejects(
    ensurePullRequestBaseBranch({
      owner: 'Payel-git-ol',
      repo: 'Octra',
      prNumber: 108,
      argv: { baseBranch: 'create/new-concept' },
      log: async () => {},
      formatAligned: (icon, label, value) => `${icon} ${label} ${value}`,
      $,
      onMismatch: 'throw',
      operation: 'auto-merge',
    }),
    /Cannot auto-merge PR #108 because its base branch changed to master.*--base-branch create\/new-concept/
  );

  nodeAssert.deepEqual($.commands, ['gh pr view 108 --repo Payel-git-ol/Octra --json baseRefName --jq .baseRefName']);
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
