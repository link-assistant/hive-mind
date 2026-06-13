#!/usr/bin/env node
/**
 * Regression test for issue #1879.
 *
 * In the Docker-in-Docker deployment, `--isolation docker` tasks run against a
 * nested daemon whose image store starts empty. If the requested image is not
 * present, Docker reports "Unable to find image ... locally" and pulls a fresh
 * multi-gigabyte copy on every first task, even though the host already has the
 * exact image.
 *
 * Reuse of a locally present image is achieved at two levels:
 *   1. HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG pins the tag so a pre-seeded image
 *      matches exactly (an unpinned :latest can drift from the host copy and
 *      force a re-pull even when an image with that name is present).
 *   2. start-command's NATIVE docker backend (issue #1914) runs `docker run`
 *      with Docker's default "missing" pull policy: it reuses a locally present
 *      image and only pulls when the image is absent. There is therefore no
 *      `--pull` plumbing in Hive Mind — reuse-if-present is inherent, so a host
 *      image seeded into the nested daemon (box passthrough) is reused rather
 *      than re-downloaded.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1879
 * @see https://github.com/link-assistant/hive-mind/issues/1914
 */

import { buildDockerIsolationStartArgs, getDockerIsolationImage, resolveDockerIsolationImageTag } from '../src/isolation-runner.lib.mjs';

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

console.log('\n--- Native invocation reuses a locally present image (no --pull) ---');

const valueAfter = (arr, flag) => arr[arr.indexOf(flag) + 1];
const baseEnv = { HIVE_MIND_IMAGE_VARIANT: 'dind' };

const argsDefault = buildDockerIsolationStartArgs('solve', ['https://example/issues/1'], { sessionId: 's1', tool: 'claude', env: baseEnv, homeDir: '/home/box', existsSync: noopExists });
assertNotIncludes(argsDefault.join(' '), '--pull', 'no --pull flag is emitted (start-command reuses a local image, pulling only when missing)');
assertEqual(valueAfter(argsDefault, '--image'), 'konard/hive-mind-dind:latest', 'default dind image flows into the start-command --image flag');

const argsPinned = buildDockerIsolationStartArgs('solve', ['x'], { sessionId: 's1', tool: 'claude', env: { ...baseEnv, HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '1.74.11' }, homeDir: '/home/box', existsSync: noopExists });
assertEqual(valueAfter(argsPinned, '--image'), 'konard/hive-mind-dind:1.74.11', 'pinned tag flows into --image so a pre-seeded host image is matched and reused');
assertNotIncludes(argsPinned.join(' '), '--pull', 'a pinned image still carries no --pull flag (reuse-if-present is inherent)');
// The image must appear exactly once, as the --image value — not duplicated as a
// positional argument the way a hand-rolled `docker run <image>` wrapper would.
assertEqual(argsPinned.filter(a => a === 'konard/hive-mind-dind:1.74.11').length, 1, 'the image reference appears exactly once (as the --image value)');

console.log(`\n${failed === 0 ? '✅' : '❌'} issue-1879 docker image reuse: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
