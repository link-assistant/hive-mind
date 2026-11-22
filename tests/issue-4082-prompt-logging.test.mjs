#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * PR #4083 review feedback on issue #4082: every prompt Hive Mind sends to an
 * AI tool must be printed in the log in full, after all formatting, clearly
 * marked, whether it is passed as an argument, a file, stdin or a live
 * stream-json frame. Before, Codex, Agent, OpenCode, Gemini and Qwen logged
 * only the prompt file path or length, and printed the text only in --dry-run
 * with --verbose; Claude printed it only with --verbose; live input frames,
 * agent-commander, /organize and the task command never printed it.
 *
 * The prompts themselves must stay human-readable multi-line plain text
 * without markdown, so the AI also sees a well formatted example.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 * @see https://github.com/link-assistant/hive-mind/pull/4083
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { countPromptLines, extractFrameText, formatPromptLogBlock, logFinalPrompts } from '../src/prompt-log.lib.mjs';
import { createBidirectionalHandler, utils as bidirectionalUtils } from '../src/bidirectional-interactive.lib.mjs';
import { runOrganizationClassifier } from '../src/organize.ai.lib.mjs';
import { buildOrganizationPrompts, chunkOrganizationIssues } from '../src/organize.prompts.lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = file => readFileSync(join(root, file), 'utf8');

const captureLog = () => {
  const calls = [];
  const log = async (message, options = {}) => {
    calls.push({ message: String(message), options });
  };
  return { calls, log, text: () => calls.map(call => call.message).join('\n') };
};

test('a prompt block is clearly marked and keeps the text exactly', () => {
  const text = 'First line.\n\nSecond paragraph:\n- item one\n- item two\n';
  const block = formatPromptLogBlock({ tool: 'codex', kind: 'combined', text, delivery: 'stdin from file /tmp/p.txt' });
  const lines = block.split('\n');
  assert.equal(lines[0], `📋 Final combined system and user prompt sent to codex: 5 lines, ${text.length} characters, delivered via stdin from file /tmp/p.txt`);
  assert.equal(lines[1], '---BEGIN COMBINED PROMPT---');
  assert.equal(lines.at(-1), '---END COMBINED PROMPT---');
  assert.equal(lines.slice(2, -1).join('\n'), text.replace(/\n$/, ''), 'the prompt body is printed verbatim, line by line');

  assert.match(formatPromptLogBlock({ kind: 'user', text: 'x' }), /^📋 Final user prompt sent to AI tool: 1 lines, 1 characters\n---BEGIN USER PROMPT---\nx\n---END USER PROMPT---$/);
  assert.match(formatPromptLogBlock({ kind: 'system', text: 'x' }), /---BEGIN SYSTEM PROMPT---/);
  assert.match(formatPromptLogBlock({ kind: 'live', text: 'x' }), /---BEGIN LIVE INPUT PROMPT---/);
  assert.equal(formatPromptLogBlock({ kind: 'user', text: '' }).split('\n').length, 3, 'an empty prompt still shows both markers');
  assert.deepEqual([countPromptLines(''), countPromptLines('a'), countPromptLines('a\n'), countPromptLines('a\nb')], [0, 1, 1, 2]);
});

test('logFinalPrompts logs at the normal level and skips only empty optional prompts', async () => {
  const { calls, log } = captureLog();
  await logFinalPrompts({
    log,
    tool: 'claude',
    prompts: [
      { kind: 'user', text: '', keepEmpty: true },
      { kind: 'system', text: '' },
      { kind: 'system', text: 'System rules.' },
    ],
  });
  assert.equal(calls.length, 2);
  assert.match(calls[0].message, /---BEGIN USER PROMPT---\n---END USER PROMPT---/);
  assert.match(calls[1].message, /---BEGIN SYSTEM PROMPT---\nSystem rules\.\n---END SYSTEM PROMPT---/);
  for (const call of calls) assert.notEqual(call.options.verbose, true, 'prompt blocks must not depend on --verbose');
  await logFinalPrompts({ log: null, prompts: [{ text: 'x' }] }); // no logger: no throw
});

test('live stream-json frames are printed as readable text', async () => {
  const feedback = bidirectionalUtils.formatFeedbackForClaude('Line one\nLine two', { kind: 'metadata' });
  assert.match(extractFrameText(feedback), /\nLine one\nLine two\n/);
  assert.equal(extractFrameText(bidirectionalUtils.buildInitialUserFrame('Hello\nworld')), 'Hello\nworld');
  assert.equal(extractFrameText('not json'), null);
  assert.equal(extractFrameText('{"type":"control"}'), null);

  const { calls, log } = captureLog();
  const handler = createBidirectionalHandler({ owner: 'o', repo: 'r', prNumber: 1, $: async () => ({ stdout: '[]' }), log, verbose: false, toolLabel: 'Claude' });
  const written = [];
  handler.attachToolStdin({ write: chunk => written.push(chunk) });

  assert.equal(await handler.streamInitialPrompt('Initial prompt'), true);
  assert.equal(calls.filter(call => call.message.includes('LIVE INPUT PROMPT')).length, 0, 'the runner already logs the initial prompt');

  assert.equal(await handler.sendFeedback('CI is green now.\nPlease continue.'), true);
  const live = calls.filter(call => call.message.includes('---BEGIN LIVE INPUT PROMPT---'));
  assert.equal(live.length, 1);
  assert.match(live[0].message, /^📋 Final live input prompt sent to Claude: .*delivered via a stream-json frame on Claude stdin/);
  assert.match(live[0].message, /\nCI is green now\.\nPlease continue\.\n/);
  assert.notEqual(live[0].options.verbose, true);
  assert.equal(written.length, 2, 'logging does not change what is written to stdin');
});

test('the organize classifier logs the exact prompts each tool receives', async () => {
  const prompts = { system: 'Return a plan.\nUse JSON.', user: 'Organize these issues.\nThere are two.' };
  const run = async () => ({ code: 0, stdout: '{"issues":[]}', stderr: '' });

  const claude = captureLog();
  await runOrganizationClassifier({ prompts, tool: 'claude', run, log: claude.log });
  assert.match(claude.text(), /Final user prompt sent to claude \(organize\).*delivered via stdin\n---BEGIN USER PROMPT---\nOrganize these issues\.\nThere are two\.\n---END USER PROMPT---/);
  assert.match(claude.text(), /Final system prompt sent to claude \(organize\).*system-prompt\.txt\n---BEGIN SYSTEM PROMPT---\nReturn a plan\.\nUse JSON\.\n---END SYSTEM PROMPT---/);

  const codex = captureLog();
  await runOrganizationClassifier({ prompts, tool: 'codex', model: 'gpt-6-sol', run, log: codex.log });
  assert.match(codex.text(), /---BEGIN COMBINED PROMPT---\n<TRUSTED_SYSTEM_INSTRUCTIONS>\nReturn a plan\.\nUse JSON\.\n<\/TRUSTED_SYSTEM_INSTRUCTIONS>\nOrganize these issues\.\nThere are two\.\n---END COMBINED PROMPT---/);

  await runOrganizationClassifier({ prompts, tool: 'claude', run }); // log stays optional
});

test('every AI tool call site prints its final prompts without a verbose gate', () => {
  const callSites = {
    'src/claude.lib.mjs': 1,
    'src/codex.lib.mjs': 1,
    'src/agent.lib.mjs': 1,
    'src/opencode.lib.mjs': 1,
    'src/gemini.lib.mjs': 1,
    'src/qwen.lib.mjs': 1,
    'src/agent-commander.lib.mjs': 1,
    'src/task.mjs': 1,
    'src/organize.ai.lib.mjs': 1,
    'src/bidirectional-interactive.lib.mjs': 1,
  };
  for (const [file, minimum] of Object.entries(callSites)) {
    const text = source(file);
    assert.match(text, /import \{[^}]*logFinalPrompts[^}]*\} from '\.\/prompt-log\.lib\.mjs'/, `${file} imports logFinalPrompts`);
    const calls = text.match(/await logFinalPrompts\(\{[\s\S]*?\}\);/g) || [];
    assert.ok(calls.length >= minimum, `${file} calls logFinalPrompts`);
    for (const call of calls) assert.doesNotMatch(call, /verbose/, `${file}: prompt logging must not be verbose-only`);
    assert.doesNotMatch(text, /if \(argv\.dryRun\) \{\s*await log\('\\n📋 User prompt content:'/, `${file}: the old dry-run-only dump is gone`);
  }
  assert.equal((source('src/bidirectional-interactive.lib.mjs').match(/await logLiveFrame\(/g) || []).length, 3, 'stream, queue flush and feedback frames are all printed');
});

test('solve prompts of every tool are multi-line plain text without markdown', async () => {
  const params = {
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    issueUrl: 'https://github.com/owner/repo/issues/1',
    prNumber: 2,
    prUrl: 'https://github.com/owner/repo/pull/2',
    branchName: 'issue-1-abc',
    tempDir: '/tmp/work',
    workspaceTmpDir: '/tmp/work-tmp',
    isContinueMode: true,
    forkedRepo: null,
    modelSupportsVision: true,
    feedbackLines: ['New comments detected:', '  - someone: "please fix"'],
  };
  const markdown = [
    [/^#{1,6} /m, 'heading'],
    [/\*\*[^*\n]+\*\*/, 'bold'],
    [/\[[^\]\n]+\]\([^)\n]+\)/, 'link'],
    [/^\s*\|.*\|\s*$/m, 'table'],
  ];
  for (const tool of ['claude', 'codex', 'agent', 'opencode', 'gemini', 'qwen']) {
    const prompts = await import(`../src/${tool}.prompts.lib.mjs`);
    const argv = { tool, model: 'test-model', verbose: false };
    for (const [kind, build] of [
      ['user', prompts.buildUserPrompt],
      ['system', prompts.buildSystemPrompt],
    ]) {
      const text = build({ ...params, argv });
      assert.ok(countPromptLines(text) >= 5, `${tool} ${kind} prompt is multi-line`);
      for (const [pattern, name] of markdown) assert.doesNotMatch(text, pattern, `${tool} ${kind} prompt has no markdown ${name}`);
    }
  }
});

test('organize prompts carry indented JSON instead of one long line', () => {
  const repository = { fullName: 'o/r', url: 'https://github.com/o/r', description: 'd', readme: '' };
  const issues = [
    { number: 1, title: 'First', body: 'B', labels: [] },
    { number: 2, title: 'Second', body: 'B', labels: [{ name: 'bug' }] },
  ];
  const { user } = buildOrganizationPrompts({ repository, issueTypes: [{ name: 'Bug' }], labels: [{ name: 'bug' }], issues });
  const longest = Math.max(...user.split('\n').map(line => line.length));
  assert.ok(longest < 120, `no long single line in the organize prompt (longest ${longest})`);
  const issuesJson = user.split('<UNTRUSTED_ISSUES>\n')[1].split('\n</UNTRUSTED_ISSUES>')[0];
  assert.deepEqual(JSON.parse(issuesJson), issues, 'the issues payload is still valid JSON');

  const big = Array.from({ length: 20 }, (_, index) => ({ number: index + 1, title: `Issue ${index + 1}`, body: 'x'.repeat(200), labels: [] }));
  const maxCharacters = 2000;
  for (const chunk of chunkOrganizationIssues({ repository, issueTypes: [], labels: [], issues: big, maxCharacters })) {
    if (chunk.issues.length < 2) continue;
    assert.ok(JSON.stringify(chunk.issues, null, 2).length <= maxCharacters, 'chunk limits measure the formatted JSON that is actually sent');
  }
});
