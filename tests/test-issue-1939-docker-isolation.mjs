#!/usr/bin/env node
/**
 * Regression test for issue #1939 (`--isolation docker` is not working).
 *
 * The failed docker-isolation run surfaced three problems. This suite covers the
 * two that are fixable in Hive Mind code:
 *
 *  - Problem 3 (root cause, definite): the child container authenticated with gh
 *    but inherited NO git identity, so `solve` aborted with
 *    "Git identity not configured". `getDockerIsolationAuthMounts` now mounts the
 *    host git identity (`~/.gitconfig` and the XDG `~/.config/git`) for every
 *    tool, just like gh.
 *
 *  - Problem 1 (robustness): a native docker session can report a terminal status
 *    ("executed") with the unknown exit-code sentinel (-1) while its container is
 *    still running. `isUnknownDockerExitCode` + the `isSessionRunning` docker
 *    cross-check keep such a session "running" until `docker inspect` confirms
 *    the container is actually gone.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1939
 * @see https://github.com/link-assistant/hive-mind/issues/1860
 */

import { ensureHostGitIdentityForIsolation, getDockerIsolationAuthMounts, hostHasMountableGitIdentity, isUnknownDockerExitCode } from '../src/isolation-runner.lib.mjs';
import { __setIsolationRunnerForTests, getIsolationSessionStateForTests } from '../src/session-monitor.lib.mjs';

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

function mountPairs(mounts) {
  return mounts.map(mount => `${mount.source}:${mount.target}`);
}

console.log('\n--- Git identity is mounted for every tool (issue #1939, problem 3) ---');

// Host exposes gh auth, both tool creds, AND a git identity file + XDG git dir.
const allPaths = new Set(['/home/box/.config/gh', '/home/box/.gitconfig', '/home/box/.config/git', '/home/box/.codex', '/home/box/.claude', '/home/box/.claude.json']);
const existsAll = path => allPaths.has(path);

const claudeMounts = getDockerIsolationAuthMounts({ tool: 'claude', homeDir: '/home/box', env: {}, existsSync: existsAll });
assertDeepEqual(mountPairs(claudeMounts), ['/home/box/.config/gh:/home/box/.config/gh', '/home/box/.gitconfig:/home/box/.gitconfig', '/home/box/.config/git:/home/box/.config/git', '/home/box/.claude:/home/box/.claude', '/home/box/.claude.json:/home/box/.claude.json'], 'claude tasks receive gh, git identity, and Claude credentials');

const codexMounts = getDockerIsolationAuthMounts({ tool: 'codex', homeDir: '/home/box', env: {}, existsSync: existsAll });
assertDeepEqual(mountPairs(codexMounts), ['/home/box/.config/gh:/home/box/.config/gh', '/home/box/.gitconfig:/home/box/.gitconfig', '/home/box/.config/git:/home/box/.config/git', '/home/box/.codex:/home/box/.codex'], 'codex tasks receive gh, git identity, and Codex credentials');

console.log('\n--- Git identity mounts honor git/XDG env overrides ---');

const overrideMounts = getDockerIsolationAuthMounts({
  tool: 'codex',
  homeDir: '/home/box',
  env: { GIT_CONFIG_GLOBAL: '/run/git/config', XDG_CONFIG_HOME: '/run/xdg' },
  existsSync: path => path === '/home/box/.config/gh' || path === '/run/git/config' || path === '/run/xdg/git' || path === '/home/box/.codex',
});
assertDeepEqual(mountPairs(overrideMounts), ['/home/box/.config/gh:/home/box/.config/gh', '/run/git/config:/home/box/.gitconfig', '/run/xdg/git:/home/box/.config/git', '/home/box/.codex:/home/box/.codex'], 'GIT_CONFIG_GLOBAL and XDG_CONFIG_HOME are used when the host exposes git config outside the default paths');

console.log('\n--- Missing host git identity is skipped, not invented ---');

// Reproduces the failure environment: gh is present but no host git identity.
const noGitPaths = new Set(['/home/box/.config/gh', '/home/box/.claude', '/home/box/.claude.json']);
const noGitMounts = getDockerIsolationAuthMounts({ tool: 'claude', homeDir: '/home/box', env: {}, existsSync: path => noGitPaths.has(path) });
assertEqual(
  mountPairs(noGitMounts).some(pair => pair.includes('.gitconfig') || pair.includes('.config/git')),
  false,
  'a host without a git identity gets no phantom git mount (the symptom the deploy must fix)'
);

console.log('\n--- Host git-identity preflight is self-healing (issue #1939, problem 3) ---');

// Host already has ~/.gitconfig: preflight reports present, never repairs.
{
  let repairCalled = false;
  const out = await ensureHostGitIdentityForIsolation({
    env: {},
    homeDir: '/home/box',
    existsSync: p => p === '/home/box/.gitconfig',
    logger: { log() {}, warn() {} },
    repair: async () => {
      repairCalled = true;
      return { success: true };
    },
  });
  assertEqual(out.present, true, 'an existing host git identity is detected and mounted (no repair attempted)');
  assertEqual(out.repaired, false, 'no repair runs when the host already has a git identity');
  assertEqual(repairCalled, false, 'the repair probe is not invoked when an identity already exists');
}

// Host lacks a git identity but gh-setup-git-identity can derive one: self-heal.
{
  let configured = false;
  const out = await ensureHostGitIdentityForIsolation({
    env: {},
    homeDir: '/home/box',
    // Absent until repair runs, present afterwards.
    existsSync: p => configured && p === '/home/box/.gitconfig',
    logger: { log() {}, warn() {} },
    repair: async () => {
      configured = true;
      return { success: true };
    },
  });
  assertEqual(out.present, true, 'a missing host git identity is derived from the gh account so it becomes mountable');
  assertEqual(out.repaired, true, 'the preflight records that it repaired the identity');
  assertEqual(out.warnings.length, 0, 'a successful self-heal emits no warning');
}

// Host lacks a git identity and repair is impossible: loud, actionable warning.
{
  const out = await ensureHostGitIdentityForIsolation({
    env: {},
    homeDir: '/home/box',
    existsSync: () => false,
    logger: { log() {}, warn() {} },
    repair: async () => ({ success: false, error: 'gh-setup-git-identity is not installed' }),
  });
  assertEqual(out.present, false, 'an unrepairable missing identity is reported absent');
  assertEqual(out.warnings.length, 1, 'an unrepairable missing identity emits exactly one warning');
  assertEqual(out.warnings[0].includes('Git identity not configured'), true, 'the warning names the exact downstream failure');
}

assertEqual(hostHasMountableGitIdentity({ env: {}, homeDir: '/home/box', existsSync: p => p === '/home/box/.config/git' }), true, 'hostHasMountableGitIdentity sees the XDG ~/.config/git directory');
assertEqual(hostHasMountableGitIdentity({ env: {}, homeDir: '/home/box', existsSync: () => false }), false, 'hostHasMountableGitIdentity is false when no git identity exists');

console.log('\n--- Unknown docker exit code detection (issue #1939, problem 1) ---');

assertEqual(isUnknownDockerExitCode(-1), true, 'the -1 sentinel is treated as an unknown exit code');
assertEqual(isUnknownDockerExitCode(null), true, 'a missing exit code is treated as unknown');
assertEqual(isUnknownDockerExitCode(undefined), true, 'an undefined exit code is treated as unknown');
assertEqual(isUnknownDockerExitCode(0), false, 'a real success exit code (0) is a known result');
assertEqual(isUnknownDockerExitCode(127), false, 'a real failure exit code (127) is a known result');

console.log('\n--- session-monitor cross-checks a live container on an ambiguous docker status (problem 1) ---');

function stubRunner({ status, exitCode, isSessionRunning }) {
  return {
    isExecutingSessionStatus: s => s === 'executing' || s === 'running',
    isTerminalSessionStatus: s => ['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error'].includes(s),
    isUnknownDockerExitCode,
    querySessionStatus: async () => ({ exists: true, status, exitCode }),
    isSessionRunning: async () => isSessionRunning,
  };
}

// Ambiguous: terminal "executed" + -1 sentinel, but the container is still alive.
// The state must fall through to isSessionRunning() (the live cross-check) and
// report the session as still running rather than prematurely completing it.
__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: -1, isSessionRunning: true }));
const ambiguousAlive = await getIsolationSessionStateForTests('sess-1939', { isolationBackend: 'docker', sessionId: 'sess-1939' });
assertEqual(ambiguousAlive.running, true, 'a docker "executed"/-1 status whose container is still running is reported running (no premature completion)');

// Ambiguous status but the container is really gone: the fall-through cross-check
// confirms completion.
__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: -1, isSessionRunning: false }));
const ambiguousGone = await getIsolationSessionStateForTests('sess-1939', { isolationBackend: 'docker', sessionId: 'sess-1939' });
assertEqual(ambiguousGone.running, false, 'a docker "executed"/-1 status whose container has exited is reported finished');

// A real captured exit code is authoritative — no cross-check, no fall-through.
__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: 0, isSessionRunning: true }));
const realExit = await getIsolationSessionStateForTests('sess-1939', { isolationBackend: 'docker', sessionId: 'sess-1939' });
assertEqual(realExit.running, false, 'a docker terminal status with a real exit code is trusted without cross-checking the container');
assertEqual(realExit.exitCode, 0, 'the real captured exit code is preserved');

// A non-docker terminal status is unaffected by the docker-only cross-check.
__setIsolationRunnerForTests(stubRunner({ status: 'executed', exitCode: -1, isSessionRunning: true }));
const screenState = await getIsolationSessionStateForTests('sess-1939', { isolationBackend: 'screen', sessionId: 'sess-1939' });
assertEqual(screenState.running, false, 'a screen terminal status is still trusted directly (docker cross-check does not apply)');

__setIsolationRunnerForTests(null);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
