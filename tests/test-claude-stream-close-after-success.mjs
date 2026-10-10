#!/usr/bin/env node

/**
 * A successful Claude session killed by the stream close timeout is still a
 * success (found while recovering PR #2824 for issue #2823).
 *
 * The PR #2824 session log ended with:
 *
 *   "is_error": false, "subtype": "success", "result": "I fixed the four `/queue` problems …"
 *   📌 Result event received, starting 30s stream close timeout (Issue #1280)
 *   ⚠️ Stream timeout — sending SIGTERM for graceful shutdown (Issue #1280, #1510, #1516)
 *   ⚠️ Stream exited via force-kill timeout
 *   ❌ Claude command failed with exit code 143
 *
 * and the PR was moved back to draft with "CLAUDE execution failed with <summary>".
 * command-stream 1.x/2.x yields the kill as an `exit` chunk with code 143
 * (experiments/issue-2823/command-stream-exit-after-sigterm.mjs), and the
 * exit-chunk handler marked every non-zero exit as a failure.
 */

import assert from 'node:assert/strict';
import fsModule from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStreamCloseSignalAfterSuccess } from '../src/claude.stream-events.lib.mjs';

// Same harness as tests/issue-2301-claude-execution.test.mjs: a 1s stream
// close timeout and a fake command-stream `$`.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✅ PASS: ${name}`);
};

console.log('\n🧪 isStreamCloseSignalAfterSuccess');

await check('SIGTERM (143) from the stream close timeout after a success result is not a failure', () => {
  assert.equal(isStreamCloseSignalAfterSuccess({ exitCode: 143, streamCloseForced: true, resultSuccessReceived: true }), true);
});
await check('SIGKILL (137) follow-up after a success result is not a failure', () => {
  assert.equal(isStreamCloseSignalAfterSuccess({ exitCode: 137, streamCloseForced: true, resultSuccessReceived: true }), true);
});
await check('a kill after an error result stays a failure', () => {
  assert.equal(isStreamCloseSignalAfterSuccess({ exitCode: 143, streamCloseForced: true, resultSuccessReceived: false }), false);
});
await check('a kill for another reason (startup/activity timeout, tool-call loop, base-branch stop) stays a failure', () => {
  assert.equal(isStreamCloseSignalAfterSuccess({ exitCode: 143, streamCloseForced: false, resultSuccessReceived: true }), false);
});
await check('a real CLI error code after the stream close stays a failure', () => {
  assert.equal(isStreamCloseSignalAfterSuccess({ exitCode: 1, streamCloseForced: true, resultSuccessReceived: true }), false);
});
await check('exit 0 and a missing exit code are not signal exits', () => {
  assert.equal(isStreamCloseSignalAfterSuccess({ exitCode: 0, streamCloseForced: true, resultSuccessReceived: true }), false);
  assert.equal(isStreamCloseSignalAfterSuccess({ exitCode: null, streamCloseForced: true, resultSuccessReceived: true }), false);
});

console.log('\n🧪 claude.lib.mjs wiring');
const source = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf8');

await check('only the stream close timeout sets streamCloseForced, and only when nothing else forced the exit first', () => {
  assert.match(source, /resultTimeoutId = setTimeout\(\(\) => \{\s*if \(!forceExitTriggered\) streamCloseForced = true;\s*return forceExitOnTimeout\(\);/);
  assert.equal(source.match(/streamCloseForced = true/g)?.length, 1);
});
await check('the exit chunk handler checks the stream-close guard before marking the command failed', () => {
  const exitBranch = source.slice(source.indexOf("chunk.type === 'exit'"), source.indexOf("chunk.type === 'exit'") + 700);
  assert.ok(exitBranch.indexOf('isStreamCloseSignalAfterSuccess') !== -1, 'guard is used in the exit chunk branch');
  assert.ok(exitBranch.indexOf('isStreamCloseSignalAfterSuccess') < exitBranch.indexOf('commandFailed = true'), 'guard runs before commandFailed is set');
  assert.match(exitBranch, /exitCode = 0;/);
});
await check('the command result exit code does not overwrite exit 0 with the stream-close signal', () => {
  assert.match(source, /if \(exitCode === 0 && resultExitCode !== 0 && !isStreamCloseSignalAfterSuccess\(\{ exitCode: resultExitCode, streamCloseForced, resultSuccessReceived \}\)\)/);
});

console.log('\n🧪 executeClaudeCommand with a CLI that stays alive after its result');
const sessionId = 'c9b8081e-ce99-4edc-854a-ed727ed5f3a9';
/**
 * Run executeClaudeCommand against a fake CLI that prints `events` and then
 * hangs until killed, like the PR #2824 session. The kill ends the stream with
 * an `exit` chunk carrying 128 + signal, as command-stream 2.0.0 does.
 */
const runHangingClaude = async events => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-stream-close-'));
  const logs = [];
  const kills = [];
  let logFile = path.join(fixture, 'current.log');
  await writeFile(logFile, '');
  const fakeDollar = () => () => {
    let onKill;
    const killed = new Promise(resolve => (onKill = resolve));
    const command = {
      result: { code: 0 },
      kill: signal => {
        kills.push(signal);
        command.result = { code: signal === 'SIGKILL' ? 137 : 143 };
        onKill(command.result.code);
      },
      async *stream() {
        yield { type: 'stdout', data: Buffer.from(`${events.map(event => JSON.stringify(event)).join('\n')}\n`) };
        yield { type: 'exit', code: await killed };
      },
    };
    return command;
  };
  const argv = { model: 'opus', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/2823', verbose: true, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false };
  try {
    const result = await executeClaudeCommand({
      tempDir: fixture,
      branchName: 'issue-2823',
      prompt: 'Continue.',
      systemPrompt: 'Solve it.',
      escapedPrompt: 'Continue.',
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
      prNumber: 2824,
      issueNumber: 2823,
    });
    return { result, logs: logs.join('\n'), kills };
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
};

await check('a success result followed by the stream-close SIGTERM (exit 143) is reported as success', async () => {
  const summary = 'I fixed the four `/queue` problems from the issue and log.';
  const { result, logs, kills } = await runHangingClaude([
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'assistant', session_id: sessionId, message: { content: [{ type: 'text', text: summary }] } },
    { type: 'result', subtype: 'success', is_error: false, session_id: sessionId, result: summary },
  ]);
  assert.deepEqual(kills, ['SIGTERM']);
  assert.match(logs, /Stream timeout — sending SIGTERM/);
  assert.doesNotMatch(logs, /Claude command failed with exit code 143/);
  assert.equal(result.success, true, `expected success, got ${JSON.stringify(result.errorInfo)}`);
  assert.equal(result.resultSummary, summary);
});

await check('an error result followed by the stream-close SIGTERM is still a failure', async () => {
  const { result, kills } = await runHangingClaude([
    { type: 'system', subtype: 'init', session_id: sessionId },
    { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId, result: 'Something broke' },
  ]);
  assert.deepEqual(kills, ['SIGTERM']);
  assert.equal(result.success, false);
});

console.log(`\nResults: ${passed} passed, 0 failed`);
