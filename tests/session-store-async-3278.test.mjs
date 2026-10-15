#!/usr/bin/env node
/**
 * Issue #3278: the bot persists a session while it serves Telegram updates, so
 * the session snapshot is written off the event loop. `flush()` waits for it and
 * `flushSync()` (the exit handler) still writes whatever is pending.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSessionStore } from '../src/session-store.lib.mjs';

const startTime = new Date('2026-06-14T18:00:00.000Z');

const countingFs = () => {
  const syncCalls = [];
  const wrap =
    name =>
    (...args) => {
      syncCalls.push(name);
      return fs[name](...args);
    };
  return { syncCalls, fsImpl: { ...fs, mkdirSync: wrap('mkdirSync'), readFileSync: wrap('readFileSync'), writeFileSync: wrap('writeFileSync'), renameSync: wrap('renameSync'), appendFileSync: wrap('appendFileSync'), promises: fs.promises } };
};

const withDir = async fn => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-3278-store-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('persist, remove and load make no synchronous fs call', async () => {
  await withDir(async dir => {
    const { syncCalls, fsImpl } = countingFs();
    const store = createSessionStore({ dir, fsImpl });
    store.persist('uuid-1', { startTime, isolationBackend: 'screen', sessionId: 'uuid-1', command: 'solve' });
    store.persist('uuid-2', { startTime, isolationBackend: 'screen', sessionId: 'uuid-2', command: 'solve' });
    store.remove('uuid-1', { status: 'done', exitCode: 0 });
    const loaded = await store.load();
    await store.flush();
    assert.deepEqual(syncCalls, []);
    assert.deepEqual(
      loaded.map(entry => entry.sessionName),
      ['uuid-2'],
      'load() sees every update recorded before it'
    );
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(store.snapshotPath, 'utf8')).sessions), ['uuid-2']);
  });
});

test('flushSync() writes a pending snapshot update before the process exits', async () => {
  await withDir(async dir => {
    const store = createSessionStore({ dir });
    store.persist('uuid-exit', { startTime, isolationBackend: 'screen', sessionId: 'uuid-exit', command: 'solve' });
    store.flushSync();
    assert.ok('uuid-exit' in JSON.parse(fs.readFileSync(store.snapshotPath, 'utf8')).sessions, 'the pending persist is on disk');
    store.remove('uuid-exit', { status: 'done', exitCode: 0 });
    assert.ok(!('uuid-exit' in JSON.parse(fs.readFileSync(store.snapshotPath, 'utf8')).sessions), 'after flushSync() updates are written synchronously');
    await store.flush();
  });
});
