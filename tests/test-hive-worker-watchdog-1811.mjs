#!/usr/bin/env node

/**
 * Unit tests for the parent-side inactivity watchdog used by hive workers.
 *
 * Issue #1811: hive workers can stall silently inside verifyResults when
 * `gh api user` hangs. createWorkerInactivityWatchdog emits warnings,
 * heartbeats and (optionally) SIGTERM/SIGKILL events when the worker emits
 * no stdout/stderr for configurable thresholds.
 *
 * Run with: node tests/test-hive-worker-watchdog-1811.mjs
 *
 * @see docs/case-studies/issue-1811/root-causes.md (RC3)
 */

import assert from 'node:assert/strict';
import { createWorkerInactivityWatchdog } from '../src/hive-worker-watchdog.lib.mjs';

let passed = 0;
let failed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}`);
    console.log(`   ${e.stack || e.message}`);
    failed++;
  }
};

// Fake child process: records kill signals; never spawns anything real.
const makeFakeChild = () => {
  const signals = [];
  return {
    signals,
    kill: signal => {
      signals.push(signal);
      return true;
    },
  };
};

// Helper that exposes a tick-by-tick controllable clock.
const makeClock = startMs => {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance: ms => {
      nowMs += ms;
    },
    set: ms => {
      nowMs = ms;
    },
  };
};

await test('does not warn or kill when activity is regular', async () => {
  const child = makeFakeChild();
  const clock = makeClock(0);
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 1000,
    killMs: 2000,
    tickMs: 10,
    now: clock.now,
    onEvent: (msg, meta) => events.push({ kind: meta.kind, msg }),
  });

  // Simulate steady activity every 200 (virtual) ms over a 5000ms window.
  for (let i = 0; i < 25; i++) {
    clock.advance(200);
    watchdog.markActivity(`line ${i}`);
  }
  // Let the interval tick a couple of real times to confirm no events fire.
  await new Promise(r => setTimeout(r, 30));
  watchdog.stop();

  assert.equal(events.length, 0);
  assert.deepEqual(child.signals, []);
});

await test('emits exactly one warning event per warn window', async () => {
  const child = makeFakeChild();
  const clock = makeClock(0);
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 1000,
    killMs: 0,
    tickMs: 10,
    now: clock.now,
    onEvent: (msg, meta) => events.push({ kind: meta.kind, silentMs: meta.silentMs }),
  });

  // Worker emits one line, then goes silent for 1500ms (past warnMs).
  watchdog.markActivity('first line');
  clock.advance(1500);
  // Give the real setInterval a chance to fire its callback.
  await new Promise(r => setTimeout(r, 30));
  watchdog.stop();

  const warnings = events.filter(e => e.kind === 'warn');
  assert.equal(warnings.length, 1, `expected 1 warning, got ${warnings.length}`);
  assert.ok(warnings[0].silentMs >= 1000);
});

await test('emits a verbose heartbeat before the warn threshold', async () => {
  const child = makeFakeChild();
  const clock = makeClock(0);
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 5000,
    killMs: 0,
    verboseHeartbeatMs: 1000,
    tickMs: 10,
    now: clock.now,
    onEvent: (msg, meta) => events.push({ kind: meta.kind, silentMs: meta.silentMs }),
  });

  watchdog.markActivity('first');
  clock.advance(1200);
  await new Promise(r => setTimeout(r, 30));
  watchdog.stop();

  const heartbeats = events.filter(e => e.kind === 'heartbeat');
  const warnings = events.filter(e => e.kind === 'warn');
  assert.equal(heartbeats.length, 1, 'should emit one heartbeat between verboseHeartbeatMs and warnMs');
  assert.equal(warnings.length, 0, 'should not warn before warnMs');
});

await test('SIGTERMs the child when silence exceeds killMs', async () => {
  const child = makeFakeChild();
  const clock = makeClock(0);
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 1000,
    killMs: 2000,
    killGraceMs: 50,
    tickMs: 10,
    now: clock.now,
    onEvent: (msg, meta) => events.push({ kind: meta.kind }),
  });

  watchdog.markActivity('first');
  clock.advance(2500);
  await new Promise(r => setTimeout(r, 30));

  assert.deepEqual(child.signals, ['SIGTERM']);
  const sigtermEvents = events.filter(e => e.kind === 'sigterm');
  assert.equal(sigtermEvents.length, 1);
  watchdog.stop();
});

await test('escalates to SIGKILL after killGraceMs if child is still alive', async () => {
  const child = makeFakeChild();
  const clock = makeClock(0);
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 1000,
    killMs: 2000,
    killGraceMs: 30, // small for test
    tickMs: 10,
    now: clock.now,
    onEvent: (msg, meta) => events.push({ kind: meta.kind }),
  });

  watchdog.markActivity('first');
  clock.advance(2500);
  // Wait long enough for both the SIGTERM tick and the SIGKILL escalation.
  await new Promise(r => setTimeout(r, 100));
  watchdog.stop();

  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL']);
  const sigkillEvents = events.filter(e => e.kind === 'sigkill');
  assert.equal(sigkillEvents.length, 1);
});

await test('all thresholds zero means watchdog never fires', async () => {
  const child = makeFakeChild();
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 0,
    killMs: 0,
    verboseHeartbeatMs: 0,
    tickMs: 5,
    onEvent: (msg, meta) => events.push({ kind: meta.kind }),
  });
  // Give the (non-)interval some time.
  await new Promise(r => setTimeout(r, 30));
  watchdog.stop();

  assert.equal(events.length, 0);
  assert.deepEqual(child.signals, []);
});

await test('markActivity resets the silence window', async () => {
  const child = makeFakeChild();
  const clock = makeClock(0);
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 1000,
    killMs: 0,
    tickMs: 10,
    now: clock.now,
    onEvent: (msg, meta) => events.push({ kind: meta.kind }),
  });

  watchdog.markActivity('first');
  clock.advance(900); // not yet past warn threshold
  watchdog.markActivity('still alive');
  clock.advance(900); // would be 1800 from first marker, but only 900 from last
  await new Promise(r => setTimeout(r, 30));
  watchdog.stop();

  const warnings = events.filter(e => e.kind === 'warn');
  assert.equal(warnings.length, 0, 'markActivity should have reset the counter');
});

await test('stop() cleans up timers and prevents further events', async () => {
  const child = makeFakeChild();
  const clock = makeClock(0);
  const events = [];
  const watchdog = createWorkerInactivityWatchdog({
    child,
    warnMs: 100,
    killMs: 200,
    tickMs: 10,
    now: clock.now,
    onEvent: (msg, meta) => events.push({ kind: meta.kind }),
  });

  watchdog.markActivity('first');
  clock.advance(500);
  watchdog.stop();
  // After stop(), no further ticks should run.
  await new Promise(r => setTimeout(r, 50));

  // Whatever fired before stop() is fine; the key invariant is no SIGKILL
  // escalation should land after stop().
  assert.equal(child.signals.filter(s => s === 'SIGKILL').length, 0);
});

console.log(`\n📊 ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
