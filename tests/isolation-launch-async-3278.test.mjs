#!/usr/bin/env node
/**
 * Issue #3278: the bot builds a Docker-isolated task's start command while it
 * serves Telegram updates, so the host path probes, the host-path preparation
 * and the push-guard install no longer use synchronous fs calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { installGitPushGuard } from '../src/git-push-guard.lib.mjs';
import { getDockerIsolationAuthMounts, prepareDockerIsolationHostPaths } from '../src/isolation-runner.lib.mjs';
import { getRouterCredentialMounts } from '../src/router-sidecar.lib.mjs';

const SYNC_NAMES = ['existsSync', 'statSync', 'accessSync', 'mkdirSync', 'writeFileSync', 'chmodSync', 'readFileSync'];

const countingFs = () => {
  const syncCalls = [];
  const fsImpl = { ...fs, promises: fs.promises };
  for (const name of SYNC_NAMES) {
    fsImpl[name] = (...args) => {
      syncCalls.push(name);
      return fs[name](...args);
    };
  }
  return { syncCalls, fsImpl };
};

const withDir = async fn => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-3278-launch-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('installGitPushGuard writes an executable hook without synchronous fs calls', async () => {
  await withDir(async homeDir => {
    const { syncCalls, fsImpl } = countingFs();
    const pending = installGitPushGuard({ env: {}, homeDir, fsImpl });
    assert.ok(pending instanceof Promise, 'the install is asynchronous');
    const result = await pending;
    assert.equal(result.installed, true);
    assert.deepEqual(syncCalls, []);
    assert.equal(fs.statSync(result.hookPath).mode & 0o111, 0o111, 'the hook stays executable');
  });
});

test('prepareDockerIsolationHostPaths creates missing tool directories without synchronous fs calls', async () => {
  await withDir(async homeDir => {
    const { syncCalls, fsImpl } = countingFs();
    const result = await prepareDockerIsolationHostPaths({ tool: 'claude', homeDir, fsImpl });
    assert.deepEqual(syncCalls, []);
    assert.ok(result.created.length > 0, 'the missing tool directories were created');
    for (const created of result.created) assert.ok(fs.existsSync(created), `${created} exists`);
  });
});

test('host credential probes resolve asynchronously and only mount what exists', async () => {
  await withDir(async homeDir => {
    fs.mkdirSync(path.join(homeDir, '.claude'));
    fs.writeFileSync(path.join(homeDir, '.gitconfig'), '[user]\n\tname = t\n');
    const routerMounts = getRouterCredentialMounts({ homeDir });
    assert.ok(routerMounts instanceof Promise, 'the router credential probe is asynchronous');
    assert.deepEqual(
      (await routerMounts).map(mount => mount.home),
      ['.claude']
    );
    const authMounts = getDockerIsolationAuthMounts({ tool: 'claude', env: {}, homeDir });
    assert.ok(authMounts instanceof Promise, 'the Docker auth mount probe is asynchronous');
    const mounts = JSON.stringify(await authMounts);
    assert.ok(mounts.includes(path.join(homeDir, '.gitconfig')), 'the existing ~/.gitconfig is mounted');
    assert.ok(!mounts.includes(path.join(homeDir, '.config', 'gh')), 'the missing gh config directory is skipped');
  });
});
