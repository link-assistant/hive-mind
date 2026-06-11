#!/usr/bin/env node
/**
 * Regression test for issue #1879.
 *
 * In the Docker-in-Docker deployment, `--isolation docker` tasks launched a
 * `docker run konard/hive-mind-dind:latest ...` against the nested daemon,
 * whose image store starts empty. Docker reported "Unable to find image ...
 * locally" and pulled a fresh multi-gigabyte copy on every first task, even
 * though the host already had the exact image.
 *
 * This test covers the new controls that let operators reuse a locally present
 * image instead of re-downloading it:
 *   - HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: pin the image tag.
 *   - HIVE_MIND_DOCKER_ISOLATION_PULL: emit a `--pull` policy on `docker run`.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1879
 */

import { buildDockerIsolationCommand, getDockerIsolationImage, getDockerIsolationPullPolicy, resolveDockerIsolationImageTag } from '../src/isolation-runner.lib.mjs';

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

function assertIncludes(haystack, needle, label) {
  if (haystack.includes(needle)) pass(label);
  else fail(label, `string containing ${needle}`, haystack);
}

function assertNotIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) pass(label);
  else fail(label, `string NOT containing ${needle}`, haystack);
}

const noopExists = () => false;

console.log('\n--- Image tag pinning ---');

assertEqual(resolveDockerIsolationImageTag({ env: {} }), 'latest', 'tag defaults to latest when unset');
assertEqual(resolveDockerIsolationImageTag({ env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '1.74.11' } }), '1.74.11', 'explicit tag wins');
assertEqual(resolveDockerIsolationImageTag({ env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '  1.74.11  ' } }), '1.74.11', 'tag is trimmed');

assertEqual(getDockerIsolationImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind' } }), 'konard/hive-mind-dind:latest', 'dind image defaults to :latest (unchanged behavior)');
assertEqual(getDockerIsolationImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '1.74.11' } }), 'konard/hive-mind-dind:1.74.11', 'dind image pins to requested tag');
assertEqual(getDockerIsolationImage({ env: { HIVE_MIND_IMAGE_VARIANT: 'regular', HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '1.74.11' } }), 'konard/hive-mind:1.74.11', 'regular image pins to requested tag');
assertEqual(getDockerIsolationImage({ env: { HIVE_MIND_DOCKER_ISOLATION_IMAGE: 'local/x:dev', HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '1.74.11' } }), 'local/x:dev', 'full image override ignores tag pin');

console.log('\n--- Pull policy resolution ---');

assertEqual(getDockerIsolationPullPolicy({ env: {} }), null, 'pull policy is null when unset (use docker default)');
assertEqual(getDockerIsolationPullPolicy({ env: { HIVE_MIND_DOCKER_ISOLATION_PULL: 'never' } }), 'never', 'never policy resolves');
assertEqual(getDockerIsolationPullPolicy({ env: { HIVE_MIND_DOCKER_ISOLATION_PULL: 'MISSING' } }), 'missing', 'policy is case-insensitive');
assertEqual(getDockerIsolationPullPolicy({ env: { HIVE_MIND_DOCKER_ISOLATION_PULL: 'always' } }), 'always', 'always policy resolves');
assertEqual(getDockerIsolationPullPolicy({ env: { HIVE_MIND_DOCKER_ISOLATION_PULL: 'sometimes' } }), null, 'invalid policy is ignored');

console.log('\n--- docker run command construction ---');

const baseEnv = { HIVE_MIND_IMAGE_VARIANT: 'dind' };
const cmdDefault = buildDockerIsolationCommand('solve', ['https://example/issues/1'], { sessionId: 's1', tool: 'claude', env: baseEnv, homeDir: '/home/box', existsSync: noopExists });
assertNotIncludes(cmdDefault, '--pull', 'no --pull flag emitted by default');
assertIncludes(cmdDefault, "'konard/hive-mind-dind:latest'", 'default image used');

const cmdNever = buildDockerIsolationCommand('solve', ['https://example/issues/1'], { sessionId: 's1', tool: 'claude', env: { ...baseEnv, HIVE_MIND_DOCKER_ISOLATION_PULL: 'never' }, homeDir: '/home/box', existsSync: noopExists });
assertIncludes(cmdNever, "'--pull' 'never'", 'pull=never emits --pull never');
// The --pull flag must come before the image and the command, i.e. as a `docker run` option.
const pullIdx = cmdNever.indexOf("'--pull'");
const imageIdx = cmdNever.indexOf("'konard/hive-mind-dind");
assertEqual(pullIdx > 0 && pullIdx < imageIdx, true, '--pull precedes the image reference');

const cmdPinned = buildDockerIsolationCommand('solve', ['x'], { sessionId: 's1', tool: 'claude', env: { ...baseEnv, HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '1.74.11', HIVE_MIND_DOCKER_ISOLATION_PULL: 'never' }, homeDir: '/home/box', existsSync: noopExists });
assertIncludes(cmdPinned, "'konard/hive-mind-dind:1.74.11'", 'pinned tag flows into docker run');
assertIncludes(cmdPinned, "'--pull' 'never'", 'pinned + never combine for full host-image reuse');

console.log(`\n${failed === 0 ? '✅' : '❌'} issue-1879 docker image reuse: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
