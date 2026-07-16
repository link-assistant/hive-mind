#!/usr/bin/env node
/**
 * Regression test for issue #1914 — Complaint 2: the 30 GB image re-download.
 *
 * The bot runs inside a Docker-in-Docker container whose NESTED daemon starts
 * with an empty image store. box can seed that daemon automatically (host-image
 * passthrough), but ONLY when the host Docker socket is bind-mounted into the
 * container. When the socket is missing, passthrough is a SILENT no-op: the
 * nested daemon stays empty and the first `--isolation docker` task pulls the
 * full multi-gigabyte image. The production deploy never mounted that socket, so
 * the re-download was the first symptom anyone saw.
 *
 * `preflightDockerIsolation` turns that silent condition into a loud, actionable
 * startup signal (the issue explicitly asks for "debug output and verbose mode
 * … that will allow us to find root cause on next iteration"). These assertions
 * lock in the four startup states and the remediation each one prints:
 *
 *   A. image already present              → ok, no warning (reuse, no pull)
 *   B. dind + socket NOT mounted + absent  → warn: mount the host socket + allowlist
 *   C. dind + socket mounted   + absent    → warn: passthrough skipped (check config)
 *   D. non-dind + absent                   → warn: generic first-task pull
 *
 * `resolveHostDockerSock` is the single source of truth for the socket path and
 * must honor box's own DIND_HOST_DOCKER_SOCK override.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1914
 * @see https://github.com/link-assistant/hive-mind/issues/1879
 */

import { preflightDockerIsolation, resolveHostDockerSock, checkDockerImagePresent } from '../src/isolation-runner.lib.mjs';

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
  if (typeof haystack === 'string' && haystack.includes(needle)) pass(label);
  else fail(label, `string containing ${needle}`, haystack);
}

// A logger that captures everything so we can assert on the exact remediation
// text without polluting test output.
function captureLogger() {
  const logs = [];
  const warns = [];
  return {
    logs,
    warns,
    log: (...a) => logs.push(a.join(' ')),
    warn: (...a) => warns.push(a.join(' ')),
  };
}

const DIND = { HIVE_MIND_IMAGE_VARIANT: 'dind' };
const REGULAR = { HIVE_MIND_IMAGE_VARIANT: 'regular' };

// Neutral storage/disk probes so these passthrough scenarios stay deterministic
// on any host: overlay2 is copy-on-write and 500 GiB is plenty, so the
// storage-driver and low-disk diagnostics never fire here. Those have their own
// dedicated coverage in test-issue-1914-storage-driver-diagnostics.mjs.
const NEUTRAL_PROBES = {
  checkStorageDriver: async () => 'overlay2',
  checkDiskSpace: async () => ({ availableGiB: 500, dataRoot: '/var/lib/docker' }),
};

console.log('\n--- resolveHostDockerSock: single source of truth for the socket path ---');

assertEqual(resolveHostDockerSock({ env: {} }), '/var/run/host-docker.sock', "defaults to box's own DIND_HOST_DOCKER_SOCK default");
assertEqual(resolveHostDockerSock({ env: { DIND_HOST_DOCKER_SOCK: '/custom/docker.sock' } }), '/custom/docker.sock', 'explicit DIND_HOST_DOCKER_SOCK override wins');
assertEqual(resolveHostDockerSock({ env: { DIND_HOST_DOCKER_SOCK: '  /padded.sock  ' } }), '/padded.sock', 'override is trimmed');
assertEqual(resolveHostDockerSock({ env: { DIND_HOST_DOCKER_SOCK: '   ' } }), '/var/run/host-docker.sock', 'blank override falls back to the default');

console.log('\n--- checkDockerImagePresent is exported and never throws ---');

assertEqual(typeof checkDockerImagePresent, 'function', 'checkDockerImagePresent is exported');
// With no docker binary (or no such image) it must resolve to a boolean, not throw.
const probe = await checkDockerImagePresent('hive-mind-nonexistent-image-1914:does-not-exist', false);
assertEqual(typeof probe, 'boolean', 'checkDockerImagePresent resolves to a boolean even when docker/image is absent');

console.log('\n--- Scenario A: image already present → reuse, no warning ---');

const a = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => false,
  checkImagePresent: async () => true,
  ...NEUTRAL_PROBES,
  logger: captureLogger(),
});
assertEqual(a.ok, true, 'A: ok=true when the image is already present');
assertEqual(a.imagePresent, true, 'A: imagePresent=true');
assertEqual(a.warnings.length, 0, 'A: no warnings emitted (isolated tasks reuse the local image — no pull)');
assertEqual(a.storageDriverOk, true, 'A: storageDriverOk=true for a copy-on-write driver (overlay2)');
assertEqual(a.diskAvailableGiB, 500, 'A: diskAvailableGiB is surfaced from the disk probe');

console.log('\n--- Scenario B: dind + socket NOT mounted + image absent → mount-socket remediation ---');

const bLogger = captureLogger();
const b = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => false,
  checkImagePresent: async () => false,
  ...NEUTRAL_PROBES,
  logger: bLogger,
});
assertEqual(b.ok, false, 'B: ok=false when the image is absent');
assertEqual(b.isDind, true, 'B: dind variant detected');
assertEqual(b.socketMounted, false, 'B: socket reported as not mounted');
assertEqual(b.warnings.length, 1, 'B: exactly one warning');
assertIncludes(b.warnings[0], '/var/run/docker.sock', 'B: remediation tells the operator to mount the host docker socket');
assertIncludes(b.warnings[0], b.sock, 'B: remediation references the resolved in-container socket path');
assertIncludes(b.warnings[0], 'DIND_HOST_PASSTHROUGH_IMAGES', 'B: remediation tells the operator to set the passthrough allowlist');
assertIncludes(b.warnings[0], 'preload-dind-isolation-image.mjs', 'B: remediation offers the preload script as a fallback');
assertEqual(bLogger.warns.length, 1, 'B: the warning is routed to logger.warn (not silently swallowed)');
assertIncludes(bLogger.warns[0], '⚠️', 'B: the warning is visibly marked');

console.log('\n--- Scenario C: dind + socket mounted + image absent → passthrough-skipped remediation ---');

const c = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true,
  checkImagePresent: async () => false,
  ...NEUTRAL_PROBES,
  logger: captureLogger(),
});
assertEqual(c.ok, false, 'C: ok=false when the image is absent');
assertEqual(c.socketMounted, true, 'C: socket reported as mounted');
assertEqual(c.warnings.length, 1, 'C: exactly one warning');
assertIncludes(c.warnings[0], 'passthrough may have skipped', 'C: remediation points at a passthrough mis-config (socket is present)');
assertIncludes(c.warnings[0], 'DIND_HOST_PASSTHROUGH', 'C: remediation names the passthrough knobs to check');
assertIncludes(c.warnings[0], 'preload-dind-isolation-image.mjs', 'C: remediation offers the preload script to seed immediately');

console.log('\n--- Scenario D: non-dind variant + image absent → generic first-task-pull warning ---');

const d = await preflightDockerIsolation({
  env: REGULAR,
  existsSync: () => false,
  checkImagePresent: async () => false,
  ...NEUTRAL_PROBES,
  logger: captureLogger(),
});
assertEqual(d.ok, false, 'D: ok=false when the image is absent');
assertEqual(d.isDind, false, 'D: regular variant is not treated as dind');
assertEqual(d.warnings.length, 1, 'D: exactly one warning');
assertIncludes(d.warnings[0], 'first isolated task will pull', 'D: warns that the first task will pull the image');
assertIncludes(d.warnings[0], 'HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG', 'D: suggests pinning the tag so a pre-seeded image is matched');

console.log('\n--- Preflight never throws and respects an injected env override ---');

const e = await preflightDockerIsolation({
  env: { ...DIND, DIND_HOST_DOCKER_SOCK: '/custom/docker.sock' },
  existsSync: p => p === '/custom/docker.sock',
  checkImagePresent: async () => false,
  ...NEUTRAL_PROBES,
  logger: captureLogger(),
});
assertEqual(e.sock, '/custom/docker.sock', 'custom DIND_HOST_DOCKER_SOCK flows into the preflight result');
assertEqual(e.socketMounted, true, 'existsSync is probed at the resolved (overridden) socket path');

console.log(`\n${failed === 0 ? '✅' : '❌'} issue-1914 docker isolation preflight: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
