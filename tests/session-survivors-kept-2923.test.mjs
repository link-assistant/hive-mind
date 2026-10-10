#!/usr/bin/env node
/**
 * Regression coverage for issue #2923: Formal AI Draft run 37959364207 warned
 *
 *   ⚠️  1 process(es) still running in /tmp/gh-issue-solver-1791563735645 after the session ended:
 *      pid 1833: formal-ai serve --agent-mode --host 127.0.0.1 --port 42375
 *
 * That server is Hive Mind's own task-owned Formal AI runtime: it is cached for
 * the next session (restart iterations, verification) and stopped when Hive Mind
 * exits (exit-handler.lib.mjs → stopFormalAiRuntimes). Reporting it as a leftover
 * was a false positive that hides real leftovers (issue #2395).
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2923
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { keepProcessAcrossSessions, logProcessesSurvivingSession, releaseKeptProcess } from '../src/session-survivors.lib.mjs';

const TEMP_DIR = '/tmp/gh-issue-solver-1791563735645';
const FORMAL_AI_SERVER = { pid: 1833, cwd: TEMP_DIR, command: 'formal-ai serve --agent-mode --host 127.0.0.1 --port 42375' };
const LEFTOVER = { pid: 4242, cwd: TEMP_DIR, command: 'sleep 30' };

const collect = () => {
  const messages = [];
  return { messages, log: async (message, options = {}) => messages.push({ message, options }) };
};

test('a server Hive Mind keeps on purpose is not reported as a leftover', async () => {
  const { messages, log } = collect();
  keepProcessAcrossSessions(FORMAL_AI_SERVER.pid, 'task-owned Formal AI server, stopped when Hive Mind exits');
  try {
    const survivors = await logProcessesSurvivingSession({ tempDir: TEMP_DIR, argv: { verbose: true }, log, find: async () => [FORMAL_AI_SERVER] });
    assert.deepEqual(survivors, []);
    assert.equal(
      messages.some(({ options }) => options.level === 'warning'),
      false,
      JSON.stringify(messages)
    );
    assert.match(messages[0].message, /pid 1833 .*kept on purpose.*task-owned Formal AI server/);
    assert.equal(messages[0].options.verbose, true);
  } finally {
    releaseKeptProcess(FORMAL_AI_SERVER.pid);
  }
});

test('real leftovers next to a kept server are still warned about', async () => {
  const { messages, log } = collect();
  keepProcessAcrossSessions(FORMAL_AI_SERVER.pid, 'task-owned Formal AI server, stopped when Hive Mind exits');
  try {
    const survivors = await logProcessesSurvivingSession({ tempDir: TEMP_DIR, argv: { verbose: true }, log, find: async () => [FORMAL_AI_SERVER, LEFTOVER] });
    assert.deepEqual(survivors, [LEFTOVER]);
    const warnings = messages.filter(({ options }) => options.level === 'warning').map(({ message }) => message);
    assert.match(warnings[0], /1 process\(es\) still running/);
    assert.match(warnings[1], /pid 4242: sleep 30/);
  } finally {
    releaseKeptProcess(FORMAL_AI_SERVER.pid);
  }
});

test('a released server is reported again', async () => {
  keepProcessAcrossSessions(FORMAL_AI_SERVER.pid, 'task-owned Formal AI server, stopped when Hive Mind exits');
  releaseKeptProcess(FORMAL_AI_SERVER.pid);
  const { messages, log } = collect();
  const survivors = await logProcessesSurvivingSession({ tempDir: TEMP_DIR, argv: { verbose: true }, log, find: async () => [FORMAL_AI_SERVER] });
  assert.deepEqual(survivors, [FORMAL_AI_SERVER]);
  assert.equal(messages[0].options.level, 'warning');
});

test('the Formal AI runtime marks the server it starts and releases it when it stops it', async () => {
  const source = await readFile(new URL('../src/formal-ai-runtime.lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /keepProcessAcrossSessions\(server\.pid,/);
  assert.match(source, /releaseKeptProcess\(server\?\.pid\)/);
});
