#!/usr/bin/env node
/**
 * Regression test for the destructive-push guard (issue #2164, R13).
 *
 * The requirement is that an agent loses the physical ability to destroy data,
 * so the interesting assertions are behavioural: the hook is run against a real
 * git repository with a real remote, and deletions and force pushes have to
 * actually fail while an ordinary push has to actually succeed. Asserting the
 * script's text would prove nothing — git is the only thing whose opinion of a
 * `pre-push` hook matters.
 *
 * The wiring is checked too, in both directions: a routed task gets the hook,
 * and a default (unrouted) task is left exactly as it was.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildGitPushGuardEnv, GIT_PUSH_GUARD_CONTAINER_DIR, GIT_PUSH_GUARD_ESCAPE_ENV, hasForcePushOptIn, installGitPushGuard, resolveGitPushGuardHostDir } from '../src/git-push-guard.lib.mjs';
import { buildDockerIsolationStartArgs } from '../src/isolation-runner.lib.mjs';
import { resolveBotStateDir } from '../src/session-store.lib.mjs';

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

console.log('\n=== issue #2164: the hook is installed where a task can read it but not edit it ===');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-push-guard-'));
const hooksHome = path.join(workspace, 'home');

const installed = installGitPushGuard({ env: {}, homeDir: hooksHome });
assertEqual(installed.installed, true, 'the guard installs into the operator home');
assertEqual(installed.hookPath, path.join(hooksHome, '.hive-mind', 'git-hooks', 'pre-push'), 'as a pre-push hook');
assertEqual(Boolean(fs.statSync(installed.hookPath).mode & 0o111), true, 'and is executable, or git would skip it without a word');

assertEqual(resolveGitPushGuardHostDir({ env: { HIVE_MIND_GIT_HOOKS_DIR: '/srv/hooks' }, homeDir: hooksHome }), '/srv/hooks', 'the host directory can be relocated');
// The hook directory is mounted into every routed task, so it must never be the
// directory holding the router's token-signing secret.
assertEqual(resolveGitPushGuardHostDir({ env: {}, homeDir: hooksHome }).startsWith(resolveBotStateDir({ HIVE_MIND_STATE_DIR: path.join(hooksHome, '.hive-mind', 'state') })), false, 'and is never the state directory, which holds the signing secret');

assertEqual(GIT_PUSH_GUARD_CONTAINER_DIR.startsWith('/home/box/'), true, "the container path sits under the isolation image's HOME");

console.log('\n=== issue #2164: git actually refuses the destructive pushes (R13) ===');

const git = (cwd, args, env = {}) => {
  try {
    return { code: 0, output: String(execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })) };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

const remote = path.join(workspace, 'remote.git');
const clone = path.join(workspace, 'work');
fs.mkdirSync(clone, { recursive: true });
git(workspace, ['init', '--quiet', '--bare', remote]);
git(clone, ['init', '--quiet']);
git(clone, ['config', 'user.email', 'guard@example.com']);
git(clone, ['config', 'user.name', 'Guard Test']);
git(clone, ['remote', 'add', 'origin', remote]);

// Exactly the delivery mechanism buildDockerIsolationStartArgs uses: environment
// variables, so the bind-mounted ~/.gitconfig is never written to.
const guarded = buildGitPushGuardEnv({ hooksPath: path.dirname(installed.hookPath) });
const commit = message => {
  fs.writeFileSync(path.join(clone, `${message}.txt`), `${message}\n`);
  git(clone, ['add', '-A']);
  git(clone, ['commit', '--quiet', '-m', message]);
};

commit('first');
assertEqual(git(clone, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], guarded).code, 0, 'creating a branch is allowed');
commit('second');
assertEqual(git(clone, ['push', '--quiet', 'origin', 'HEAD:refs/heads/main'], guarded).code, 0, 'a fast-forward push is allowed');

// The `git reset` half of the requirement: the reset itself is local and
// harmless, so the guard has to catch the push that would make it permanent.
git(clone, ['reset', '--quiet', '--hard', 'HEAD~1']);
commit('rewritten');
const forced = git(clone, ['push', '--force', 'origin', 'HEAD:refs/heads/main'], guarded);
assertEqual(forced.code !== 0, true, 'a force push that drops a remote commit is refused');
assertEqual(forced.output.includes('rewrite history'), true, 'and says which rule it broke');

const deleted = git(clone, ['push', 'origin', '--delete', 'main'], guarded);
assertEqual(deleted.code !== 0, true, 'deleting a remote branch is refused');
assertEqual(deleted.output.includes('delete a remote ref'), true, 'and says so');

// Nothing may have reached the remote while it was being refused.
const remoteHead = git(remote, ['log', '--oneline', '-1', 'refs/heads/main']);
assertEqual(remoteHead.code === 0 && remoteHead.output.includes('second'), true, 'the remote still holds the history the task tried to discard');

const escaped = git(clone, ['push', '--force', 'origin', 'HEAD:refs/heads/main'], { ...guarded, [GIT_PUSH_GUARD_ESCAPE_ENV]: '1' });
assertEqual(escaped.code, 0, 'an operator who opted in explicitly can still force-push');

assertEqual(hasForcePushOptIn(['--allow-fork-divergence-resolution-using-force-push-with-lease']), true, 'the existing fork-divergence opt-in is recognised');
assertEqual(hasForcePushOptIn(['--verbose']), false, 'and nothing else turns the guard off');

console.log('\n=== issue #2164: the guard rides along with router isolation only ===');

const startArgsFor = ({ useRouter, args = [] }) =>
  buildDockerIsolationStartArgs('solve', args, {
    sessionId: 'session-guard',
    tool: 'claude',
    env: { HIVE_MIND_ROUTER_SIDECAR: '1' },
    homeDir: hooksHome,
    existsSync: () => true,
    useRouter,
    routerToken: useRouter ? 'la_sk_test' : null,
  });

const routed = startArgsFor({ useRouter: true });
assertEqual(routed.includes('GIT_CONFIG_KEY_0=core.hooksPath'), true, 'a routed task is pointed at the mounted hook');
assertEqual(routed.includes(`GIT_CONFIG_VALUE_0=${GIT_PUSH_GUARD_CONTAINER_DIR}`), true, 'at the mounted location');
assertEqual(
  routed.some(arg => arg === `${path.join(hooksHome, '.hive-mind', 'git-hooks')}:${GIT_PUSH_GUARD_CONTAINER_DIR}:ro`),
  true,
  'and the hook is mounted read-only, so the task cannot rewrite the rule it is held to'
);
assertEqual(routed.includes(`${GIT_PUSH_GUARD_ESCAPE_ENV}=1`), false, 'without the opt-in the escape hatch is absent');
assertEqual(startArgsFor({ useRouter: true, args: ['--allow-fork-divergence-resolution-using-force-push-with-lease'] }).includes(`${GIT_PUSH_GUARD_ESCAPE_ENV}=1`), true, 'an explicit force-push opt-in is carried into the container');

const direct = startArgsFor({ useRouter: false });
assertEqual(
  direct.some(arg => String(arg).startsWith('GIT_CONFIG_')),
  false,
  'a default run keeps the current mechanics untouched (R9)'
);
assertEqual(
  direct.some(arg => String(arg).endsWith(':ro')),
  false,
  'and gains no extra mounts'
);

fs.rmSync(workspace, { recursive: true, force: true });

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
