/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { runReview } from '../src/review.run.lib.mjs';
import { createThinkingBlockRecovery } from '../src/claude.thinking-block-recovery.lib.mjs';
import { escapeReviewSystemPrompt, executeReviewTool } from '../src/review.lib.mjs';
import { showResumeCommand } from '../src/claude.resume-output.lib.mjs';
import { buildIncompleteTurnContinuationPrompt } from '../src/claude.print-turn.lib.mjs';

const prUrl = 'https://github.com/owner/repo/pull/42';
const submittedReview = { id: 2, user: { login: 'reviewer' }, state: 'CHANGES_REQUESTED', submitted_at: 'today', commit_id: 'head', html_url: `${prUrl}#pullrequestreview-2` };

async function fixture(options = {}) {
  const commands = [];
  const executions = [];
  const logs = [];
  const cleanupPaths = new Set();
  let reviewReads = 0;
  let commitReads = 0;
  async function run(strings, ...values) {
    const command = strings.reduce((text, part, index) => text + part + (values[index] ?? ''), '');
    commands.push(command);
    let stdout = '';
    if (command.includes('gh pr view') && command.includes('title,body')) stdout = JSON.stringify({ state: options.state || 'OPEN', title: 'PR', headRefName: 'feature', headRefOid: 'head' });
    else if (command.includes('gh pr view')) stdout = JSON.stringify({ headRefOid: options.changedHead ? 'changed' : 'head' });
    else if (command.includes('gh repo clone')) {
      cleanupPaths.add(path.dirname(values[1]));
      await fs.mkdir(path.join(values[1], '.git'), { recursive: true });
    } else if (command.includes('git rev-parse')) stdout = ++commitReads > 1 && options.changedCommit ? 'changed' : 'head';
    else if (command.includes('git status')) stdout = options.dirty || (options.editedCode && executions.length) ? ' M code.js' : '';
    else if (command.includes('gh pr diff')) stdout = '+new code';
    else if (command.includes('gh api user')) stdout = 'reviewer';
    else if (command.includes('/reviews')) stdout = JSON.stringify([reviewReads++ ? options.reviews || [submittedReview] : [{ ...submittedReview, id: 1 }]]);
    return { code: 0, stdout, stderr: '' };
  }
  const dollar = (first, ...values) => (Array.isArray(first) ? run(first, ...values) : run);
  const log = async text => {
    logs.push(text);
    if (text.startsWith('📁 Review context preserved: ')) cleanupPaths.add(text.slice('📁 Review context preserved: '.length));
  };
  const executeTool = async params => {
    executions.push(params);
    return options.result || { success: true };
  };
  const argv = { url: prUrl, tool: 'codex', model: 'gpt-5.5', focus: 'logic', ...options.argv };
  return { commands, executions, logs, argv, run: () => runReview({ argv, $: dollar, log, executeTool, authenticate: async () => {} }), cleanup: async () => Promise.all([...cleanupPaths].map(directory => fs.rm(directory, { recursive: true, force: true }))) };
}

test('workflow submits and verifies only a new review, keeping artifacts outside the checkout', { timeout: 15000 }, async () => {
  const state = await fixture();
  try {
    const result = await state.run();
    assert.equal(result.success, true);
    assert.deepEqual(result.reviews, [submittedReview]);
    assert.equal(state.executions.length, 1);
    const params = state.executions[0];
    assert.equal(params.prUrl, prUrl);
    assert.ok(params.systemPrompt.includes('Do not edit repository files'));
    assert.ok(!params.workspaceTmpDir.startsWith(params.tempDir + path.sep));
    assert.ok(state.logs.some(line => line.includes(submittedReview.html_url)));
    assert.ok(!state.commands.some(command => /git (commit|push|merge|add)/.test(command)));
  } finally {
    await state.cleanup();
  }
});

test('dry run writes prompts and diff but never starts a tool or submits feedback', async () => {
  const state = await fixture({ argv: { dryRun: true } });
  try {
    const result = await state.run();
    assert.equal(result.prepared, true);
    assert.equal(state.executions.length, 0);
    assert.equal(await fs.readFile(path.join(result.contextDir, 'pr-diff.patch'), 'utf8'), '+new code');
    assert.ok(JSON.parse(await fs.readFile(path.join(result.contextDir, 'review-prompts.json'), 'utf8')).systemPrompt);
    assert.ok(!state.commands.some(command => command.includes('/reviews')));
  } finally {
    await state.cleanup();
  }
});

for (const [label, reviews] of [
  ['old review', [{ ...submittedReview, id: 1 }]],
  ['pending review', [{ ...submittedReview, state: 'PENDING' }]],
  ['no review', []],
]) {
  test(`workflow fails instead of reporting success for ${label}`, async () => {
    const state = await fixture({ reviews });
    try {
      await assert.rejects(state.run(), /No new submitted review/);
    } finally {
      await state.cleanup();
    }
  });
}

test('accidental commits are detected and never auto-pushed', async () => {
  const state = await fixture({ changedCommit: true });
  try {
    await assert.rejects(state.run(), /modified tracked code or commits/);
  } finally {
    await state.cleanup();
  }
  assert.ok(!state.commands.some(command => command.includes('git push')));
});

test('tracked edits by the agent are detected and retained for inspection', async () => {
  const state = await fixture({ editedCode: true });
  try {
    await assert.rejects(state.run(), /modified tracked code or commits/);
    assert.ok(await fs.stat(state.executions[0].tempDir));
  } finally {
    await state.cleanup();
  }
});

test('a changing PR head cannot be reported as a completed current review', async () => {
  const state = await fixture({ changedHead: true });
  try {
    await assert.rejects(state.run(), /head changed during review/);
  } finally {
    await state.cleanup();
  }
});

test('usage limits preserve the checkout and print a review resume command', async () => {
  const state = await fixture({ result: { success: false, limitReached: true, sessionId: 'session' } });
  try {
    const result = await state.run();
    assert.equal(result.limitReached, true);
    assert.ok(state.logs.some(line => line.includes("'review'") && line.includes("'--working-directory'")));
    assert.ok(await fs.stat(result.tempDir));
  } finally {
    await state.cleanup();
  }
});

test('resume uses the original working directory and rejects dirty tracked files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'review-test-'));
  await fs.mkdir(path.join(directory, '.git'));
  const state = await fixture({ dirty: true, argv: { resume: 'session', workingDirectory: directory } });
  try {
    await assert.rejects(state.run(), /without changes to tracked files/);
    assert.equal(state.executions.length, 0);
    assert.ok(!state.commands.some(command => command.includes('gh repo clone')));
  } finally {
    await state.cleanup();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('agent-commander receives review prompts rather than solve prompts', async () => {
  const result = await executeReviewTool(
    { argv: { tool: 'codex', useAgentCommander: true }, prompt: 'review user prompt', systemPrompt: 'review only' },
    {
      loadTool: async name => {
        assert.equal(name, './agent-commander.lib.mjs');
        return {
          executeWithAgentCommander: async params => {
            assert.equal(params.promptModule.buildUserPrompt(), 'review user prompt');
            assert.equal(params.promptModule.buildSystemPrompt(), 'review only');
            assert.equal(params.argv.reviewMode, true);
            return { success: true };
          },
        };
      },
    }
  );
  assert.equal(result.success, true);
});

test('Claude thinking recovery in review mode never commits or pushes', async () => {
  const commands = [];
  const argv = { reviewMode: true };
  const recover = createThinkingBlockRecovery({
    argv,
    tempDir: '/tmp/review',
    branchName: 'feature',
    $: () => async strings => {
      commands.push(strings.join(''));
      return { code: 0, stdout: ' M code.js' };
    },
    log: async () => {},
    waitMs: 0,
    repair: async () => ({ repaired: false }),
  });
  assert.equal(await recover({ classified: { label: 'thinking error' }, source: 'test', sessionId: 'session' }), true);
  assert.equal(argv.resume, 'session');
  assert.deepEqual(commands, []);
});

test('review system prompt escapes shell metacharacters literally', () => {
  assert.equal(escapeReviewSystemPrompt('`cmd` $var "value" \\'), '\\`cmd\\` \\$var \\"value\\" \\\\');
  const prompt = 'security `printf expanded` $(printf expanded) $USER "literal" \\';
  assert.equal(execFileSync('/bin/sh', ['-c', `printf '%s' "${escapeReviewSystemPrompt(prompt)}"`], { encoding: 'utf8', timeout: 15000 }), prompt);
});

test('Claude resume output keeps review-only options and never recommends solve', async () => {
  const logs = [];
  await showResumeCommand('session', '/tmp/review', 'claude', 'sonnet', async text => logs.push(text), { reviewMode: true, url: prUrl, tool: 'claude', model: 'sonnet', focus: 'security', approve: true });
  const output = logs.join('');
  assert.ok(output.includes("'review'"));
  assert.ok(output.includes("'--focus' 'security'"));
  assert.ok(output.includes("'--approve'"));
  assert.ok(!output.includes('solve') && !output.includes('Autonomous mode'));
});

test('Claude incomplete review recovery continues feedback without introducing coding requirements', () => {
  const prompt = buildIncompleteTurnContinuationPrompt({ reviewMode: true, cause: 'cancelled', ceilingSeconds: 600, stoppedTasks: [{ id: 'review', summary: 'Review diff' }] });
  assert.ok(prompt.includes('Do not edit code, commit, or push'));
  assert.ok(prompt.includes('inline findings and the summary verdict'));
  assert.ok(prompt.includes('600s') && prompt.includes('Review diff'));
  assert.ok(!prompt.includes('finish every remaining issue and pull-request requirement'));
});
