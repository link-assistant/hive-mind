#!/usr/bin/env node
/**
 * A failed tool call is a tool result the model recovers from, not a run error.
 *
 * `@link-assistant/agent` 0.26.13 followed every failed tool call with a
 * top-level `{"type":"error"}` record carrying the tool part
 * (link-assistant/agent#332). In session 435374e0 (`--model formal-ai`) the model
 * read a file that does not exist, received `File not found`, carried on and
 * finished with `reason: "stop"`; the agent exited 0, and the run was still
 * reported as "AGENT execution failed with Agent reported error: Error: File
 * not found: …/e.g". Agent 0.26.14 reports the failure only on the `tool_use`
 * event. Both stream shapes must leave the run's result to the session itself,
 * while a session or provider error keeps failing it.
 *
 * The streams below are trimmed copies of the recorded records; executeAgentCommand
 * runs for real with the Agent CLI replaced by a stub that replays them.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3213
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { detectAgentErrorsInOutput, executeAgentCommand } from '../src/agent.lib.mjs';
import { isRecoverableAgentToolError } from '../src/agent-error-events.lib.mjs';
import { summarizeAgentCommanderResult } from '../src/agent-commander.lib.mjs';

const SESSION = 'ses_ec8b1d927ffez7CvpMTog8SRq4';
const MISSING = '/tmp/gh-issue-solver-1791929210941/e.g';
const NOT_FOUND = `Error: File not found: ${MISSING}`;

const failedReadPart = {
  id: 'prt_1374e49540014yvgQHvCyLSeel',
  sessionID: SESSION,
  messageID: 'msg_1374e2d22001jPEn7fGO5ZhxhL',
  type: 'tool',
  callID: 'call_ff487384c6d90122',
  tool: 'read',
  state: { status: 'error', input: { filePath: MISSING }, error: NOT_FOUND, time: { start: 1791929239898, end: 1791929239907 } },
};

const records = {
  stepStart: { type: 'step_start', timestamp: 1791929239000, sessionID: SESSION, part: { type: 'step-start' } },
  failedRead: { type: 'tool_use', timestamp: 1791929239909, sessionID: SESSION, part: failedReadPart },
  // agent <= 0.26.13: the same tool part again, as a top-level error record.
  failedReadError: { type: 'error', timestamp: 1791929239909, sessionID: SESSION, part: failedReadPart, message: NOT_FOUND, error: NOT_FOUND },
  toolCallsFinish: { type: 'step_finish', timestamp: 1791929239950, sessionID: SESSION, part: { type: 'step-finish', reason: 'tool-calls', tokens: { input: 20528, output: 95 } } },
  reply: { type: 'text', timestamp: 1791929247500, sessionID: SESSION, part: { type: 'text', text: 'There is no e.g file; continuing with the issue.' } },
  stopFinish: { type: 'step_finish', timestamp: 1791929247565, sessionID: SESSION, part: { type: 'step-finish', reason: 'stop', tokens: { input: 20627, output: 230 } } },
  idle: { type: 'session.idle', sessionID: SESSION },
  providerError: { type: 'error', timestamp: 1791929248000, sessionID: SESSION, error: { name: 'ProviderAuthError', data: { message: 'Formal AI provider rejected the request' } } },
};

const pretty = record => `${JSON.stringify(record, null, 2)}\n`;
const ndjson = list => list.map(record => JSON.stringify(record)).join('\n');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-3213-'));
after(() => fs.rmSync(workspace, { recursive: true, force: true }));

let repoCount = 0;
const makeRepo = () => {
  const repo = path.join(workspace, `repo-${++repoCount}`);
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main'], { cwd: repo });
  return repo;
};

/**
 * Run executeAgentCommand against a stub Agent CLI that writes `stream` the way
 * agent 0.26.13 does (pretty-printed records on stderr) and exits `exitCode`.
 */
const runAgent = async (stream, { exitCode = 0 } = {}) => {
  const logLines = [];
  const $stub = () => () => ({
    stream: async function* replay() {
      for (const record of stream) yield { type: 'stderr', data: Buffer.from(pretty(record)) };
      yield { type: 'exit', code: exitCode };
    },
  });
  const result = await executeAgentCommand({
    tempDir: makeRepo(),
    branchName: 'issue-1',
    prompt: 'Solve issue 1',
    systemPrompt: '',
    argv: { verbose: false, model: 'nemotron-3-super-free', tool: 'agent', attribution: 'none' },
    log: async line => logLines.push(String(line)),
    formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
    getResourceSnapshot: async () => ({ memory: 'Mem:\n  100 MB available', load: '0.00' }),
    forkedRepo: null,
    feedbackLines: [],
    issueNumber: 1,
    prNumber: 2,
    prUrl: 'https://github.com/owner/repo/pull/2',
    agentPath: 'agent',
    $: $stub,
    calculatePricing: async () => ({ totalCostUSD: 0 }),
  });
  return { result, log: logLines.join('\n') };
};

test('the recorded agent 0.26.13 stream (failed read, error record, then a finished turn, exit 0) is a success', async () => {
  const { result, log } = await runAgent([records.stepStart, records.failedRead, records.failedReadError, records.toolCallsFinish, records.reply, records.stopFinish, records.idle]);
  assert.equal(result.success, true, `the run must follow the session result, got ${JSON.stringify(result.errorInfo)}`);
  assert.equal(result.errorInfo, undefined);
  assert.doesNotMatch(log, /Agent reported error|still fails the run|Error event detected/);
  assert.match(log, /Tool call failed.*read.*File not found/, 'the failed tool call is still visible in the log');
});

test('a failed tool call followed only by session.idle and exit 0 is not resurrected by the raw-text fallback', async () => {
  const { result } = await runAgent([records.stepStart, records.failedRead, records.failedReadError, records.reply, records.idle]);
  assert.equal(result.success, true, `got ${JSON.stringify(result.errorInfo)}`);
});

test('the agent 0.26.14 stream (failure only on the tool_use event) is a success', async () => {
  const { result } = await runAgent([records.stepStart, records.failedRead, records.toolCallsFinish, records.reply, records.stopFinish, records.idle]);
  assert.equal(result.success, true);
});

test('a provider error that no completion follows still fails the run, and the reason names it, not the tool error', async () => {
  const { result, log } = await runAgent([records.stepStart, records.failedRead, records.failedReadError, records.toolCallsFinish, records.providerError, records.idle]);
  assert.equal(result.success, false);
  assert.match(result.errorInfo.message, /^Agent reported error: .*Formal AI provider rejected the request/);
  assert.doesNotMatch(result.errorInfo.message, /File not found/);
  assert.match(log, /Error event detected in stream: .*Formal AI provider rejected the request/);
});

test('a non-zero exit after a failed tool call still fails the run', async () => {
  const { result } = await runAgent([records.stepStart, records.failedRead, records.failedReadError], { exitCode: 1 });
  assert.equal(result.success, false);
  assert.doesNotMatch(result.errorInfo.message, /File not found/);
});

test('output scan: tool-part error records are skipped and the reason is the last fatal record', () => {
  assert.deepEqual(detectAgentErrorsInOutput(ndjson([records.failedRead, records.failedReadError, records.reply, records.stopFinish])), { detected: false });

  const firstFatal = { type: 'error', sessionID: SESSION, error: 'The operation timed out.' };
  const detection = detectAgentErrorsInOutput(ndjson([records.failedReadError, firstFatal, records.reply, records.providerError, records.idle]));
  assert.equal(detection.detected, true);
  assert.match(detection.match, /Formal AI provider rejected the request/);
  assert.equal(detection.record.error.name, 'ProviderAuthError');
});

test('classification: only tool-part and explicitly recoverable error records are recoverable', () => {
  assert.equal(isRecoverableAgentToolError(records.failedReadError), true, 'agent <= 0.26.13 tool failure');
  assert.equal(isRecoverableAgentToolError({ type: 'step_error', part: failedReadPart }), true);
  assert.equal(isRecoverableAgentToolError({ type: 'error', recoverable: true, error: 'Tool execution failed' }), true, 'an explicit recoverable marker');
  assert.equal(isRecoverableAgentToolError(records.providerError), false, 'a provider error is fatal');
  assert.equal(isRecoverableAgentToolError({ type: 'error', error: NOT_FOUND }), false, 'an error record without a tool part is not guessed from its text');
  assert.equal(isRecoverableAgentToolError({ type: 'error', part: { ...failedReadPart, state: { status: 'completed' } } }), false, 'a tool part that did not fail proves nothing');
  assert.equal(isRecoverableAgentToolError(records.failedRead), false, 'a tool_use event is not an error record at all');
  assert.equal(isRecoverableAgentToolError(null), false);
});

test('--agent-commander: the same records decide the run the same way', () => {
  const summarize = parsed => summarizeAgentCommanderResult({ tool: 'agent', result: { exitCode: 0, output: { plain: '', parsed } } });
  const recovered = summarize([records.stepStart, records.failedRead, records.failedReadError, records.reply, records.stopFinish]);
  assert.equal(recovered.success, true);
  assert.equal(recovered.errorDuringExecution, false);
  const failed = summarize([records.stepStart, records.failedRead, records.failedReadError, records.providerError]);
  assert.equal(failed.success, false);
  assert.equal(failed.errorDuringExecution, true);
});
