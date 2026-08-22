#!/usr/bin/env node
/**
 * Regression test for issue #1914 — the REOPEN: `--isolation docker` tasks die
 * with `failed to register layer: no space left on device`.
 *
 * Two root causes, both made self-diagnosing by `preflightDockerIsolation`:
 *
 *   Root Cause A — the nested Docker daemon ran on the `vfs` storage driver.
 *     vfs performs NO copy-on-write: it stores a full copy of every image
 *     layer, so the multi-GB Hive Mind images consume many times their real
 *     size on disk and the first layer write overflows it. The fix ships a
 *     copy-on-write default (`fuse-overlayfs`) in Dockerfile.dind; this
 *     preflight additionally WARNS at startup whenever the live daemon is still
 *     on vfs (e.g. an old image or an explicit override), naming the exact knob.
 *
 *   Root Cause B — the Docker data root simply had too little free space to
 *     hold the >30 GB image. The preflight predicts the `no space left on
 *     device` failure before the pull instead of after.
 *
 * The probes themselves (`checkDockerStorageDriver`, `checkDockerDiskSpace`)
 * must NEVER throw and must return null when docker is unavailable, so they add
 * no warnings in environments without a daemon.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1914
 */

import { preflightDockerIsolation, checkDockerStorageDriver, checkDockerDiskSpace } from '../src/isolation-runner.lib.mjs';

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

// A driver/disk pair the diagnostics treat as healthy, so only the dimension
// under test in each scenario can produce a warning.
const okDisk = async () => ({ availableGiB: 500, dataRoot: '/var/lib/docker' });
const okDriver = async () => 'overlay2';

console.log('\n--- Probes are exported and never throw (return null without docker) ---');

assertEqual(typeof checkDockerStorageDriver, 'function', 'checkDockerStorageDriver is exported');
assertEqual(typeof checkDockerDiskSpace, 'function', 'checkDockerDiskSpace is exported');

const driverProbe = await checkDockerStorageDriver(false);
if (driverProbe === null || typeof driverProbe === 'string') pass('checkDockerStorageDriver resolves to string|null (never throws)');
else fail('checkDockerStorageDriver resolves to string|null', 'string|null', driverProbe);

const diskProbe = await checkDockerDiskSpace(false);
if (diskProbe === null || (typeof diskProbe === 'object' && typeof diskProbe.availableGiB === 'number')) {
  pass('checkDockerDiskSpace resolves to {availableGiB,dataRoot}|null (never throws)');
} else {
  fail('checkDockerDiskSpace resolves to {availableGiB,dataRoot}|null', '{availableGiB,dataRoot}|null', diskProbe);
}

console.log('\n--- Root Cause A: vfs driver warns even when the image is present ---');

const vfsLogger = captureLogger();
const vfs = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true,
  checkImagePresent: async () => true,
  checkStorageDriver: async () => 'vfs',
  checkDiskSpace: okDisk,
  logger: vfsLogger,
});
assertEqual(vfs.storageDriver, 'vfs', 'vfs: storageDriver surfaced');
assertEqual(vfs.storageDriverOk, false, 'vfs: storageDriverOk=false (vfs is the disk-amplifying driver)');
assertEqual(vfs.warnings.length, 1, 'vfs: exactly one warning even though the image is present (vfs overflows on any layer write)');
assertIncludes(vfs.warnings[0], 'vfs', 'vfs: warning names the offending driver');
assertIncludes(vfs.warnings[0], 'copy-on-write', 'vfs: warning explains the missing copy-on-write');
assertIncludes(vfs.warnings[0], 'fuse-overlayfs', 'vfs: warning names the copy-on-write replacement');
assertIncludes(vfs.warnings[0], 'DIND_STORAGE_DRIVER', 'vfs: warning names the override knob');
assertIncludes(vfs.warnings[0], 'no space left on device', 'vfs: warning names the exact failure symptom');
assertIncludes(vfs.warnings[0], '#1914', 'vfs: warning cites the issue');
assertEqual(vfsLogger.warns.length, 1, 'vfs: the warning is routed to logger.warn');

console.log('\n--- A healthy copy-on-write driver produces no storage warning ---');

const cow = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true,
  checkImagePresent: async () => true,
  checkStorageDriver: async () => 'fuse-overlayfs',
  checkDiskSpace: okDisk,
  logger: captureLogger(),
});
assertEqual(cow.storageDriverOk, true, 'fuse-overlayfs: storageDriverOk=true');
assertEqual(cow.warnings.length, 0, 'fuse-overlayfs + image present + ample disk → no warnings');

console.log('\n--- Root Cause B: low disk + image absent predicts the pull failure ---');

const lowLogger = captureLogger();
const low = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true, // socket mounted, so the only absent-image warning is passthrough-skipped
  checkImagePresent: async () => false,
  checkStorageDriver: okDriver,
  checkDiskSpace: async () => ({ availableGiB: 10, dataRoot: '/var/lib/docker' }),
  logger: lowLogger,
});
assertEqual(low.diskAvailableGiB, 10, 'low-disk: diskAvailableGiB surfaced');
assertEqual(low.warnings.length, 2, 'low-disk: passthrough-skipped + low-disk warnings');
const lowDiskWarning = low.warnings.find(w => w.includes('GiB free'));
assertIncludes(lowDiskWarning, '10 GiB free', 'low-disk: warning reports the measured free space');
assertIncludes(lowDiskWarning, '/var/lib/docker', 'low-disk: warning names the Docker data root');
assertIncludes(lowDiskWarning, '30 GB', 'low-disk: warning states the image is well over 30 GB');
assertIncludes(lowDiskWarning, 'no space left on device', 'low-disk: warning names the exact failure symptom');
assertIncludes(lowDiskWarning, '#1914', 'low-disk: warning cites the issue');

console.log('\n--- Low disk does NOT warn when the image is already present (no pull impending) ---');

const lowButPresent = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true,
  checkImagePresent: async () => true,
  checkStorageDriver: okDriver,
  checkDiskSpace: async () => ({ availableGiB: 10, dataRoot: '/var/lib/docker' }),
  logger: captureLogger(),
});
assertEqual(lowButPresent.warnings.length, 0, 'low-disk + image present → no low-disk warning (nothing to pull)');

console.log('\n--- Disk-space threshold boundary ---');

const atThreshold = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true,
  checkImagePresent: async () => false,
  checkStorageDriver: okDriver,
  checkDiskSpace: async () => ({ availableGiB: 40, dataRoot: '/var/lib/docker' }),
  logger: captureLogger(),
});
assertEqual(
  atThreshold.warnings.some(w => w.includes('GiB free')),
  false,
  '40 GiB (== floor) does not trigger the low-disk warning'
);

const justUnder = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true,
  checkImagePresent: async () => false,
  checkStorageDriver: okDriver,
  checkDiskSpace: async () => ({ availableGiB: 39, dataRoot: '/var/lib/docker' }),
  logger: captureLogger(),
});
assertEqual(
  justUnder.warnings.some(w => w.includes('GiB free')),
  true,
  '39 GiB (< floor) triggers the low-disk warning'
);

console.log('\n--- Null probes (no docker) add no storage/disk warnings ---');

const nullProbes = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => true,
  checkImagePresent: async () => true,
  checkStorageDriver: async () => null,
  checkDiskSpace: async () => null,
  logger: captureLogger(),
});
assertEqual(nullProbes.storageDriver, null, 'null driver surfaced as null');
assertEqual(nullProbes.storageDriverOk, true, 'unknown driver is treated as ok (never block on missing info)');
assertEqual(nullProbes.diskAvailableGiB, null, 'null disk surfaced as null');
assertEqual(nullProbes.warnings.length, 0, 'null probes + image present → no warnings');

console.log('\n--- All three failure modes at once stack into three warnings ---');

const allBad = await preflightDockerIsolation({
  env: DIND,
  existsSync: () => false, // socket NOT mounted → mount-socket remediation
  checkImagePresent: async () => false,
  checkStorageDriver: async () => 'vfs',
  checkDiskSpace: async () => ({ availableGiB: 5, dataRoot: '/var/lib/docker' }),
  logger: captureLogger(),
});
assertEqual(allBad.warnings.length, 3, 'vfs + socket-missing + low-disk → three stacked warnings');
assertEqual(
  allBad.warnings.some(w => w.includes('vfs')),
  true,
  'all-bad: includes the vfs warning'
);
assertEqual(
  allBad.warnings.some(w => w.includes('/var/run/docker.sock')),
  true,
  'all-bad: includes the mount-socket warning'
);
assertEqual(
  allBad.warnings.some(w => w.includes('GiB free')),
  true,
  'all-bad: includes the low-disk warning'
);

console.log(`\n${failed === 0 ? '✅' : '❌'} issue-1914 storage-driver & disk diagnostics: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
