/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { checkDockerDaemonReachability } from '../src/docker-daemon-preflight.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { executeWithIsolation } from '../src/isolation-runner.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';

const sessionId = 'da0ce819-99a6-44c4-a091-cadc05ed2702';
const url = 'https://github.com/link-assistant/hive-mind/pull/4104';

test('a Docker bot with no daemon reports the cause and keeps the failed launch visible', { timeout: 10_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-4103-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = path.join(root, 'calls');
  const homeDir = path.join(root, 'home');
  await fs.mkdir(homeDir);
  await fs.writeFile(path.join(homeDir, '.gitconfig'), '[user]\n  name = Test\n  email = test@example.invalid\n');
  await fs.writeFile(path.join(root, 'docker'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(calls)},process.argv[2]+'\\n');\nconsole.error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');\nprocess.exitCode=1;\n`, { mode: 0o700 });
  const errors = [];
  t.mock.method(console, 'error', message => errors.push(message));
  const originalUse = globalThis.use;
  globalThis.use = async () => ({ $: () => async strings => (strings[0] === 'which $' ? { stdout: '/synthetic/start-command' } : assert.fail('start-command must not launch')) });
  t.after(() => {
    globalThis.use = originalUse;
  });

  const queue = new SolveQueue({ autoStart: false, getToolProcessSnapshot: async () => [], getRunningIsolatedSessions: async () => ({}) });
  const edits = [];
  const tracked = new Map();
  const env = { PATH: root, HIVE_MIND_DOCKER_ISOLATION_PULL: 'never', HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'synthetic:1' };
  const runner = { generateSessionId: () => sessionId, executeWithIsolation: (command, args, options) => executeWithIsolation(command, args, { ...options, env, homeDir }) };
  const run = buildExecuteAndUpdateMessage({
    resolveIsolation: async () => ({ backend: 'docker', runner }),
    CONTAINER_RESOURCE_LIMITS: { cpu: null, memory: null, disk: null },
    formatStartingWorkSessionMessage: () => 'Starting',
    trackSession: (name, info) => tracked.set(name, info),
    untrackSession: name => tracked.delete(name),
    recordLaunchFailure: failure => queue.recordLaunchFailure(failure),
  });
  const chat = { id: 42 };
  await initI18n('en');
  await run({ chat, telegram: { editMessageText: async (_chat, _id, _inline, message) => edits.push(message) } }, { chat, message_id: 1 }, 'solve', [url, '--think', 'xhigh', '--tool', 'codex'], '', 'docker', 'codex', null, { locale: 'en' });

  assert.match(edits.at(-1), /Cannot connect to the Docker daemon at unix:\/\/\/var\/run\/docker\.sock/u);
  assert.match(edits.at(-1), /-v \/var\/run\/docker\.sock:\/var\/run\/docker\.sock/u);
  assert.match(edits.at(-1), /hive-mind-dind/u);
  assert.match(edits.at(-1), /`\/queue`/u);
  assert.ok(errors.some(message => message.includes(sessionId) && message.includes('Cannot connect to the Docker daemon')));
  assert.equal(await fs.readFile(calls, 'utf8'), 'version\n', 'preflight is the only Docker call');
  assert.deepEqual(await fs.readdir(homeDir), ['.gitconfig'], 'preflight precedes host path preparation');
  assert.equal(tracked.size, 0);

  const history = await queue.formatDetailedStatus({ locale: 'en' });
  assert.match(history, /\*Failed\* \(1\)/u);
  assert.match(history, new RegExp(sessionId, 'u'));
  assert.match(history, /Cannot connect to the Docker daemon/u);
  assert.doesNotMatch(history, /\*Processing\*/u);
});

test('daemon preflight distinguishes a missing CLI, socket permission errors and a custom context', { timeout: 5_000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-4103-daemon-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  assert.match(await checkDockerDaemonReachability({ PATH: root }), /Docker CLI was not found/u);

  await fs.writeFile(path.join(root, 'docker'), `#!${process.execPath}\nif (process.env.DOCKER_HOST) { console.error('failed to connect to the docker API at ' + process.env.DOCKER_HOST); process.exitCode=1; } else if (process.env.DOCKER_CONTEXT) { console.error('permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock'); process.exitCode=1; } else { console.log('29.0.0'); }\n`, { mode: 0o700 });
  assert.equal(await checkDockerDaemonReachability({ PATH: root }), null);
  assert.match(await checkDockerDaemonReachability({ PATH: root, DOCKER_CONTEXT: 'synthetic' }), /Permission denied .*unix:\/\/\/var\/run\/docker\.sock/u);
  const unavailable = await checkDockerDaemonReachability({ PATH: root, DOCKER_HOST: 'unix:///tmp/private-socket' });
  assert.match(unavailable, /Cannot connect to the configured Docker daemon.*DOCKER_HOST/u);
  assert.doesNotMatch(unavailable, /private-socket|mount the host socket/u);
});
