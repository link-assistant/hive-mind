/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import test from 'node:test';
import fsModule from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';
globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fsModule, default: fsModule };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const sessionId = '85671f31-4459-422e-8fef-04ee03fd3aa0';
const userRejection = "The user doesn't want to proceed with this tool use. STOP what you are doing and wait for the user to tell you how to proceed.";
const initialEvents = [
  { type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: 'Waiting for the port agents.' }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'Waiting for the port agents.', subagent_stats: { killed: { system: 5 } } },
  { type: 'system', subtype: 'task_notification', status: 'stopped', task_id: 'agent-1' },
  { type: 'user', parent_tool_use_id: 'toolu_parent', tool_use_result: 'User rejected tool use', message: { content: [{ type: 'tool_result', is_error: true, content: userRejection }] } },
];
const finishedEvents = [{ type: 'result', subtype: 'success', is_error: false, result: 'All five port agents finished and the pull request is ready.' }];

test('Claude print mode resumes incomplete background work without treating shutdown as user rejection', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2301-claude-'));
  const calls = [];
  const logs = [];
  let logFile = path.join(fixture, 'current.log');
  await writeFile(logFile, '');
  const fakeDollar =
    options =>
    (strings, ...values) => {
      const events = calls.length === 0 ? initialEvents : finishedEvents;
      calls.push({ options, command: strings.reduce((value, part, index) => value + part + (index < values.length ? String(values[index]) : ''), '') });
      return {
        pid: 2301 + calls.length,
        result: { code: 0 },
        kill: () => {},
        async *stream() {
          yield { type: 'stdout', data: Buffer.from(`${events.map(event => JSON.stringify(event)).join('\n')}\n`) };
        },
      };
    };
  const argv = { model: 'sonnet', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/2301', verbose: false, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false };
  try {
    const result = await executeClaudeCommand({
      tempDir: fixture,
      branchName: 'issue-2301',
      prompt: 'Finish the issue.',
      systemPrompt: 'Solve it.',
      escapedPrompt: 'Finish the issue.',
      escapedSystemPrompt: 'Solve it.',
      argv,
      log: async message => logs.push(String(message)),
      setLogFile: next => {
        logFile = next;
      },
      getLogFile: () => logFile,
      formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
      getResourceSnapshot: async () => ({ memory: 'MemAvailable: 1 GB', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      claudePath: 'claude',
      $: fakeDollar,
      owner: 'link-assistant',
      repo: 'hive-mind',
      prNumber: 2302,
      issueNumber: 2301,
    });
    assert.equal(calls.length, 2);
    assert.match(calls[1].command, new RegExp(`--resume ${sessionId}`));
    assert.equal(argv.resume, sessionId);
    assert.equal(result.success, true);
    assert.equal(result.resultSummary, finishedEvents[0].result);
    assert.doesNotMatch(result.errorInfo?.message || '', /user doesn't want to proceed/i);
    assert.match(logs.join('\n'), /Resuming Claude session/);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
