#!/usr/bin/env node
/**
 * Issue #3530: "we produce UUID for the task once, and reuse it in multiple
 * system, so single task/issue/AI session means the same in all layers".
 *
 * start-command session = execution = container = the task UUID, and the first
 * fresh Claude Code session of the task is started with `--session-id <uuid>`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildDockerIsolationStartArgs, buildStartCommandArgs, ownsTaskSessionId } from '../src/isolation-runner.lib.mjs';
import { TASK_SESSION_ID_ENV, createClaudeTaskSessionIdClaimer, resolveTaskSessionId } from '../src/task-session-id.lib.mjs';

const TASK = 'a84a2357-3530-4c1a-9b0d-2f9a7c3b9b51';
const ISSUE_URL = 'https://github.com/example/repo/issues/1';

test('only a solve launch owns the task id (hive runs many solves)', () => {
  assert.equal(ownsTaskSessionId('solve', TASK), true);
  assert.equal(ownsTaskSessionId('/usr/local/bin/solve', TASK), true);
  assert.equal(ownsTaskSessionId('hive', TASK), false);
  assert.equal(ownsTaskSessionId('solve', ''), false);
});

test('screen/tmux launches pass the task id to the command', async () => {
  const args = await buildStartCommandArgs('solve', [ISSUE_URL], { backend: 'tmux', sessionId: TASK });
  assert.deepEqual(args.slice(0, 7), ['--isolated', 'tmux', '--detached', '--session', TASK, '--session-id', TASK]);
  assert.equal(args.at(-1), `${TASK_SESSION_ID_ENV}='${TASK}' 'solve' '${ISSUE_URL}'`);
  const hive = await buildStartCommandArgs('hive', [ISSUE_URL], { backend: 'tmux', sessionId: TASK });
  assert.equal(hive.at(-1), `'hive' '${ISSUE_URL}'`);
});

test('docker launches pass the task id into the container', async () => {
  const args = await buildDockerIsolationStartArgs('solve', [ISSUE_URL], { sessionId: TASK, env: {}, homeDir: '/home/box', existsSync: () => false });
  assert.ok(args.includes(`${TASK_SESSION_ID_ENV}=${TASK}`));
  assert.deepEqual(args.slice(args.indexOf('--session'), args.indexOf('--session') + 4), ['--session', TASK, '--session-id', TASK]);
  const hive = await buildDockerIsolationStartArgs('hive', [ISSUE_URL], { sessionId: TASK, env: {}, homeDir: '/home/box', existsSync: () => false });
  assert.ok(!hive.some(arg => String(arg).startsWith(`${TASK_SESSION_ID_ENV}=`)));
});

test('only a UUID is taken from the environment', () => {
  assert.equal(resolveTaskSessionId({ [TASK_SESSION_ID_ENV]: TASK.toUpperCase() }), TASK);
  assert.equal(resolveTaskSessionId({ [TASK_SESSION_ID_ENV]: 'not-a-uuid; rm -rf /' }), null);
  assert.equal(resolveTaskSessionId({}), null);
});

test('the first fresh Claude session takes the task id, later ones keep their own', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-3530-home-'));
  try {
    const claim = createClaudeTaskSessionIdClaimer();
    const env = { [TASK_SESSION_ID_ENV]: TASK };
    assert.deepEqual(await claim({ env, homeDir }), ['--session-id', TASK]);
    assert.deepEqual(await claim({ env, homeDir }), [], 'a second fresh session cannot reuse it');
    assert.deepEqual(await createClaudeTaskSessionIdClaimer()({ env: {}, homeDir }), [], 'a run the bot did not launch is unchanged');
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('a task id that already has a Claude transcript (restart in the same container) is not reused', async () => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-3530-home-'));
  try {
    const project = path.join(homeDir, '.claude', 'projects', '-tmp-gh-issue-solver-1');
    await fs.mkdir(project, { recursive: true });
    await fs.writeFile(path.join(project, `${TASK}.jsonl`), '{}\n');
    const logs = [];
    const claim = createClaudeTaskSessionIdClaimer();
    assert.deepEqual(await claim({ env: { [TASK_SESSION_ID_ENV]: TASK }, homeDir, verbose: true, log: async line => logs.push(line) }), []);
    assert.match(logs.join('\n'), /already names a Claude session/);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test('claude.lib starts only fresh sessions with the task id', async () => {
  const source = await fs.readFile(new URL('../src/claude.lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /const taskSessionIdArgs = argv\.resume \? \[\] : await claimClaudeTaskSessionIdArgs\(/);
  const resumeLine = source.split('\n').find(line => line.includes('--resume ${argv.resume} --output-format stream-json'));
  assert.ok(resumeLine && !resumeLine.includes('taskSessionIdArgs'), '--resume keeps the session it resumes');
  assert.equal(source.match(/--model \$\{effectiveModel\} \$\{taskSessionIdArgs\}/g)?.length, 2, 'both fresh-session commands pass it');
});
