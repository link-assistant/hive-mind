#!/usr/bin/env node
/**
 * Docker-isolated Rust tasks must share compiler outputs without sharing their
 * project target/ trees.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2100
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDockerIsolationStartArgs, getDockerIsolationSccacheConfig } from '../src/isolation-runner.lib.mjs';

const cacheSource = '/var/cache/hive-mind/sccache';
const homeDir = '/home/box';
const existsSync = candidate => candidate === cacheSource;

const enabledEnv = {
  HIVE_MIND_SCCACHE_DIR: cacheSource,
  HIVE_MIND_SCCACHE_SIZE: '20G',
};

const config = getDockerIsolationSccacheConfig({ env: enabledEnv, existsSync });
assert.deepEqual(config, {
  enabled: true,
  source: cacheSource,
  target: '/var/cache/hive-mind/sccache',
  maxSize: '20G',
});

function startArgs(sessionId, env = enabledEnv) {
  return buildDockerIsolationStartArgs('solve', ['https://github.com/example/rust/issues/1'], {
    sessionId,
    tool: 'codex',
    env,
    homeDir,
    existsSync,
  });
}

const firstTask = startArgs('rust-task-one');
const secondTask = startArgs('rust-task-two');

for (const args of [firstTask, secondTask]) {
  assert.ok(args.includes(`${cacheSource}:/var/cache/hive-mind/sccache`), 'task mounts the host-owned compiler cache, outside its workspace');
  assert.ok(args.includes('RUSTC_WRAPPER=hive-mind-sccache'), 'Cargo automatically discovers the path-normalizing sccache wrapper');
  assert.ok(args.includes('SCCACHE_DIR=/var/cache/hive-mind/sccache'), 'sccache uses the shared compiler-output directory');
  assert.ok(args.includes('SCCACHE_CACHE_SIZE=20G'), 'cache eviction is bounded by the configured size');
  assert.ok(!args.some(value => value.includes('target')), 'project target/ directories are never shared');
}

assert.equal(
  firstTask.find(value => value.endsWith(':/var/cache/hive-mind/sccache')),
  secondTask.find(value => value.endsWith(':/var/cache/hive-mind/sccache')),
  'independent task containers use the same compiler cache'
);

const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), 'hive-mind-sccache-test-'));
try {
  const repository = path.join(fixtureRoot, 'checkout-with-random-name');
  const nestedDirectory = path.join(repository, 'crate', 'src');
  const fakeBin = path.join(fixtureRoot, 'bin');
  mkdirSync(nestedDirectory, { recursive: true });
  mkdirSync(fakeBin);
  assert.equal(spawnSync('git', ['init', '-q', repository]).status, 0);

  const fakeSccache = path.join(fakeBin, 'sccache');
  writeFileSync(fakeSccache, '#!/bin/sh\nprintf "%s" "$SCCACHE_BASEDIRS"\n');
  chmodSync(fakeSccache, 0o755);
  const wrapper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'hive-mind-sccache');
  const wrapped = spawnSync(wrapper, ['rustc', '--version'], {
    cwd: nestedDirectory,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  assert.equal(wrapped.status, 0);
  assert.equal(wrapped.stdout, repository, 'wrapper normalizes independent temporary checkout paths to their Git roots');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}

const disabledEnv = {
  ...enabledEnv,
  HIVE_MIND_SCCACHE: '0',
};
const disabledConfig = getDockerIsolationSccacheConfig({ env: disabledEnv, existsSync });
assert.equal(disabledConfig.enabled, false, 'projects/operators can opt out');
const disabledArgs = startArgs('non-rust-task', disabledEnv);
assert.ok(!disabledArgs.some(value => value.includes('SCCACHE') || value.includes('sccache')), 'opted-out and non-Rust tasks receive no sccache configuration');

console.log('Shared sccache regression tests passed.');
