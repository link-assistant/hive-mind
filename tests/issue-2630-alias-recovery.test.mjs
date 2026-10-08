/**
 * Telegram aliases must stay out of executable session recovery commands.
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildResumeCommand, formatResumeSection } from '../src/session-resume.lib.mjs';
import { recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';

const URL = 'https://github.com/link-assistant/hive-mind/issues/2630';
const SESSION = 'e6c1dd3f-3acd-475d-8df4-f45b75879a8b';
const TOOL_SESSION = '41cebf9b-7516-44c0-8422-5bbafe26cee9';
const info = (alias = 'claude') => ({ command: 'solve', commandAlias: alias, args: [URL, '--tool', alias], tool: alias, isolationBackend: 'docker', sessionId: SESSION, executionUuid: SESSION });

for (const alias of ['claude', 'codex', 'agent', 'solve']) {
  test(`${alias} has an executable solve command and a Telegram resume hint`, () => {
    const command = buildResumeCommand({ sessionInfo: info(alias), lastSessionId: TOOL_SESSION });
    assert.equal(command.binary, 'solve');
    assert.match(command.display, /^solve /);
    assert.match(command.chatDisplay, new RegExp(`^/${alias} `));
    assert.match(formatResumeSection({ lastSessionId: TOOL_SESSION, command }), new RegExp(`/${alias} `));
    assert.deepEqual(command.args, [URL, '--tool', alias, '--resume', TOOL_SESSION]);
  });
}

test('a binary override affects execution while the Telegram alias remains available', () => {
  const command = buildResumeCommand({ sessionInfo: info(), lastSessionId: TOOL_SESSION, binary: '/opt/bin/solve' });
  assert.equal(command.binary, '/opt/bin/solve');
  assert.match(command.display, /^\/opt\/bin\/solve /);
  assert.match(command.chatDisplay, /^\/claude /);
});

function harness({ startup = { failed: false }, cleanup = { success: true }, freshSuccess = true } = {}) {
  const commands = [],
    launches = [],
    tracked = [],
    events = [],
    order = [];
  const runner = {
    checkDockerContainerExists: async () => true,
    resumeIsolatedSession: async (_identifier, options) => {
      commands.push(options.command);
      return { success: true, uuid: SESSION, mode: RESUME_MODES.DOCKER_SNAPSHOT, sessionName: `${SESSION}-resume-1`, previousSessionName: SESSION, snapshotImage: `start-command-resume/${SESSION}:1` };
    },
    checkResumedDockerStartup: async name => {
      assert.equal(name, `${SESSION}-resume-1`);
      order.push('check');
      return startup;
    },
    cleanupFailedResumeSnapshot: async result => {
      assert.equal(result.snapshotImage, `start-command-resume/${SESSION}:1`);
      order.push('cleanup');
      return cleanup;
    },
    generateSessionId: () => 'fresh-session',
    executeWithIsolation: async (binary, args, options) => {
      order.push('fresh');
      launches.push({ binary, args, options });
      return { success: freshSuccess, executionUuid: 'fresh-execution' };
    },
  };
  const recover = (sessionInfo = info()) => recoverKilledSession({ sessionName: SESSION, sessionInfo, runner, killed: true, env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' }, readLastSessionId: () => TOOL_SESSION, trackSession: (name, data) => tracked.push({ name, data }), onLifecycle: async event => events.push(event) });
  return { recover, commands, launches, tracked, events, order };
}

test('in-place alias recovery executes solve and preserves shell argument boundaries', { timeout: 10000 }, async () => {
  const h = harness();
  const sessionInfo = info('codex');
  const literal = "spaces, $HOME, $(printf unexpected), `printf unexpected`, and a single quote: ' ";
  sessionInfo.args.push('--requirements', literal);
  const recovered = await h.recover(sessionInfo);
  assert.equal(recovered.inPlace, true);
  assert.match(h.commands[0], /^exec 'solve' /);
  assert.equal(h.launches.length, 0);
  assert.deepEqual(h.order, ['check']);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'alias-2630-'));
  try {
    await fs.writeFile(path.join(dir, 'solve'), '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n', { mode: 0o755 });
    const output = execFileSync('sh', ['-c', h.commands[0]], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), [...sessionInfo.args, '--resume', TOOL_SESSION]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

for (const exitCode of [126, 127]) {
  test(`an immediate exit ${exitCode} cleans the snapshot, reports failure, and launches once`, { timeout: 10000 }, async () => {
    const h = harness({ startup: { failed: true, exitCode, error: `automatic recovery could not start: exit ${exitCode}` } });
    const recovered = await h.recover();
    assert.equal(recovered.resumed, true);
    assert.equal(recovered.inPlace, false);
    assert.deepEqual(h.order, ['check', 'cleanup', 'fresh']);
    assert.equal(h.launches.length, 1);
    assert.equal(h.launches[0].binary, 'solve');
    assert.equal(h.tracked.length, 1);
    assert.equal(h.tracked[0].name, 'fresh-session');
    assert.equal(h.tracked[0].data.executionUuid, 'fresh-execution');
    assert.equal(h.tracked[0].data.killRecoveryAttempts, 1);
    assert.ok(h.events.some(event => event.phase === 'launching' && /could not start.*fresh/i.test(event.reason)));
  });
}

test('failed cleanup reports the retained artifacts and does not lose the fallback', async () => {
  const image = `start-command-resume/${SESSION}:1`;
  const h = harness({ startup: { failed: true, exitCode: 127, error: 'automatic recovery could not start: exit 127' }, cleanup: { success: false, error: `Could not remove ${image}` } });
  assert.equal((await h.recover()).resumed, true);
  assert.ok(h.events.some(event => event.reason?.includes(image)));
});

test('a failed fresh fallback reports failure without tracking the broken snapshot', async () => {
  const h = harness({ startup: { failed: true, exitCode: 127, error: 'automatic recovery could not start: exit 127' }, freshSuccess: false });
  assert.equal((await h.recover()).resumed, false);
  assert.equal(h.tracked.length, 0);
  assert.equal(h.launches.length, 1);
});
