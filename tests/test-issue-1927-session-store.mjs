#!/usr/bin/env node
/**
 * Unit tests for the durable session store (issue #1927, requirements #2 & #4).
 *
 * The session monitor used to keep its registry purely in memory, so a bot
 * restart orphaned every detached /solve. This store persists the plain-data
 * subset of each tracked session to `sessions.json` (atomically rewritten — the
 * source of truth for resume) and appends every track/complete to an
 * append-only `sessions-events.jsonl` audit log that is NEVER truncated (req #4:
 * "no data should be destroyed").
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createSessionStore, serializeSessionInfo, deserializeSessionInfo, resolveBotStateDir } from '../src/session-store.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: durable session store');
console.log('='.repeat(60));

// --- resolveBotStateDir -------------------------------------------------------
assert(resolveBotStateDir({ HIVE_MIND_STATE_DIR: '/custom/state' }) === '/custom/state', 'resolveBotStateDir honors HIVE_MIND_STATE_DIR');
assert(resolveBotStateDir({}, () => '/home/bob') === path.join('/home/bob', '.hive-mind', 'state'), 'resolveBotStateDir falls back to <home>/.hive-mind/state');
assert(resolveBotStateDir({ HIVE_MIND_STATE_DIR: '  ' }, () => '/home/bob').endsWith(path.join('.hive-mind', 'state')), 'resolveBotStateDir ignores a blank HIVE_MIND_STATE_DIR');

// --- serialize / deserialize --------------------------------------------------
const startTime = new Date('2026-06-14T19:00:00.000Z');
const serialized = serializeSessionInfo({
  chatId: 5,
  messageId: 7,
  startTime,
  url: 'https://github.com/acme/widgets/issues/42',
  command: 'solve',
  isolationBackend: 'screen',
  sessionId: 'uuid-1',
  containerFilesystemStartBytes: 123456,
  tool: 'claude',
  logPath: '/var/log/session.log',
  // runtime-only fields that must NOT be persisted:
  bot: { telegram: {} },
  limitsSnapshot: { foo: 'bar' },
});
assert(serialized.startTime === '2026-06-14T19:00:00.000Z', 'serializeSessionInfo converts startTime to an ISO string');
assert(serialized.logPath === '/var/log/session.log', 'serializeSessionInfo keeps logPath (needed for footer recovery on resume)');
assert(serialized.containerFilesystemStartBytes === 123456, 'serializeSessionInfo keeps docker filesystem start size');
assert(!('bot' in serialized) && !('limitsSnapshot' in serialized), 'serializeSessionInfo drops runtime-only fields (bot, limitsSnapshot)');

const round = deserializeSessionInfo(serialized);
assert(round.startTime instanceof Date && round.startTime.getTime() === startTime.getTime(), 'deserializeSessionInfo rehydrates startTime back to a Date');

// --- persist / load / remove (real filesystem) --------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-store-'));
try {
  let clock = new Date('2026-06-14T19:00:00.000Z');
  const store = createSessionStore({ dir: tmpDir, now: () => clock });

  assert(store.snapshotPath === path.join(tmpDir, 'sessions.json'), 'snapshotPath is <dir>/sessions.json');
  assert(store.eventsPath === path.join(tmpDir, 'sessions-events.jsonl'), 'eventsPath is <dir>/sessions-events.jsonl');

  store.persist('uuid-1', { chatId: 5, messageId: 7, startTime, url: 'https://github.com/acme/widgets/issues/42', command: 'solve', isolationBackend: 'screen', sessionId: 'uuid-1', logPath: '/var/log/s1.log' });
  clock = new Date('2026-06-14T19:01:00.000Z');
  store.persist('uuid-2', { chatId: 6, startTime, url: 'https://github.com/acme/widgets/issues/43', command: 'hive', isolationBackend: 'docker', sessionId: 'uuid-2', containerFilesystemStartBytes: 234567 });

  assert(fs.existsSync(store.snapshotPath), 'persist writes sessions.json');
  const snapshot = JSON.parse(fs.readFileSync(store.snapshotPath, 'utf8'));
  assert(snapshot.version === 1, 'snapshot carries a version');
  assert(Object.keys(snapshot.sessions).length === 2, 'snapshot holds both persisted sessions');
  assert(snapshot.sessions['uuid-1'].persistedAt === '2026-06-14T19:00:00.000Z', 'persist stamps persistedAt from the injected clock');

  const loaded = store.load();
  assert(loaded.length === 2, 'load returns both sessions');
  const one = loaded.find(s => s.sessionName === 'uuid-1');
  assert(one && one.sessionInfo.startTime instanceof Date, 'load rehydrates startTime to a Date');
  assert(one.sessionInfo.logPath === '/var/log/s1.log', 'load round-trips logPath');
  const two = loaded.find(s => s.sessionName === 'uuid-2');
  assert(two.sessionInfo.containerFilesystemStartBytes === 234567, 'load round-trips docker filesystem start size');

  // Remove one (completion) — it leaves the snapshot but the OTHER stays.
  clock = new Date('2026-06-14T19:10:49.822Z');
  store.remove('uuid-1', { status: 'killed', exitCode: 137 });
  const afterRemove = JSON.parse(fs.readFileSync(store.snapshotPath, 'utf8'));
  assert(!('uuid-1' in afterRemove.sessions), 'remove deletes the session from the snapshot');
  assert('uuid-2' in afterRemove.sessions, 'remove leaves other sessions intact');

  // The append-only audit log preserves the FULL history (req #4: no data destroyed).
  const events = fs
    .readFileSync(store.eventsPath, 'utf8')
    .trim()
    .split('\n')
    .map(l => JSON.parse(l));
  assert(events.length === 3, 'events log has 3 entries (2 track + 1 complete)');
  assert(events[0].type === 'track' && events[0].sessionName === 'uuid-1', 'first event is the uuid-1 track');
  assert(events[0].ts === '2026-06-14T19:00:00.000Z', 'track event carries a timestamp (req #3)');
  const complete = events.find(e => e.type === 'complete');
  assert(complete.sessionName === 'uuid-1' && complete.status === 'killed' && complete.exitCode === 137, 'complete event records the terminal status and exit code 137');
  assert(complete.ts === '2026-06-14T19:10:49.822Z', 'complete event carries the end timestamp');

  // A second remove of an already-removed session still records an audit event
  // (history is append-only) but does not corrupt the snapshot.
  store.remove('uuid-1', { status: 'killed', exitCode: 137 });
  const eventsAfter = fs.readFileSync(store.eventsPath, 'utf8').trim().split('\n');
  assert(eventsAfter.length === 4, 'a redundant remove still appends an audit event (never truncates)');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// --- corrupt snapshot is non-fatal --------------------------------------------
const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-store2-'));
try {
  fs.writeFileSync(path.join(tmpDir2, 'sessions.json'), '{ this is not valid json ');
  const store = createSessionStore({ dir: tmpDir2 });
  assert(Array.isArray(store.load()) && store.load().length === 0, 'load() on a corrupt snapshot returns [] (never throws)');
  // persist over the corrupt file recovers cleanly.
  store.persist('uuid-x', { startTime, isolationBackend: 'screen', sessionId: 'uuid-x', command: 'solve' });
  assert(store.load().length === 1, 'persist recovers from a corrupt snapshot');
} finally {
  fs.rmSync(tmpDir2, { recursive: true, force: true });
}

// --- persistence disabled on unwritable dir (never throws) --------------------
{
  const throwingFs = {
    mkdirSync: () => {
      throw new Error('EACCES: permission denied');
    },
    readFileSync: () => {
      throw new Error('ENOENT');
    },
    writeFileSync: () => {
      throw new Error('EACCES');
    },
    renameSync: () => {
      throw new Error('EACCES');
    },
    appendFileSync: () => {
      throw new Error('EACCES');
    },
  };
  const store = createSessionStore({ dir: '/nonexistent/forbidden', fsImpl: throwingFs });
  // Must not throw even though every fs op fails.
  store.persist('uuid-z', { startTime, isolationBackend: 'screen', sessionId: 'uuid-z' });
  store.remove('uuid-z', { status: 'killed', exitCode: 137 });
  assert(store.disabled === true, 'store disables itself when the state dir cannot be created');
  assert(store.load().length === 0, 'a disabled store loads nothing instead of throwing');
}

// --- ignored sessionName guard ------------------------------------------------
{
  const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-store3-'));
  try {
    const store = createSessionStore({ dir: tmpDir3 });
    store.persist('', { startTime, isolationBackend: 'screen', sessionId: 'x' });
    assert(store.load().length === 0, 'persist("") is a no-op (no empty session name persisted)');
  } finally {
    fs.rmSync(tmpDir3, { recursive: true, force: true });
  }
}

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
