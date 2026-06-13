#!/usr/bin/env node
/**
 * Regression test for issue #1914 — "`--isolation docker` is not working as expected".
 *
 * Complaint 1: `--isolation docker` must use ACTUAL Docker isolation, not screen
 * isolation. Earlier versions built `$ --isolated screen -- docker run …`, i.e.
 * screen isolation that merely shelled out to Docker. Hive Mind now hands the
 * container lifecycle to start-command's native Docker backend:
 *
 *   $ --isolated docker --image <img> [--privileged] --shell sh -e … --volume … \
 *       --detached --session <uuid> -- '<command>'
 *
 * These assertions lock in that native shape and guard against a regression back
 * to the screen wrapper. Image-tag pinning, credential scoping for Codex, and
 * the log-path fallback are covered by the #1860 and #1879 regression tests; this
 * file focuses on the docker-vs-screen distinction and the regular variant.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1914
 */

import { buildStartCommandArgs, buildDockerIsolationStartArgs, checkDockerContainerRunning } from '../src/isolation-runner.lib.mjs';

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

function assertNotIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) pass(label);
  else fail(label, `string NOT containing ${needle}`, haystack);
}

const valueAfter = (arr, flag) => arr[arr.indexOf(flag) + 1];

const url = 'https://github.com/link-assistant/hive-mind/issues/1914';
const existing = new Set(['/home/box/.config/gh', '/home/box/.claude', '/home/box/.claude.json', '/home/box/.codex']);
const existsSync = p => existing.has(p);

console.log('\n--- Complaint 1: --isolation docker uses ACTUAL docker isolation (not screen) ---');

const dockerArgs = buildStartCommandArgs('solve', [url], {
  backend: 'docker',
  sessionId: 'uuid-docker',
  tool: 'claude',
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind' },
  homeDir: '/home/box',
  existsSync,
});
const screenArgs = buildStartCommandArgs('solve', [url], { backend: 'screen', sessionId: 'uuid-screen' });
const tmuxArgs = buildStartCommandArgs('solve', [url], { backend: 'tmux', sessionId: 'uuid-tmux' });

assertEqual(dockerArgs[0], '--isolated', 'docker backend uses the --isolated flag');
assertEqual(dockerArgs[1], 'docker', 'Complaint 1: --isolation docker maps to native "--isolated docker"');
assertEqual(dockerArgs.includes('screen'), false, 'Complaint 1: docker isolation is NOT a screen session');
assertNotIncludes(dockerArgs.join(' '), "'docker' 'run'", 'docker isolation does NOT shell out to a hand-rolled "docker run"');
assertEqual(screenArgs[1], 'screen', 'screen backend still maps to "--isolated screen" (backends remain distinct)');
assertEqual(tmuxArgs[1], 'tmux', 'tmux backend still maps to "--isolated tmux"');

console.log('\n--- Native invocation carries a concrete image and lifecycle flags ---');

assertEqual(valueAfter(dockerArgs, '--image'), 'konard/hive-mind-dind:latest', 'docker isolation passes a concrete --image (the dind Hive Mind image)');
assertEqual(dockerArgs.includes('--privileged'), true, 'dind variant requests docker privileges (the nested dockerd needs them)');
assertEqual(valueAfter(dockerArgs, '--shell'), 'sh', 'docker isolation forces the sh shell so start-command does not boot a container to probe for one');
assertEqual(dockerArgs.includes('--detached'), true, 'docker isolation runs detached');
assertEqual(valueAfter(dockerArgs, '--session'), 'uuid-docker', 'the session UUID is passed as --session (and is also the container name)');
assertEqual(dockerArgs[dockerArgs.length - 2], '--', 'a command separator precedes the task command');
assertEqual(dockerArgs[dockerArgs.length - 1], `'solve' '${url}'`, 'the task command is passed after the separator as a single shell-quoted string');

console.log('\n--- Regular (non-dind) variant ---');

const regularArgs = buildDockerIsolationStartArgs('solve', [url], {
  sessionId: 'uuid-reg',
  tool: 'claude',
  env: { HIVE_MIND_IMAGE_VARIANT: 'regular' },
  homeDir: '/home/box',
  existsSync,
});
assertEqual(valueAfter(regularArgs, '--image'), 'konard/hive-mind:latest', 'regular variant runs the regular Hive Mind image');
assertEqual(regularArgs.includes('--privileged'), false, 'regular variant does NOT request docker privileges (no nested dockerd)');
assertEqual(valueAfter(regularArgs, '--shell'), 'sh', 'regular variant also forces the sh shell');
assertEqual(regularArgs.includes('/home/box/.claude:/home/box/.claude'), true, 'a claude task mounts Claude credentials');
assertNotIncludes(regularArgs.join(' '), '.codex', 'a claude task does not mount Codex credentials');

console.log('\n--- Explicit image override ---');

const overrideArgs = buildDockerIsolationStartArgs('solve', [url], {
  sessionId: 'uuid-ovr',
  tool: 'claude',
  env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'local/hive-mind:dev' },
  homeDir: '/home/box',
  existsSync,
});
assertEqual(valueAfter(overrideArgs, '--image'), 'local/hive-mind:dev', 'explicit HIVE_MIND_DOCKER_ISOLATION_IMAGE flows into --image');

console.log('\n--- Completion detection uses docker inspect, not screen -ls ---');

// checkDockerContainerRunning is the native-docker analogue of the screen -ls
// fallback (issue #1545/#1914). For a container that does not exist it must
// return false whether or not docker is installed (docker inspect exits non-zero
// → caught; missing docker binary → caught). This exercises the real error path.
const bogusRunning = await checkDockerContainerRunning('hive-mind-nonexistent-container-1914', false);
assertEqual(bogusRunning, false, 'checkDockerContainerRunning returns false for a non-existent container (docker inspect path)');

console.log(`\n${failed === 0 ? '✅' : '❌'} issue-1914 native docker isolation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
