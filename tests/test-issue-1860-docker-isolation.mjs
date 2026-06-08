#!/usr/bin/env node
/**
 * Regression test for issue #1860.
 *
 * Docker isolation used start-command's native Docker backend, which defaulted
 * to ubuntu:latest and did not remount the credentials needed by the selected
 * tool. A Codex task spawned from the Hive Mind dind image therefore started in
 * the wrong image and exited before it could run Codex.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1860
 */

import { buildDockerIsolationCommand, buildStartCommandArgs, getDockerIsolationAuthMounts, getDockerIsolationImage } from '../src/isolation-runner.lib.mjs';
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

assertDeepEqual(dockerStartArgs.slice(0, 5), ['--isolated', 'screen', '--detached', '--session', '28b8eba8-14a6-4dd0-8782-a87db8809c11'], 'Docker isolation is tracked by a start-command screen wrapper');
assertEqual(dockerStartArgs[5], '--', 'start-command still receives an explicit command separator');
assertIncludes(dockerStartArgs[6], "'docker' 'run'", 'wrapper command launches docker run');
assertIncludes(dockerStartArgs[6], "'konard/hive-mind-dind:latest'", 'wrapper command uses dind Hive Mind image');
assertIncludes(dockerStartArgs[6], "'/home/box/.codex:/home/box/.codex'", 'wrapper command mounts Codex credentials');
assertNotIncludes(dockerStartArgs[6], '.claude', 'wrapper command does not mount Claude credentials for Codex');
assertIncludes(dockerStartArgs[6], "'solve' 'https://github.com/link-assistant/hive-mind/issues/1855' '--tool' 'codex'", 'wrapper command preserves solve arguments');

const dockerCommand = buildDockerIsolationCommand('solve', ['https://github.com/link-assistant/hive-mind/issues/1855', '--tool', 'codex'], {
  sessionId: '28b8eba8-14a6-4dd0-8782-a87db8809c11',
  tool: 'codex',
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind' },
  homeDir: '/home/box',
  existsSync,
});
assertIncludes(dockerCommand, "'--privileged'", 'dind Docker isolation starts with Docker privileges');
assertIncludes(dockerCommand, "'bash' '-lc'", 'container executes the Hive Mind command through a shell');

const screenStartArgs = buildStartCommandArgs('solve', ['https://github.com/link-assistant/hive-mind/issues/1855'], {
  backend: 'screen',
  sessionId: 'a68dc7f8-900a-4f22-9940-b59f1e95b736',
});
assertDeepEqual(screenStartArgs, ['--isolated', 'screen', '--detached', '--session', 'a68dc7f8-900a-4f22-9940-b59f1e95b736', '--', "'solve' 'https://github.com/link-assistant/hive-mind/issues/1855'"], 'non-Docker isolation keeps the original backend and command shape');

console.log('\n--- Wrapper log path fallback ---');

assertEqual(
  resolveLogPath({
    statusResult: {
      uuid: '28b8eba8-14a6-4dd0-8782-a87db8809c11',
      logPath: null,
      isolation: 'screen',
    },
    isolationBackend: 'docker',
  }),
  '/tmp/start-command/logs/isolation/screen/28b8eba8-14a6-4dd0-8782-a87db8809c11.log',
  'Docker wrapper sessions fall back to the screen log directory reported by start-command'
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
  AUTO_WATCH_MESSAGE: false,
  startAutoTerminalWatchForSession: async () => {
    throw new Error('auto watch should not run in this test');
  },
  bot: {},
  formatExecutingWorkSessionMessage: ({ sessionName, isolationBackend }) => `session=${sessionName} isolation=${isolationBackend}`,
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
