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
import { buildGeminiArgs, detectGeminiPlainTextError, executeGeminiCommand, parseGeminiJsonOutput } from '../src/gemini.lib.mjs';
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
    let value = '';
    if (index < values.length) {
      const raw = values[index];
      value = Array.isArray(raw) ? raw.map(String).join(' ') : String(raw);
    }
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

test('Gemini budget usage exposes issue #1741 context fill separately from cache reads', () => {
  const output = '{"type":"result","response":"completed","stats":{"models":{"gemini-2.5-flash":{"tokens":{"input":94,"cacheWrite":61200,"cacheRead":1100000,"output":6600,"total":1161294,"contextLimit":200000,"outputLimit":64000}}}}}';
  const parsed = parseGeminiJsonOutput(output, {}, 'gemini-2.5-flash');
  const usage = parsed.resultModelUsage['gemini-2.5-flash'];

  assert.equal(usage.contextFillInputTokens, 61_294);
  assert.equal(usage.peakContextUsage, 1_161_294);
  assert.equal(usage.cacheReadTokens, 1_100_000);
  assert.deepEqual(usage.modelInfo, { limit: { context: 200_000, output: 64_000 } });
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
  // Issue #1809: the prompt is now piped via command-stream stdin instead of a
  // temp prompt file, so no $TMPDIR/gemini_prompt_ path should appear.
  assert.ok(!captured.command.includes('gemini_prompt_'));
  assert.equal(captured.options.stdin, 'System prompt\n\nProceed.\n');
  assert.ok(logs.some(line => line.includes('Gemini command completed')));
});

test('detectGeminiPlainTextError recognises upstream non-JSONL failures', () => {
  const auth = detectGeminiPlainTextError('Please set an Auth method in your settings');
  assert.equal(auth?.type, 'AuthenticationRequired');

  const quota = detectGeminiPlainTextError('Quota exceeded for requests per minute');
  assert.equal(quota?.type, 'QuotaExceeded');

  const model = detectGeminiPlainTextError('Invalid model name "foo"');
  assert.equal(model?.type, 'InvalidModel');

  const arg = detectGeminiPlainTextError('Unknown argument --foo');
  assert.equal(arg?.type, 'InvalidArgument');

  assert.equal(detectGeminiPlainTextError(''), null);
  assert.equal(detectGeminiPlainTextError('All good here'), null);
});

test('buildGeminiArgs threads verbose/sandbox/include-dirs/extensions/mcp flags', () => {
  const base = buildGeminiArgs({ model: 'flash' }, 'gemini-2.5-flash', {
    tempDir: '/tmp/work',
    workspaceTmpDir: '/tmp/work-tmp',
  });
  assert.deepEqual(base.slice(0, 8), ['--output-format', 'stream-json', '--model', 'gemini-2.5-flash', '--approval-mode', 'yolo', '--skip-trust', '--include-directories']);
  const includeIdx = base.indexOf('--include-directories');
  assert.equal(base[includeIdx + 1], '/tmp/work,/tmp/work-tmp');
  assert.ok(!base.includes('--debug'));
  assert.ok(!base.includes('--sandbox'));

  const verbose = buildGeminiArgs({ model: 'flash', verbose: true }, 'gemini-2.5-flash', { tempDir: '/tmp/work' });
  assert.ok(verbose.includes('--debug'));

  const resumed = buildGeminiArgs({ model: 'flash', resume: 'session-123' }, 'gemini-2.5-flash', { tempDir: '/tmp/work' });
  assert.equal(resumed[0], '--resume');
  assert.equal(resumed[1], 'session-123');

  const fullyLoaded = buildGeminiArgs(
    {
      model: 'pro',
      geminiSandbox: true,
      geminiExtensions: 'ext-a,ext-b',
      geminiAllowedMcpServers: ['mcp-1', 'mcp-2'],
      geminiIncludeDirectories: ['/extra/dir'],
    },
    'gemini-2.5-pro',
    { tempDir: '/tmp/work', workspaceTmpDir: '/tmp/work' }
  );
  assert.ok(fullyLoaded.includes('--sandbox'));
  const incIdx = fullyLoaded.indexOf('--include-directories');
  assert.equal(fullyLoaded[incIdx + 1], '/tmp/work,/extra/dir');
  const extIdx = fullyLoaded.indexOf('--extensions');
  assert.equal(fullyLoaded[extIdx + 1], 'ext-a,ext-b');
  const mcpIdx = fullyLoaded.indexOf('--allowed-mcp-server-names');
  assert.equal(fullyLoaded[mcpIdx + 1], 'mcp-1,mcp-2');
});

await asyncTest('executeGeminiCommand surfaces upstream auth failures even without JSONL events', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-support-test-'));
  const logs = [];

  const fakeDollar = () => () => ({
    stream: async function* stream() {
      yield {
        type: 'stderr',
        data: Buffer.from('Please set an Auth method in your ~/.gemini/settings.json file\n'),
      };
      yield { type: 'exit', code: 41 };
    },
  });

  const result = await executeGeminiCommand({
    tempDir,
    branchName: 'issue-1809-ad1b428698b3',
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
    waitForRetryDelay: async () => {},
  });

  assert.equal(result.success, false);
  assert.ok(logs.some(line => line.includes('Please set an Auth method')));
  assert.ok(logs.some(line => line.includes('AuthenticationRequired')));
});

await asyncTest('executeGeminiCommand reports failure when no JSONL events are emitted', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-support-test-'));
  const logs = [];

  const fakeDollar = () => () => ({
    stream: async function* stream() {
      yield { type: 'exit', code: 0 };
    },
  });

  const result = await executeGeminiCommand({
    tempDir,
    branchName: 'issue-1809-ad1b428698b3',
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
    waitForRetryDelay: async () => {},
  });

  assert.equal(result.success, false);
  assert.equal(result.messageCount, 0);
  assert.equal(result.toolUseCount, 0);
});

await asyncTest('executeGeminiCommand passes --debug when verbose is enabled', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-support-test-'));
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
            data: Buffer.from('{"type":"result","response":"completed"}\n'),
          };
          yield { type: 'exit', code: 0 };
        },
      };
    };

  await executeGeminiCommand({
    tempDir,
    workspaceTmpDir: '/tmp/work-tmp',
    branchName: 'issue-1809-ad1b428698b3',
    prompt: 'Proceed.\n',
    systemPrompt: 'System prompt',
    argv: { model: 'flash', verbose: true },
    log: async () => {},
    formatAligned: (icon, label, value = '') => [icon, label, value].filter(Boolean).join(' '),
    getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: ok', load: '0.1' }),
    geminiPath: 'gemini',
    $: fakeDollar,
  });

  assert.ok(captured.command.includes('--debug'));
  assert.ok(captured.command.includes('--include-directories'));
  assert.ok(captured.command.includes(`${tempDir},/tmp/work-tmp`));
});

console.log(`\nGemini support tests: ${testsPassed} passed, ${testsFailed} failed`);
process.exit(testsFailed > 0 ? 1 : 0);
