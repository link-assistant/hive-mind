/**
 * @hive-mind-test-suite default
 *
 * Issue #4091 (criteria d and h): every wait after the final log has a deadline
 * and a heartbeat.
 *
 *  - A wait that never ends: the watchdog logs the pending operation and
 *    decides on its own (`withWatchdog`, and the watch loop's stall guard).
 *  - A 100+ MB log upload: the sanitize pass took 34 minutes with one line of
 *    output in the incident. Progress lines must now appear at least every 60 s.
 *
 * Time is a fake clock: nothing here sleeps for real.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_HEARTBEAT_MS, formatElapsed, startHeartbeat, withWatchdog } from '../src/wait-watchdog.lib.mjs';
import { WATCH_CHECK_DEADLINE_MS, WATCH_STALLED_CHECKS_LIMIT, createWatchStallGuard } from '../src/solve.watch-progress.lib.mjs';
import { LOG_SANITIZE_DEADLINE_MS, LOG_UPLOAD_ATTEMPT_DEADLINE_MS, describeSanitizeProgress, uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';

const T0 = Date.parse('2026-11-19T03:00:00Z');
const MB = 1024 * 1024;

/** A fake clock whose timers fire, in order, only when the test advances it. */
const createFakeClock = (start = T0) => {
  let now = start;
  let nextId = 1;
  const timers = new Map();
  const flush = async () => {
    for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  };
  const clock = {
    now: () => now,
    timers: {
      setInterval: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, at: now + ms, every: ms });
        return id;
      },
      clearInterval: id => timers.delete(id),
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, at: now + ms, every: null });
        return id;
      },
      clearTimeout: id => timers.delete(id),
    },
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        await timer.fn();
        await flush();
      }
      now = target;
      await flush();
    },
    pending: () => timers.size,
  };
  return clock;
};

const isoOf = line => Date.parse(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/.exec(line)?.[1] ?? NaN);

test('heartbeat: a line every 30 s with elapsed time, progress detail and the deadline', async () => {
  const clock = createFakeClock();
  const lines = [];
  let done = 0;
  const heartbeat = startHeartbeat({ name: 'uploading the log', log: async line => lines.push(line), deadlineAt: T0 + 45 * 60 * 1000, describe: async () => `${(done += 10)} MB of 114 MB`, now: clock.now, timers: clock.timers });
  await clock.advance(95_000);
  heartbeat.stop();
  await clock.advance(60_000);
  assert.equal(DEFAULT_HEARTBEAT_MS, 30_000);
  assert.equal(lines.length, 3, 'beats at 30, 60 and 90 s, none after stop');
  assert.match(lines[0], /💓 2026-11-19T03:00:30\.000Z uploading the log: running for 30s \(10 MB of 114 MB\) — deadline 2026-11-19T03:45:00\.000Z/);
  assert.match(lines[2], /running for 1m 30s \(30 MB of 114 MB\)/);
  assert.equal(clock.pending(), 0);
});

test('(d) a never-ending wait: the watchdog logs the pending operation and returns its own decision', async () => {
  const clock = createFakeClock();
  const lines = [];
  const never = new Promise(() => {});
  const resultPromise = withWatchdog('waiting for GitHub', () => never, {
    log: async line => lines.push(line),
    deadlineMs: 10 * 60 * 1000,
    describe: async () => 'GET /repos/o/r/pulls/7',
    onTimeout: async ({ elapsedMs }) => ({ decision: `skip this check after ${elapsedMs / 60000} min`, value: 'skipped' }),
    now: clock.now,
    timers: clock.timers,
  });
  await clock.advance(10 * 60 * 1000);
  const result = await resultPromise;
  assert.deepEqual(result, { timedOut: true, decision: 'skip this check after 10 min', value: 'skipped' });
  const heartbeats = lines.filter(line => line.includes('💓'));
  assert.equal(heartbeats.length, 20, 'one heartbeat every 30 s up to the deadline');
  const pending = lines.find(line => line.includes('Watchdog: "waiting for GitHub" is still pending'));
  assert.ok(pending, lines.join('\n'));
  assert.match(pending, /after 10m 0s \(started 2026-11-19T03:00:00\.000Z, deadline 2026-11-19T03:10:00\.000Z, last progress: GET \/repos\/o\/r\/pulls\/7\)/);
  assert.match(lines.at(-1), /Watchdog decision for "waiting for GitHub": skip this check after 10 min/);
  assert.equal(clock.pending(), 0, 'no timer is left behind');
});

test('withWatchdog returns the value of an operation that settles in time and stops its timers', async () => {
  const clock = createFakeClock();
  const lines = [];
  const result = await withWatchdog('quick', async () => 42, { log: async line => lines.push(line), deadlineMs: 1000, now: clock.now, timers: clock.timers });
  assert.deepEqual(result, { timedOut: false, value: 42 });
  assert.equal(clock.pending(), 0);
  assert.deepEqual(lines, []);
});

test('(d) the watch loop stall guard: a hung GitHub probe is skipped, then monitoring stops with a decision', async () => {
  const clock = createFakeClock();
  const lines = [];
  const guard = createWatchStallGuard({ log: async line => lines.push(line), watchdogOptions: { now: clock.now, timers: clock.timers } });
  assert.equal(guard.deadlineMs, WATCH_CHECK_DEADLINE_MS);
  const hung = () => new Promise(() => {});
  let parked = 0;
  for (let check = 1; check < WATCH_STALLED_CHECKS_LIMIT; check++) {
    const probe = guard.probeCheck(check, hung, async () => parked++);
    const settled = probe.then(
      () => 'resolved',
      error => error
    );
    await clock.advance(WATCH_CHECK_DEADLINE_MS);
    const outcome = await settled;
    assert.ok(outcome instanceof Error, 'a single stall throws: the loop logs "Check failed" and retries');
    assert.match(outcome.message, new RegExp(`GitHub did not answer check #${check} in time \\(stalled ${check} time\\(s\\) in a row\\)`));
  }
  const last = guard.probeCheck(WATCH_STALLED_CHECKS_LIMIT, hung);
  await clock.advance(WATCH_CHECK_DEADLINE_MS);
  assert.deepEqual(await last, { stop: true, message: `${WATCH_STALLED_CHECKS_LIMIT} monitoring checks in a row got no answer from GitHub within 10 minutes each.` });
  assert.equal(parked, 0, 'the post-probe park only runs after an answered probe');
  assert.ok(lines.some(line => /Watchdog decision for "check #3: reading merge blockers": stop monitoring: 3 checks in a row got no answer/.test(line)));
  assert.ok(lines.some(line => /skip this check \(1\/3 stalled in a row\)/.test(line)));

  // An answered probe resets the streak.
  const answered = await guard.probeCheck(
    4,
    async () => ({ blockers: [] }),
    async () => parked++
  );
  assert.deepEqual(answered, { stop: false, value: { blockers: [] } });
  assert.equal(parked, 1);
  assert.equal(guard.stalledChecks(), 0);
});

test('(h) a 100+ MB log upload prints a progress line at least every 60 s', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-4091-upload-'));
  const logFile = path.join(dir, 'solve.log');
  const SIZE = 114 * MB;
  // A sparse file: the size is real, the disk use is not.
  await fs.writeFile(logFile, '');
  await fs.truncate(logFile, SIZE);
  const clock = createFakeClock();
  const lines = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  const capture = (...args) => lines.push({ at: clock.now(), text: args.join(' ') });
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  let result;
  try {
    const upload = uploadLogWithGhUploadLog({
      logFile,
      isPublic: false,
      description: 'solve log',
      sleep: async () => {},
      // The incident: 34 minutes of sanitizing. The fake sanitizer writes its output in steps.
      sanitize: async ({ destPath }) => {
        await fs.writeFile(destPath, '');
        for (let minute = 1; minute <= 34; minute++) {
          await clock.advance(60_000);
          await fs.truncate(destPath, Math.floor((SIZE * minute) / 34));
        }
        return { sourceSize: SIZE, blocks: 114, forcedReleases: 0, worker: true };
      },
      // Then 12 minutes of git push.
      runUpload: async () => {
        await clock.advance(12 * 60_000);
        return { code: 0, stdout: '✅ Uploaded\n🔗 https://github.com/o/logs/tree/main/solve.log\n', stderr: '' };
      },
      watch: { now: clock.now, timers: clock.timers },
    });
    result = await upload;
  } finally {
    Object.assign(console, original);
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.equal(result.success, true, JSON.stringify(result));
  const progress = lines.filter(line => line.text.includes('💓'));
  assert.ok(progress.length >= 90, `expected a heartbeat every 30 s over 46 minutes, got ${progress.length}`);
  // Gaps between progress lines, measured on the fake clock from the start of the upload.
  const times = [T0, ...progress.map(line => isoOf(line.text)), clock.now()];
  const maxGap = Math.max(...times.slice(1).map((time, i) => time - times[i]));
  assert.ok(maxGap <= 60_000, `largest gap between progress lines: ${maxGap / 1000}s`);
  const sanitizeLines = progress.filter(line => line.text.includes('sanitizing the log'));
  assert.ok(sanitizeLines.length >= 60);
  assert.match(sanitizeLines.at(-1).text, /MB of 114\.0 MB sanitized \(\d+%\)\) — deadline 2026-11-19T04:00:00\.000Z/);
  assert.ok(progress.some(line => /uploading the log \(attempt 1\/3\): running for 11m 30s — deadline/.test(line.text)));
});

test('(h) an upload attempt that never finishes is given up at its deadline instead of hanging', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-4091-upload-'));
  const logFile = path.join(dir, 'solve.log');
  await fs.writeFile(logFile, 'line\n'.repeat(100));
  const clock = createFakeClock();
  const lines = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...args) => lines.push(args.join(' '));
  let result;
  let attempts = 0;
  let attemptStarted;
  const nextAttempt = () => new Promise(resolve => (attemptStarted = resolve));
  try {
    let started = nextAttempt();
    const upload = uploadLogWithGhUploadLog({
      logFile,
      isPublic: false,
      description: 'solve log',
      sleep: async () => {},
      retryDelaysMs: [],
      sanitize: async ({ sourcePath, destPath }) => (await fs.copyFile(sourcePath, destPath), { sourceSize: 500, blocks: 1 }),
      runUpload: () => {
        attempts++;
        attemptStarted();
        return new Promise(() => {});
      },
      watch: { now: clock.now, timers: clock.timers, attemptDeadlineMs: 5 * 60_000 },
    });
    // Each attempt hangs forever; the clock runs past its deadline once it started.
    const settled = upload.then(value => (result = value));
    while (!result) {
      await Promise.race([started, settled]);
      if (result) break;
      started = nextAttempt();
      await clock.advance(5 * 60_000);
    }
  } finally {
    Object.assign(console, original);
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.equal(result.success, false);
  assert.match(result.failureReason || '', /did not finish within 5m/);
  assert.ok(lines.some(line => /Watchdog: "uploading the log \(attempt 1\/1\)" is still pending after 5m 0s/.test(line)));
  assert.ok(lines.some(line => /give up this upload \(the session continues without it\)/.test(line)));
  assert.ok(attempts >= 1);
  assert.equal(clock.pending(), 0, 'no timer is left behind');
  assert.ok(LOG_UPLOAD_ATTEMPT_DEADLINE_MS > 0 && LOG_SANITIZE_DEADLINE_MS > 0 && LOG_SANITIZE_DEADLINE_MS <= 60 * 60_000);
});

test('formatElapsed shows seconds below one hour', () => {
  assert.equal(formatElapsed(30_000), '30s');
  assert.equal(formatElapsed(90_000), '1m 30s');
  assert.equal(formatElapsed(10 * 60_000), '10m 0s');
  assert.equal(formatElapsed(2 * 3600_000 + 5 * 60_000), '2h 5m');
});

test('describeSanitizeProgress', () => {
  assert.equal(describeSanitizeProgress(57 * MB, 114 * MB), '57.0 MB of 114.0 MB sanitized (50%)');
  assert.equal(describeSanitizeProgress(0, 0), '0.0 MB of 0.0 MB sanitized (0%)');
});
