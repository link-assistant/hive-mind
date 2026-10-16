#!/usr/bin/env node
/**
 * Issue #2293 (item 3): a workspace kept inside a task container drops its
 * regenerable build caches (Cargo `target/`, `node_modules/.cache`) once the
 * work is committed and pushed, and keeps them otherwise.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pruneKeptWorkspaceCaches } from '../src/workspace-cache-prune.lib.mjs';
import { CACHEDIR_TAG_SIGNATURE } from '../src/kill-recovery-snapshot-cleanup.lib.mjs';

const CONTAINER = { HIVE_MIND_PARENT_SESSION_ID: 'session-2293' };
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

/** A pushed clone with a Cargo `target/`, a `node_modules/.cache` and an untagged `build/`. */
async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'workspace-cache-prune-2293-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = join(root, 'remote.git');
  const clone = join(root, 'clone');
  execFileSync('git', ['init', '-q', '--bare', remote], { timeout: 30_000 });
  execFileSync('git', ['init', '-q', '-b', 'issue-2293-abc', clone], { timeout: 30_000 });
  writeFileSync(join(clone, 'Cargo.toml'), '[package]\nname = "x"\n');
  writeFileSync(join(clone, '.gitignore'), 'target/\nnode_modules/\nbuild/\n');
  git(clone, 'add', '.');
  git(clone, 'commit', '-q', '-m', 'init');
  git(clone, 'remote', 'add', 'origin', remote);
  git(clone, 'push', '-q', '-u', 'origin', 'issue-2293-abc');
  mkdirSync(join(clone, 'target', 'debug'), { recursive: true });
  writeFileSync(join(clone, 'target', 'CACHEDIR.TAG'), `${CACHEDIR_TAG_SIGNATURE}\n`);
  writeFileSync(join(clone, 'target', 'debug', 'big.rlib'), Buffer.alloc(64 * 1024));
  mkdirSync(join(clone, 'node_modules', '.cache', 'babel'), { recursive: true });
  writeFileSync(join(clone, 'node_modules', '.cache', 'babel', 'x.json'), '{}');
  mkdirSync(join(clone, 'build'));
  writeFileSync(join(clone, 'build', 'out.bin'), 'not tagged');
  return clone;
}

test('a clean, pushed workspace in a task container loses its tagged caches only', async t => {
  const clone = await workspace(t);
  const result = await pruneKeptWorkspaceCaches(clone, { env: CONTAINER });
  assert.equal(result.reason, null);
  assert.equal(result.pruned, true);
  assert.deepEqual(result.paths.sort(), [join(clone, 'node_modules', '.cache'), join(clone, 'target')]);
  assert.ok(result.freedBytes >= 64 * 1024, `freed ${result.freedBytes}`);
  assert.equal(existsSync(join(clone, 'target')), false);
  assert.equal(existsSync(join(clone, 'node_modules', '.cache')), false);
  assert.equal(existsSync(join(clone, 'node_modules')), true, 'only the cache under node_modules goes');
  assert.equal(existsSync(join(clone, 'build', 'out.bin')), true, 'an untagged directory stays');
  assert.equal(existsSync(join(clone, 'Cargo.toml')), true);
  assert.equal(git(clone, 'status', '--porcelain'), '');
});

test('uncommitted changes, unpushed commits or a missing upstream keep the caches', async t => {
  const dirty = await workspace(t);
  writeFileSync(join(dirty, 'src.rs'), 'fn main() {}');
  assert.equal((await pruneKeptWorkspaceCaches(dirty, { env: CONTAINER })).reason, 'the workspace has uncommitted changes');
  assert.equal(existsSync(join(dirty, 'target')), true);

  const ahead = await workspace(t);
  writeFileSync(join(ahead, 'src.rs'), 'fn main() {}');
  git(ahead, 'add', 'src.rs');
  git(ahead, 'commit', '-q', '-m', 'local');
  assert.equal((await pruneKeptWorkspaceCaches(ahead, { env: CONTAINER })).reason, '1 commit is not pushed to origin/issue-2293-abc');
  assert.equal(existsSync(join(ahead, 'target')), true);

  const detached = await workspace(t);
  git(detached, 'branch', '--unset-upstream');
  assert.equal((await pruneKeptWorkspaceCaches(detached, { env: CONTAINER })).reason, 'the branch has no upstream');
  assert.equal(existsSync(join(detached, 'target')), true);
});

test('outside a task container, or kept for a resume, nothing is checked or pruned', async () => {
  const calls = [];
  const run = async (...args) => {
    calls.push(args);
    return { stdout: '' };
  };
  assert.equal((await pruneKeptWorkspaceCaches('/nowhere', { env: {}, run })).reason, 'not a Docker-isolated task');
  assert.equal((await pruneKeptWorkspaceCaches('/nowhere', { env: CONTAINER, limitReached: true, run })).reason, 'the workspace is kept for a resume');
  assert.deepEqual(calls, []);
});

test('the kept-workspace step passes the run state to the prune, and a failing prune is not fatal', async () => {
  const { cleanupKeptWorkspaceCaches } = await import('../src/solve.cleanup.lib.mjs');
  await cleanupKeptWorkspaceCaches('/nowhere', {}, false, {
    prune: async () => {
      throw new Error('boom');
    },
  });
  let seen = null;
  await cleanupKeptWorkspaceCaches('/w', { autoCleanup: false }, true, {
    prune: async (dir, options) => {
      seen = { dir, ...options };
      return { pruned: false, freedBytes: 0, paths: [], reason: 'the workspace is kept for a resume' };
    },
  });
  assert.deepEqual(seen, { dir: '/w', argv: { autoCleanup: false }, limitReached: true });
});
