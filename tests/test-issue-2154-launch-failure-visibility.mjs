#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2154, symptoms 2 and 3: three Formal AI tasks failed to launch and
 *
 *   - "in logs of telegram bot there [is] nothing about it";
 *   - there is "no way to see UUIDs of each task's log";
 *   - "these tasks are not in list".
 *
 * All three come from the same launch path staying silent. The session UUID is
 * generated *before* the launch (issue #1946) and shown in the "🔄 Starting..."
 * message, but a failure overwrote that message with a bare error dump, dropped
 * the tracking, and wrote nothing to stdout/stderr. The attempt then existed
 * nowhere: not in Telegram (no UUID), not in the bot log (no line), and not in
 * `$ --list` (no container was ever created).
 *
 * This test pins the three guarantees that fix that:
 *
 *   1. every unsuccessful launch is logged with its session UUID and reason,
 *      at each of the three layers that can refuse one (the sidecar gate, the
 *      isolation runner, the Telegram command handler);
 *   2. the Telegram failure reply keeps the UUID;
 *   3. the reply says the session was never launched, which is why it has no
 *      log and is absent from `--list`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 * @see https://github.com/link-assistant/hive-mind/issues/1946
 */

import assert from 'assert/strict';

import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { acquireFormalAiSidecarForTask } from '../src/formal-ai-isolation.lib.mjs';
import { executeWithIsolation } from '../src/isolation-runner.lib.mjs';
import { formatFailedLaunchMessage, formatStartingWorkSessionMessage } from '../src/work-session-formatting.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

const SESSION = '08ec853a-158a-4314-83e9-c6365670fe4c';
/** The production failure, verbatim from the issue report. */
const SIDECAR_ERROR = "Formal AI sidecar could not be started, so the task was not launched (issue #2146): Command failed: docker run --detach --name hive-mind-formal-ai …\nUnable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally";

/** Capture console.error while `fn` runs; the bot log is exactly this stream. */
async function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    const value = await fn();
    return { lines, value };
  } finally {
    console.error = original;
  }
}

// --- 1. The reply keeps the UUID and explains the missing session ------------

await test('failure reply carries the session UUID, the backend, the error and the "not launched" note', () => {
  const message = formatFailedLaunchMessage({
    commandName: 'solve',
    sessionName: SESSION,
    isolationBackend: 'docker',
    infoBlock: 'Issue: https://github.com/o/r/issues/1',
    error: SIDECAR_ERROR,
  });

  assert.ok(message.includes('Error executing solve command'), 'keeps the existing header');
  assert.ok(message.includes(`\`${SESSION}\``), 'the session UUID survives the edit that replaces the starting message');
  assert.ok(/Isolation: `docker`/.test(message), 'names the isolation backend');
  assert.ok(message.includes('ghcr.io/link-assistant/formal-ai:0.339.1'), 'keeps the underlying error');
  assert.ok(/not launched/i.test(message) && message.includes('--list'), 'explains why the session is absent from --list');
  assert.ok(message.includes('Issue: https://github.com/o/r/issues/1'), 'keeps the info block');
});

await test('failure reply omits the session block when no session was ever generated', () => {
  const message = formatFailedLaunchMessage({ commandName: 'hive', error: 'boom' });
  assert.ok(!message.includes('Session:'), 'no Session line without a UUID');
  assert.ok(!message.includes('Isolation:'), 'no Isolation line without a backend');
  assert.ok(!message.includes('--list'), 'no --list note when there is no session to look for');
  assert.ok(message.includes('boom'), 'still reports the error');
});

await test('failure reply never renders an empty code fence', () => {
  const message = formatFailedLaunchMessage({ commandName: 'solve', sessionName: SESSION, error: '' });
  assert.ok(message.includes('unknown error'), 'a missing error text is named rather than shown as a blank block');
  assert.ok(!/```\n\n```/.test(message), 'no empty fenced block');
});

// --- 2. The sidecar gate records its refusal --------------------------------

await test('acquireFormalAiSidecarForTask logs the refusal with the session UUID', async () => {
  const { lines, value } = await captureErrors(() =>
    acquireFormalAiSidecarForTask({
      backend: 'docker',
      args: ['--model', 'formal-ai'],
      model: 'formal-ai',
      sessionId: SESSION,
      env: { HIVE_MIND_FORMAL_AI_SIDECAR: '1' },
      acquire: async () => {
        throw new Error("Unable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally");
      },
    })
  );

  assert.equal(value.sidecar, null, 'fails closed — no sidecar');
  assert.ok(value.error, 'returns the reason to the caller');
  const logged = lines.find(line => line.includes(SESSION));
  assert.ok(logged, 'the bot log gets a line naming the session UUID');
  assert.ok(logged.includes('formal-ai:0.339.1'), 'the logged line carries the registry error');
});

// --- 3. The isolation runner records its refusal ----------------------------

await test('executeWithIsolation logs a refused launch with the session UUID', async () => {
  const { lines, value } = await captureErrors(() => executeWithIsolation('solve', ['https://github.com/o/r/issues/1'], { backend: 'not-a-backend', sessionId: SESSION, tool: 'codex', model: 'formal-ai' }));

  assert.equal(value.success, false, 'the launch is refused');
  assert.equal(value.sessionId, SESSION, 'the result still names the session');
  const logged = lines.find(line => line.includes(SESSION));
  assert.ok(logged, 'the bot log gets a line naming the session UUID');
  assert.ok(logged.includes('not-a-backend'), 'the logged line carries the reason');
  assert.ok(logged.includes('codex') && logged.includes('formal-ai'), 'the logged line names the tool and model, so the failing combination is identifiable');
});

// --- 4. End to end through the Telegram command handler ---------------------

function makeHarness(launchResult) {
  const edits = [];
  const untracked = [];
  const ctx = {
    from: { id: 7 },
    chat: { id: 42 },
    telegram: {
      editMessageText: async (_chatId, _msgId, _inline, text) => {
        edits.push(text);
      },
    },
  };
  const deps = {
    resolveIsolation: async () => ({
      backend: 'docker',
      runner: {
        generateSessionId: () => SESSION,
        executeWithIsolation: async () => launchResult,
      },
    }),
    ISOLATION_BACKEND: 'docker',
    isolationRunner: {},
    VERBOSE: false,
    executeStartScreen: async () => ({ success: false, error: 'unused' }),
    trackSession: () => {},
    untrackSession: name => untracked.push(name),
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot: {},
    formatExecutingWorkSessionMessage: ({ sessionName }) => `EXECUTING ${sessionName}`,
    formatStartingWorkSessionMessage,
  };
  return { ctx, startingMessage: { chat: { id: 42 }, message_id: 100 }, run: buildExecuteAndUpdateMessage(deps), edits, untracked };
}

await test('a Formal AI launch failure reaches both the bot log and the Telegram reply, with its UUID', async () => {
  const harness = makeHarness({ success: false, sessionId: SESSION, output: '', error: SIDECAR_ERROR });

  const { lines } = await captureErrors(() => harness.run(harness.ctx, harness.startingMessage, 'solve', ['https://github.com/o/r/issues/1'], 'Issue: https://github.com/o/r/issues/1', 'docker', 'codex'));

  // The bot log — the thing that was empty in the incident.
  const logged = lines.find(line => line.includes(SESSION));
  assert.ok(logged, 'the failure is on the record in the bot log');
  assert.ok(logged.includes('formal-ai:0.339.1'), 'the logged line carries the root error');
  assert.ok(logged.includes('solve') && logged.includes('codex'), 'the logged line names the command and tool');

  // The Telegram reply — the thing the user actually saw.
  const finalEdit = harness.edits.at(-1);
  assert.ok(finalEdit.includes(`\`${SESSION}\``), 'the final reply still shows the UUID that the starting message introduced');
  assert.ok(finalEdit.includes('ghcr.io/link-assistant/formal-ai:0.339.1'), 'the final reply keeps the error');
  assert.ok(/not launched/i.test(finalEdit) && finalEdit.includes('--list'), 'the final reply explains the absence from --list');

  // And the phantom session is still dropped (issue #1946 behaviour preserved).
  assert.deepEqual(harness.untracked, [SESSION], 'the untracked session is unchanged');
});

await test('a successful launch is neither logged as a failure nor altered', async () => {
  const harness = makeHarness({ success: true, sessionId: SESSION, output: 'ok' });

  const { lines } = await captureErrors(() => harness.run(harness.ctx, harness.startingMessage, 'solve', ['https://github.com/o/r/issues/1'], 'Issue: x', 'docker'));

  assert.equal(lines.length, 0, 'no error lines for a healthy launch');
  assert.equal(harness.edits.at(-1), `EXECUTING ${SESSION}`, 'the executing message is unchanged');
  assert.deepEqual(harness.untracked, [], 'a successful launch is never untracked');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
