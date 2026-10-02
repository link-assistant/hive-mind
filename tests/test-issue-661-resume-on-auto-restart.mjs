#!/usr/bin/env node

import assert from 'node:assert/strict';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { buildSystemPrompt, buildUserPrompt } from '../src/claude.prompts.lib.mjs';
import { generateMinimalRestartPrompt } from '../src/solve.minimal-restart-prompt.lib.mjs';

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function createMockDollar(responses) {
  const calls = [];
  const dollar = options => async strings => {
    const command = strings.join('');
    calls.push({ cwd: options.cwd, command });
    const stdout = responses[command] ?? '';
    return { code: 0, stdout: Buffer.from(stdout), stderr: Buffer.from('') };
  };
  dollar.calls = calls;
  return dollar;
}

test('resume-on-auto-restart is an experimental boolean solve option disabled by default', () => {
  const option = SOLVE_OPTION_DEFINITIONS['resume-on-auto-restart'];
  assert.equal(option.type, 'boolean');
  assert.equal(option.default, false);
  assert.match(option.description, /EXPERIMENTAL/);
});

test('minimal restart context omits the full issue prompt', () => {
  const prompt = buildUserPrompt({
    issueUrl: 'https://github.com/link-assistant/hive-mind/issues/661',
    issueNumber: 661,
    prNumber: 662,
    prUrl: 'https://github.com/link-assistant/hive-mind/pull/662',
    branchName: 'issue-661',
    tempDir: '/tmp/work',
    isContinueMode: true,
    feedbackLines: ['Minimal auto-restart prompt'],
    owner: 'link-assistant',
    repo: 'hive-mind',
    argv: { minimalRestartContext: true, resume: 'session-123' },
  });

  assert.equal(prompt, 'Minimal auto-restart prompt\n');
  assert(!prompt.includes('Issue to solve:'));
  assert(!prompt.includes('Your prepared branch:'));
});

test('minimal restart context suppresses the full system prompt', () => {
  const systemPrompt = buildSystemPrompt({
    owner: 'link-assistant',
    repo: 'hive-mind',
    issueNumber: 661,
    prNumber: 662,
    branchName: 'issue-661',
    argv: { minimalRestartContext: true, resume: 'session-123' },
  });

  assert.equal(systemPrompt, '');
});

test('minimal restart prompt lists status plus staged and unstaged summaries', async () => {
  const dollar = createMockDollar({
    'git status --porcelain': ' M src/solve.watch.lib.mjs\nA  tests/test-issue-661-resume-on-auto-restart.mjs\n?? notes.txt\n',
    'git diff --stat': ' src/solve.watch.lib.mjs | 12 +++++++++++-\n 1 file changed, 11 insertions(+), 1 deletion(-)\n',
    'git diff --cached --stat': ' tests/test-issue-661-resume-on-auto-restart.mjs | 75 +++++++++++++++++++++++++\n 1 file changed, 75 insertions(+)\n',
  });

  const prompt = await generateMinimalRestartPrompt('/tmp/work', dollar);

  assert.match(prompt, /Uncommitted files \(3\):/);
  assert.match(prompt, /M src\/solve\.watch\.lib\.mjs/);
  assert.match(prompt, /Staged changes:/);
  assert.match(prompt, /Unstaged changes:/);
  assert.equal(dollar.calls.length, 3);
  assert(dollar.calls.every(call => call.cwd === '/tmp/work'));
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(error.stack || error.message);
  }
}

if (failed > 0) {
  process.exit(1);
}
