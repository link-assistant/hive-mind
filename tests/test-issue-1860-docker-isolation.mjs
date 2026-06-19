#!/usr/bin/env node
/**
 * Regression test for issue #1860.
 *
 * Docker isolation must launch the Hive Mind image that actually carries the
 * solve/hive/task CLIs (not a bare OS image like ubuntu:latest) and must remount
 * only the credentials the selected tool needs. The original bug let a Codex
 * task start in the wrong image with the wrong credentials, so it exited before
 * it could run Codex.
 *
 * Since issue #1914 these guarantees are delivered through start-command's
 * NATIVE Docker backend (`$ --isolated docker --image … --volume … --privileged`)
 * rather than a hand-rolled `docker run` wrapped in a screen session, so the
 * assertions below check that native invocation shape.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1860
 * @see https://github.com/link-assistant/hive-mind/issues/1914
 */

import { buildDockerIsolationStartArgs, buildStartCommandArgs, getDockerIsolationAuthMounts, getDockerIsolationImage } from '../src/isolation-runner.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { createIsolationAwareQueueCallback } from '../src/telegram-isolation.lib.mjs';
import { resolveLogPath } from '../src/telegram-log-command.lib.mjs';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}

function fail(label, expected, actual) {
  console.error(`  FAIL: ${label}`);
  if (expected !== undefined) console.error(`     expected: ${JSON.stringify(expected)}`);
  if (actual !== undefined) console.error(`     actual:   ${JSON.stringify(actual)}`);
  failed++;
}

function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass(label);
  else fail(label, expected, actual);
}

function assertIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) pass(label);
  else fail(label, `string containing ${needle}`, haystack);
}

function assertNotIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) pass(label);
  else fail(label, `string not containing ${needle}`, haystack);
}

function mountPairs(mounts) {
  return mounts.map(mount => `${mount.source}:${mount.target}`);
}

const existingPaths = new Set(['/home/box/.config/gh', '/home/box/.codex', '/home/box/.claude', '/home/box/.claude.json']);
const existsSync = path => existingPaths.has(path);

console.log('\n--- Docker isolation image selection ---');

assertEqual(getDockerIsolationImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind' } }), 'konard/hive-mind-dind:latest', 'dind Hive Mind image spawns the dind Docker isolation image');
assertEqual(getDockerIsolationImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'regular' } }), 'konard/hive-mind:latest', 'regular Hive Mind image spawns the regular Docker isolation image');
assertEqual(getDockerIsolationImage({ env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'local/hive-mind-test:dev', HIVE_MIND_IMAGE_VARIANT: 'dind' } }), 'local/hive-mind-test:dev', 'explicit Docker isolation image override wins');

console.log('\n--- Tool-scoped credential mounts ---');

const codexMounts = getDockerIsolationAuthMounts({
  tool: 'codex',
  homeDir: '/home/box',
  env: {},
  existsSync,
});
assertDeepEqual(mountPairs(codexMounts), ['/home/box/.config/gh:/home/box/.config/gh', '/home/box/.codex:/home/box/.codex'], 'codex tasks receive gh and Codex credentials only');

const claudeMounts = getDockerIsolationAuthMounts({
  tool: 'claude',
  homeDir: '/home/box',
  env: {},
  existsSync,
});
assertDeepEqual(mountPairs(claudeMounts), ['/home/box/.config/gh:/home/box/.config/gh', '/home/box/.claude:/home/box/.claude', '/home/box/.claude.json:/home/box/.claude.json'], 'claude tasks receive gh and Claude credentials only');

const envGhMounts = getDockerIsolationAuthMounts({
  tool: 'codex',
  homeDir: '/home/box',
  env: { GH_CONFIG_DIR: '/run/gh-auth' },
  existsSync: path => path === '/run/gh-auth' || path === '/home/box/.codex',
});
assertDeepEqual(mountPairs(envGhMounts), ['/run/gh-auth:/home/box/.config/gh', '/home/box/.codex:/home/box/.codex'], 'GH_CONFIG_DIR is used when the host exposes gh auth outside the default path');

console.log('\n--- start-command invocation shape ---');

const dockerStartArgs = buildStartCommandArgs('solve', ['https://github.com/link-assistant/hive-mind/issues/1855', '--tool', 'codex'], {
  backend: 'docker',
  sessionId: '28b8eba8-14a6-4dd0-8782-a87db8809c11',
  tool: 'codex',
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind' },
  homeDir: '/home/box',
  existsSync,
});

const valueAfter = (arr, flag) => arr[arr.indexOf(flag) + 1];

// Native shape: $ --isolated docker --image <img> [--privileged] --shell sh -e … --volume … --detached --session <uuid> -- '<command>'
assertDeepEqual(dockerStartArgs.slice(0, 4), ['--isolated', 'docker', '--image', 'konard/hive-mind-dind:latest'], "Docker isolation runs natively on start-command's docker backend with the dind Hive Mind image");
assertEqual(dockerStartArgs.includes('screen'), false, 'Docker isolation is no longer wrapped in a screen session (issue #1914)');
assertNotIncludes(dockerStartArgs.join(' '), "'docker' 'run'", 'Docker isolation no longer shells out to a hand-rolled docker run');
assertEqual(dockerStartArgs.includes('--privileged'), true, 'dind Docker isolation runs privileged');
assertEqual(valueAfter(dockerStartArgs, '--shell'), 'sh', 'Docker isolation forces the sh shell so start-command does not boot a container to probe for one');
assertEqual(dockerStartArgs.includes('--detached'), true, 'Docker isolation runs detached');
assertEqual(valueAfter(dockerStartArgs, '--session'), '28b8eba8-14a6-4dd0-8782-a87db8809c11', 'Docker isolation tracks the task by the session UUID (also the container name)');
assertEqual(dockerStartArgs.includes('HOME=/home/box'), true, 'Docker isolation sets HOME so credential mounts under /home/box resolve');
assertEqual(dockerStartArgs.includes('HIVE_MIND_IMAGE_VARIANT=dind'), true, 'Docker isolation records the dind image variant inside the container');
assertEqual(dockerStartArgs.includes('/home/box/.config/gh:/home/box/.config/gh'), true, 'Docker isolation mounts gh credentials');
assertEqual(dockerStartArgs.includes('/home/box/.codex:/home/box/.codex'), true, 'Docker isolation mounts Codex credentials');
assertNotIncludes(dockerStartArgs.join(' '), '.claude', 'Docker isolation does not mount Claude credentials for a Codex task');
assertEqual(dockerStartArgs[dockerStartArgs.length - 2], '--', 'start-command receives an explicit command separator before the task command');
assertEqual(dockerStartArgs[dockerStartArgs.length - 1], "'solve' 'https://github.com/link-assistant/hive-mind/issues/1855' '--tool' 'codex'", 'the separated command is a single shell string preserving the solve arguments');

// buildStartCommandArgs(backend:'docker') must delegate verbatim to the exported buildDockerIsolationStartArgs.
const dockerStartArgsDirect = buildDockerIsolationStartArgs('solve', ['https://github.com/link-assistant/hive-mind/issues/1855', '--tool', 'codex'], {
  sessionId: '28b8eba8-14a6-4dd0-8782-a87db8809c11',
  tool: 'codex',
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind' },
  homeDir: '/home/box',
  existsSync,
});
assertDeepEqual(dockerStartArgsDirect, dockerStartArgs, 'buildStartCommandArgs delegates the docker backend to buildDockerIsolationStartArgs');

const screenStartArgs = buildStartCommandArgs('solve', ['https://github.com/link-assistant/hive-mind/issues/1855'], {
  backend: 'screen',
  sessionId: 'a68dc7f8-900a-4f22-9940-b59f1e95b736',
});
assertDeepEqual(screenStartArgs, ['--isolated', 'screen', '--detached', '--session', 'a68dc7f8-900a-4f22-9940-b59f1e95b736', '--', "'solve' 'https://github.com/link-assistant/hive-mind/issues/1855'"], 'non-Docker isolation keeps the original backend and command shape');

console.log('\n--- Native docker log path ---');

// When `$ --status` reports a logPath it is used verbatim. The path below is the
// real one observed in the issue evidence (docs/case-studies/issue-1914/data/
// issue-1860-session.log line 20): start-command writes native docker logs to
// /tmp/start-command/logs/isolation/docker/<execution-id>.log.
assertEqual(
  resolveLogPath({
    statusResult: {
      uuid: '28b8eba8-14a6-4dd0-8782-a87db8809c11',
      logPath: '/tmp/start-command/logs/isolation/docker/56a99ba3-83a7-4e2d-aecc-7cbad9405209.log',
      isolation: 'docker',
    },
    isolationBackend: 'docker',
  }),
  '/tmp/start-command/logs/isolation/docker/56a99ba3-83a7-4e2d-aecc-7cbad9405209.log',
  'a start-command-reported docker log path is used verbatim'
);

// When no logPath is reported, the fallback derives it from the docker backend
// (native docker is no longer a screen wrapper, so it uses the docker log dir).
assertEqual(
  resolveLogPath({
    statusResult: {
      uuid: '28b8eba8-14a6-4dd0-8782-a87db8809c11',
      logPath: null,
      isolation: 'docker',
    },
    isolationBackend: 'docker',
  }),
  '/tmp/start-command/logs/isolation/docker/28b8eba8-14a6-4dd0-8782-a87db8809c11.log',
  'native docker sessions fall back to the docker log directory'
);

console.log('\n--- Telegram tool propagation ---');

const directIsolationCalls = [];
const directTrackCalls = [];
const executeAndUpdateMessage = buildExecuteAndUpdateMessage({
  resolveIsolation: async () => ({
    backend: 'docker',
    runner: {
      generateSessionId: () => 'direct-session-1860',
      executeWithIsolation: async (command, args, options) => {
        directIsolationCalls.push({ command, args, options });
        return { success: true, output: 'session: direct-session-1860' };
      },
    },
  }),
  ISOLATION_BACKEND: null,
  isolationRunner: null,
  VERBOSE: false,
  executeStartScreen: async () => {
    throw new Error('executeStartScreen should not run for isolated execution');
  },
  trackSession: (sessionId, sessionInfo) => {
    directTrackCalls.push({ sessionId, sessionInfo });
  },
  untrackSession: () => {},
  AUTO_WATCH_MESSAGE: false,
  startAutoTerminalWatchForSession: async () => {
    throw new Error('auto watch should not run in this test');
  },
  bot: {},
  formatExecutingWorkSessionMessage: ({ sessionName, isolationBackend }) => `session=${sessionName} isolation=${isolationBackend}`,
  // Issue #1946: the session UUID + isolation are surfaced before the launch.
  formatStartingWorkSessionMessage: ({ sessionName = null, isolationBackend = null } = {}) => (sessionName ? `starting session=${sessionName} isolation=${isolationBackend}` : 'starting'),
});

await executeAndUpdateMessage(
  {
    chat: { id: 101 },
    from: { id: 202 },
    telegram: {
      editMessageText: async () => {},
    },
  },
  { chat: { id: 101 }, message_id: 303 },
  'solve',
  ['https://github.com/link-assistant/hive-mind/issues/1855', '--tool', 'codex'],
  'info',
  'docker',
  'codex'
);
assertEqual(directIsolationCalls.length, 1, 'direct isolated execution invokes the runner once');
assertEqual(directIsolationCalls[0].options.backend, 'docker', 'direct isolated execution keeps docker backend');
assertEqual(directIsolationCalls[0].options.tool, 'codex', 'direct isolated execution passes the selected tool');
assertEqual(directTrackCalls[0].sessionInfo.tool, 'codex', 'direct tracked session stores the selected tool');

const queuedIsolationCalls = [];
const queuedTrackCalls = [];
const queueCallback = createIsolationAwareQueueCallback(
  null,
  {
    generateSessionId: () => 'queued-session-1860',
    executeWithIsolation: async (command, args, options) => {
      queuedIsolationCalls.push({ command, args, options });
      return { success: true, output: 'session: queued-session-1860' };
    },
  },
  (sessionId, sessionInfo) => {
    queuedTrackCalls.push({ sessionId, sessionInfo });
  },
  async () => {
    throw new Error('fallback queue callback should not run for isolated execution');
  },
  false
);

const queueResult = await queueCallback({
  perCommandIsolation: 'docker',
  command: 'solve',
  args: ['https://github.com/link-assistant/hive-mind/issues/1855', '--tool', 'codex'],
  tool: 'codex',
  url: 'https://github.com/link-assistant/hive-mind/issues/1855',
  ctx: { chat: { id: 404 } },
  messageInfo: { messageId: 505 },
});
assertEqual(queueResult.success, true, 'queued isolated execution succeeds through the mocked runner');
assertEqual(queuedIsolationCalls.length, 1, 'queued isolated execution invokes the runner once');
assertEqual(queuedIsolationCalls[0].options.backend, 'docker', 'queued isolated execution keeps docker backend');
assertEqual(queuedIsolationCalls[0].options.tool, 'codex', 'queued isolated execution passes the selected tool');
assertEqual(queuedTrackCalls[0].sessionInfo.tool, 'codex', 'queued tracked session stores the selected tool');

console.log(`\nResult: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
