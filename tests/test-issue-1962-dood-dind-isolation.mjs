#!/usr/bin/env node
/**
 * Regression test for issue #1962 — support & document both DooD and DinD
 * docker-isolation workflows.
 *
 * The isolation runner always issues the same plain `$ --isolated docker`
 * (`docker run`); the MODE only describes which daemon that `docker` talks to:
 *
 *   - DinD (Docker-in-Docker): the bot runs a NESTED daemon; the image must be
 *     seeded into it (box host-image passthrough), copying the multi-GB image.
 *   - DooD (Docker-out-of-Docker): the bot shares the HOST daemon; isolated
 *     tasks reuse the host's copy — zero copy / zero pull / zero extra disk.
 *
 * These assertions lock in:
 *   1. `resolveDockerIsolationMode` / `isDoodIsolationMode` resolve the mode
 *      from the explicit override and the `DIND_SKIP_DAEMON` / `DOCKER_HOST`
 *      signals, defaulting to `dind` so existing DinD deployments are unchanged.
 *   2. `preflightDockerIsolation` adapts its wording per mode: DooD reports the
 *      HOST daemon and concrete-tag guidance, never the nested-daemon /
 *      passthrough remediation that does not apply in DooD (no false warnings).
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1962
 */

import { resolveDockerIsolationMode, isDoodIsolationMode, preflightDockerIsolation } from '../src/isolation-runner.lib.mjs';

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

function assertNotIncludes(haystack, needle, label) {
  if (typeof haystack === 'string' && !haystack.includes(needle)) pass(label);
  else fail(label, `string NOT containing ${needle}`, haystack);
}

function captureLogger() {
  const logs = [];
  const warns = [];
  return { logs, warns, log: (...a) => logs.push(a.join(' ')), warn: (...a) => warns.push(a.join(' ')) };
}

// Copy-on-write driver + plenty of disk so only the image-presence branch fires.
const NEUTRAL_PROBES = {
  checkStorageDriver: async () => 'overlay2',
  checkDiskSpace: async () => ({ availableGiB: 500, dataRoot: '/var/lib/docker' }),
};

console.log('\n--- resolveDockerIsolationMode: default and explicit overrides ---');

assertEqual(resolveDockerIsolationMode({ env: {} }), 'dind', 'defaults to dind (historical behavior unchanged)');
assertEqual(resolveDockerIsolationMode({ env: { HIVE_MIND_DOCKER_ISOLATION_MODE: 'dood' } }), 'dood', 'explicit HIVE_MIND_DOCKER_ISOLATION_MODE=dood wins');
assertEqual(resolveDockerIsolationMode({ env: { HIVE_MIND_DOCKER_ISOLATION_MODE: 'DinD' } }), 'dind', 'explicit override is case-insensitive');
assertEqual(resolveDockerIsolationMode({ env: { HIVE_MIND_DOCKER_ISOLATION_MODE: '  dood ' } }), 'dood', 'explicit override is trimmed');
assertEqual(resolveDockerIsolationMode({ env: { HIVE_MIND_DOCKER_ISOLATION_MODE: 'bogus' } }), 'dind', 'unknown override value falls back to dind');

console.log('\n--- resolveDockerIsolationMode: inferred from box / docker signals ---');

assertEqual(resolveDockerIsolationMode({ env: { DIND_SKIP_DAEMON: '1' } }), 'dood', "DIND_SKIP_DAEMON=1 (box's DooD switch) infers dood");
assertEqual(resolveDockerIsolationMode({ env: { DIND_SKIP_DAEMON: 'true' } }), 'dood', 'DIND_SKIP_DAEMON=true infers dood');
assertEqual(resolveDockerIsolationMode({ env: { DIND_SKIP_DAEMON: '0' } }), 'dind', 'DIND_SKIP_DAEMON=0 stays dind');
assertEqual(resolveDockerIsolationMode({ env: { DOCKER_HOST: 'tcp://10.0.0.5:2375' } }), 'dood', 'DOCKER_HOST=tcp://… (remote daemon) infers dood');
assertEqual(resolveDockerIsolationMode({ env: { DOCKER_HOST: 'ssh://user@host' } }), 'dood', 'DOCKER_HOST=ssh://… infers dood');
assertEqual(resolveDockerIsolationMode({ env: { DOCKER_HOST: 'unix:///run/host-docker.sock' } }), 'dood', 'DOCKER_HOST=unix at a non-default path infers dood');
assertEqual(resolveDockerIsolationMode({ env: { DOCKER_HOST: 'unix:///var/run/docker.sock' } }), 'dind', 'DOCKER_HOST=unix at the in-container default is ambiguous → stays dind');
assertEqual(resolveDockerIsolationMode({ env: { HIVE_MIND_DOCKER_ISOLATION_MODE: 'dind', DIND_SKIP_DAEMON: '1' } }), 'dind', 'explicit override beats the DIND_SKIP_DAEMON inference');

assertEqual(isDoodIsolationMode({ env: { DIND_SKIP_DAEMON: '1' } }), true, 'isDoodIsolationMode true for a DooD env');
assertEqual(isDoodIsolationMode({ env: {} }), false, 'isDoodIsolationMode false by default (dind)');

console.log('\n--- DooD preflight: image present → host-daemon zero-copy reuse, no warning ---');

const presentLogger = captureLogger();
const present = await preflightDockerIsolation({
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DOCKER_ISOLATION_MODE: 'dood', HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '2.0.13' },
  existsSync: () => false,
  checkImagePresent: async () => true,
  ...NEUTRAL_PROBES,
  logger: presentLogger,
});
assertEqual(present.mode, 'dood', 'mode=dood surfaced in the result');
assertEqual(present.ok, true, 'ok=true when the host already holds the image');
assertEqual(present.warnings.length, 0, 'no warnings when the host image is present');
assertEqual(presentLogger.logs.length, 1, 'one info line emitted');
assertIncludes(presentLogger.logs[0], 'host Docker daemon', 'success line names the HOST daemon (not nested)');
assertIncludes(presentLogger.logs[0], 'zero copy', 'success line advertises zero-copy reuse');

console.log('\n--- DooD preflight: image absent → concrete-tag remediation, NO nested/passthrough wording ---');

const absent = await preflightDockerIsolation({
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DOCKER_ISOLATION_MODE: 'dood', HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '2.0.13' },
  existsSync: () => false,
  checkImagePresent: async () => false,
  ...NEUTRAL_PROBES,
  logger: captureLogger(),
});
assertEqual(absent.ok, false, 'ok=false when the host lacks the image');
assertEqual(absent.warnings.length, 1, 'exactly one warning (no socket/passthrough warning in DooD)');
assertIncludes(absent.warnings[0], 'host Docker daemon', 'warning names the HOST daemon');
assertIncludes(absent.warnings[0], 'docker pull', 'warning tells the operator to pull the exact tag on the host');
assertIncludes(absent.warnings[0], 'HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG', 'warning tells the operator to pin the concrete tag');
assertNotIncludes(absent.warnings[0], 'nested', 'DooD warning never mentions a nested daemon');
assertNotIncludes(absent.warnings[0], 'passthrough', 'DooD warning never mentions host-image passthrough');

console.log('\n--- DooD preflight: vfs warning targets the HOST daemon, not DIND_STORAGE_DRIVER ---');

const vfs = await preflightDockerIsolation({
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DOCKER_ISOLATION_MODE: 'dood' },
  existsSync: () => false,
  checkImagePresent: async () => true,
  checkStorageDriver: async () => 'vfs',
  checkDiskSpace: async () => ({ availableGiB: 500, dataRoot: '/var/lib/docker' }),
  logger: captureLogger(),
});
const vfsWarning = vfs.warnings.find(w => w.includes('vfs')) || '';
assertEqual(vfs.storageDriverOk, false, 'storageDriverOk=false on vfs');
assertIncludes(vfsWarning, 'HOST Docker daemon', 'vfs remediation points at the HOST daemon');
assertNotIncludes(vfsWarning, 'DIND_STORAGE_DRIVER', 'DooD vfs remediation does not suggest the DinD-only DIND_STORAGE_DRIVER knob');

console.log('\n--- DinD preflight (default): existing nested-daemon wording is preserved ---');

const dind = await preflightDockerIsolation({
  env: { HIVE_MIND_IMAGE_VARIANT: 'dind' },
  existsSync: () => false,
  checkImagePresent: async () => false,
  ...NEUTRAL_PROBES,
  logger: captureLogger(),
});
assertEqual(dind.mode, 'dind', 'mode=dind when no DooD signal is present');
assertIncludes(dind.warnings[0], 'nested Docker daemon', 'DinD warning still references the nested daemon (unchanged)');

console.log(`\n${failed === 0 ? '✅' : '❌'} issue-1962 DooD/DinD docker isolation: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
