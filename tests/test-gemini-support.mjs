#!/usr/bin/env node

/**
 * Gemini direct tool support tests.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSystemPrompt, buildUserPrompt } from '../src/gemini.prompts.lib.mjs';
import { executeGeminiCommand, parseGeminiJsonOutput } from '../src/gemini.lib.mjs';
import { buildModelOptionDescription, defaultModels, getToolDisplayName, primaryModelNames, resolveModelId, validateModelName } from '../src/models/index.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    testsFailed++;
  }
}

function renderTaggedTemplateCommand(strings, values) {
  return strings.reduce((result, segment, index) => {
    const value = index < values.length ? String(values[index]) : '';
    return result + segment + value;
  }, '');
}

test('Gemini model defaults and aliases are centralized', () => {
  assert.equal(defaultModels.gemini, 'flash');
  assert.deepEqual(primaryModelNames.gemini, ['flash', 'pro', 'flash-lite', 'auto']);
  assert.equal(resolveModelId('flash', 'gemini'), 'gemini-2.5-flash');
  assert.equal(resolveModelId('pro', 'gemini'), 'gemini-2.5-pro');
  assert.equal(resolveModelId('flash-lite', 'gemini'), 'gemini-2.5-flash-lite');
  assert.equal(validateModelName('gemini-2.5-pro', 'gemini').valid, true);
  assert.equal(getToolDisplayName('gemini'), 'Google Gemini CLI');
  assert.ok(buildModelOptionDescription().includes('for gemini: flash, pro, flash-lite, auto'));
});

test('Gemini prompts include workspace context and case-study guidance', () => {
  const userPrompt = buildUserPrompt({
    issueUrl: 'https://github.com/link-assistant/hive-mind/issues/516',
    issueNumber: 516,
    prNumber: 559,
    prUrl: 'https://github.com/link-assistant/hive-mind/pull/559',
    branchName: 'issue-516-54126055',
    tempDir: '/tmp/work',
    workspaceTmpDir: '/tmp/work-tmp',
    isContinueMode: false,
    owner: 'link-assistant',
    repo: 'hive-mind',
    argv: {},
  });

  assert.ok(userPrompt.includes('Your prepared tmp directory for logs and downloads: /tmp/work-tmp'));
  assert.ok(userPrompt.endsWith('\n'));

  const systemPrompt = buildSystemPrompt({
    owner: 'link-assistant',
    repo: 'hive-mind',
    issueNumber: 516,
    prNumber: 559,
    branchName: 'issue-516-54126055',
    workspaceTmpDir: '/tmp/work-tmp',
    argv: {
      promptCaseStudies: true,
      promptPlaywrightMcp: true,
      promptCheckSiblingPullRequests: true,
    },
  });

  assert.ok(systemPrompt.includes('Google Gemini CLI'));
  assert.ok(systemPrompt.includes('./docs/case-studies/issue-516/'));
  assert.ok(systemPrompt.includes('Playwright MCP usage'));
});

test('parseGeminiJsonOutput extracts session, messages, tools, result, and usage', () => {
  const output = ['{"type":"init","sessionId":"gemini-session","model":"gemini-2.5-flash"}', '{"type":"message","content":"working"}', '{"type":"tool_use","toolCall":{"name":"write_file"}}', '{"type":"result","response":"completed","stats":{"models":{"gemini-2.5-flash":{"tokens":{"input":12,"output":3,"total":15}}}}}'].join('\n');

  const parsed = parseGeminiJsonOutput(output, {}, 'gemini-2.5-flash');
  assert.equal(parsed.sessionId, 'gemini-session');
  assert.equal(parsed.messageCount, 2);
  assert.equal(parsed.toolUseCount, 1);
  assert.equal(parsed.resultSummary, 'completed');
  assert.equal(parsed.resultModelUsage['gemini-2.5-flash'].inputTokens, 12);
  assert.equal(parsed.resultModelUsage['gemini-2.5-flash'].outputTokens, 3);

  const prettyJson = JSON.stringify(
    {
      session_id: 'gemini-json-session',
      response: 'json completed',
      stats: {
        models: {
          'gemini-2.5-flash': {
            tokens: {
              input: 9,
              output: 4,
              total: 13,
            },
          },
        },
      },
    },
    null,
    2
  );
  const parsedPrettyJson = parseGeminiJsonOutput(prettyJson, {}, 'gemini-2.5-flash');
  assert.equal(parsedPrettyJson.sessionId, 'gemini-json-session');
  assert.equal(parsedPrettyJson.resultSummary, 'json completed');
  assert.equal(parsedPrettyJson.resultModelUsage['gemini-2.5-flash'].inputTokens, 9);

  let chunkedState = parseGeminiJsonOutput('{"type":"message","content":"split', {}, 'gemini-2.5-flash');
  assert.equal(chunkedState.messageCount, 0);
  chunkedState = parseGeminiJsonOutput(' message"}\n{"type":"result","response":"done"}\n', chunkedState, 'gemini-2.5-flash');
  assert.equal(chunkedState.messageCount, 2);
  assert.equal(chunkedState.resultSummary, 'done');
});

await asyncTest('executeGeminiCommand uses structured headless stream-json invocation', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-support-test-'));
  const logs = [];
  let captured = null;

  const fakeDollar =
    options =>
    (strings, ...values) => {
      captured = {
        options,
        command: renderTaggedTemplateCommand(strings, values),
      };
      return {
        stream: async function* stream() {
          yield {
            type: 'stdout',
            data: Buffer.from(['{"type":"init","sessionId":"gemini-session","model":"gemini-2.5-flash"}', '{"type":"message","content":"done"}', '{"type":"result","response":"completed","stats":{"models":{"gemini-2.5-flash":{"tokens":{"input":5,"output":2,"total":7}}}}}'].join('\n') + '\n'),
          };
          yield { type: 'exit', code: 0 };
        },
      };
    };

  const result = await executeGeminiCommand({
    tempDir,
    branchName: 'issue-516-54126055',
    prompt: 'Proceed.\n',
    systemPrompt: 'System prompt',
    argv: { model: 'flash', verbose: false },
    log: async message => {
      logs.push(String(message));
    },
    formatAligned: (icon, label, value = '') => [icon, label, value].filter(Boolean).join(' '),
    getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: ok', load: '0.1' }),
    geminiPath: 'gemini',
    $: fakeDollar,
  });

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'gemini-session');
  assert.equal(result.resultSummary, 'completed');
  assert.equal(result.resultModelUsage['gemini-2.5-flash'].inputTokens, 5);
  assert.equal(captured.options.cwd, tempDir);
  assert.ok(captured.command.includes('--output-format stream-json'));
  assert.ok(captured.command.includes('--model gemini-2.5-flash'));
  assert.ok(captured.command.includes('--approval-mode yolo'));
  assert.ok(captured.command.includes('--skip-trust'));
  assert.ok(captured.command.includes(`${os.tmpdir()}/gemini_prompt_`));
  assert.ok(logs.some(line => line.includes('Gemini command completed')));
});

console.log(`\nGemini support tests: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
