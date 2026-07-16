#!/usr/bin/env node
/**
 * Tests for the durable bot logger (issue #1927, requirements #3 & #4).
 *
 * Req #3: every log line must carry a timestamp so the exact moment of a total
 *         failure (process killed mid-write) can be located afterwards.
 * Req #4: previous bot logs must never be destroyed — a restart preserves the
 *         prior active log under a timestamped backup instead of overwriting it,
 *         and oversized logs rotate the same way mid-run.
 *
 * The logger is fully injectable (fs / clock / console) so these tests run
 * against real temp dirs for the rotation behaviour and an injected fs for the
 * filesystem-failure path.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createBotLogger, resolveBotLogDir, formatLogTimestamp, formatLogLine } from '../src/bot-logger.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: durable bot logger');
console.log('='.repeat(60));

function captureConsole() {
  const lines = [];
  return {
    lines,
    impl: {
      log: m => lines.push(String(m)),
      warn: m => lines.push(String(m)),
      error: m => lines.push(String(m)),
    },
  };
}

// An advancing clock so each call yields a distinct, ordered, ms-resolution Date
// (keeps backup file names unique and deterministic).
function advancingClock(startIso = '2026-06-14T19:00:00.000Z') {
  let tick = Date.parse(startIso);
  return () => new Date(tick++);
}

function listBackups(dir, baseName = 'telegram-bot') {
  return fs
    .readdirSync(dir)
    .filter(n => n.startsWith(`${baseName}-`) && n.endsWith('.log'))
    .sort();
}

// --- resolveBotLogDir ---------------------------------------------------------
assert(resolveBotLogDir({ HIVE_MIND_LOG_DIR: '/custom/logs' }) === '/custom/logs', 'resolveBotLogDir honors HIVE_MIND_LOG_DIR');
assert(resolveBotLogDir({}, () => '/home/bob') === path.join('/home/bob', '.hive-mind', 'logs'), 'resolveBotLogDir falls back to <home>/.hive-mind/logs');

// --- formatLogTimestamp / formatLogLine (req #3: timestamps) ------------------
const D = new Date('2026-06-14T19:10:49.822Z');
assert(formatLogTimestamp(D) === '2026-06-14T19:10:49.822Z', 'formatLogTimestamp is ISO 8601 with milliseconds');
const line = formatLogLine('info', 'hello world', undefined, D);
assert(line.startsWith('2026-06-14T19:10:49.822Z '), 'every line begins with an ISO timestamp');
assert(/\bINFO\b/.test(line) && /hello world$/.test(line), 'line carries an uppercased level and the message');
assert(formatLogLine('error', 'boom', undefined, D).includes('ERROR'), 'error level is uppercased');
assert(formatLogLine('info', 'm', { a: 1 }, D).endsWith(' {"a":1}'), 'object meta is appended as JSON');
assert(!formatLogLine('info', 'm', {}, D).includes('{}'), 'an empty meta object is omitted');
assert(formatLogLine('info', 'm', null, D).endsWith(' m'), 'null meta adds nothing');
assert(formatLogLine('info', 'm', 'note', D).endsWith(' note'), 'string meta is appended verbatim');
assert(formatLogLine('info', 'm', { big: 10n }, D).includes('"big":"10"'), 'bigint meta is serialized safely');

// --- file writing + console mirror + debug gating -----------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-log-'));
  try {
    const cap = captureConsole();
    const logger = createBotLogger({ dir, now: advancingClock(), consoleImpl: cap.impl, verbose: false, rotateOnStart: false });
    assert(logger.filePath === path.join(dir, 'telegram-bot.log'), 'filePath is <dir>/telegram-bot.log');

    logger.info('bot started', { pid: 1234 });
    logger.warn('something odd');
    logger.debug('verbose detail'); // suppressed when verbose:false

    const contents = fs.readFileSync(logger.filePath, 'utf8');
    assert(/INFO .*bot started .*"pid":1234/.test(contents), 'info line with meta is written to the file');
    assert(/WARN .*something odd/.test(contents), 'warn line is written');
    assert(!/verbose detail/.test(contents), 'debug line is suppressed when verbose:false');
    assert(/^2026-06-14T/m.test(contents), 'each file line carries a timestamp (req #3)');
    assert(
      cap.lines.some(l => /bot started/.test(l)),
      'lines are mirrored to the console'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- verbose enables debug ----------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-log-v-'));
  try {
    const logger = createBotLogger({ dir, now: advancingClock(), consoleImpl: captureConsole().impl, verbose: true, rotateOnStart: false });
    logger.debug('now you see me');
    assert(/DEBUG .*now you see me/.test(fs.readFileSync(logger.filePath, 'utf8')), 'debug line is written when verbose:true');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- event() and heartbeat() --------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-log-e-'));
  try {
    const logger = createBotLogger({ dir, now: advancingClock(), consoleImpl: captureConsole().impl, rotateOnStart: false });
    logger.event('session_killed', { sessionName: 'sess-1', exitCode: 137 });
    logger.heartbeat({ activeSessions: 2, uptimeSec: 99 });
    const contents = fs.readFileSync(logger.filePath, 'utf8');
    assert(/EVENT session_killed .*"sessionName":"sess-1".*"exitCode":137/.test(contents), 'event() writes a greppable "EVENT <type>" line with data');
    assert(/EVENT heartbeat .*"pid":\d+.*"activeSessions":2/.test(contents), 'heartbeat() writes a marker carrying the pid and active session count');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- rotateOnStart preserves the previous log (req #4: no data destroyed) ------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-log-r-'));
  try {
    const activePath = path.join(dir, 'telegram-bot.log');
    fs.writeFileSync(activePath, '2026-06-14T18:00:00.000Z INFO  previous run line\n');

    const logger = createBotLogger({ dir, now: advancingClock(), consoleImpl: captureConsole().impl, rotateOnStart: true });
    const backups = listBackups(dir);
    assert(backups.length === 1, 'startup preserves the previous active log as exactly one backup');
    const backupContent = fs.readFileSync(path.join(dir, backups[0]), 'utf8');
    assert(/previous run line/.test(backupContent), 'the previous run log content survives in the backup (not overwritten)');

    logger.info('new run line');
    const activeContent = fs.readFileSync(activePath, 'utf8');
    assert(/new run line/.test(activeContent) && !/previous run line/.test(activeContent), 'the new active log contains only the new run, never clobbering history');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- size-based rotation mid-run ----------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-log-s-'));
  try {
    const logger = createBotLogger({ dir, now: advancingClock(), consoleImpl: captureConsole().impl, rotateOnStart: false, maxBytes: 160 });
    for (let i = 0; i < 12; i++) logger.info(`line number ${i} with some padding to grow the file`);
    const backups = listBackups(dir);
    assert(backups.length >= 1, 'an oversized active log is rotated into at least one timestamped backup mid-run');
    const activeSize = fs.statSync(logger.filePath).size;
    assert(activeSize <= 160 + 80, 'the active log stays bounded near maxBytes after rotation');
    // No data destroyed: every written line lives in either the active file or a backup.
    const total = [logger.filePath, ...backups.map(b => path.join(dir, b))].map(p => fs.readFileSync(p, 'utf8')).join('');
    for (let i = 0; i < 12; i++) assert(total.includes(`line number ${i} `), `rotated data is preserved (line ${i} survives in active+backups)`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- pruneBackups keeps the newest maxBackups ---------------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-log-p-'));
  try {
    // Pre-seed 5 old backups (2020 stamps sort before the 2026 rotation).
    for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(dir, `telegram-bot-2020-01-0${i}T00-00-00-000Z.log`), `old ${i}\n`);
    // An existing active log that startup will rotate into a fresh 2026 backup.
    fs.writeFileSync(path.join(dir, 'telegram-bot.log'), 'active to rotate\n');

    createBotLogger({ dir, now: advancingClock(), consoleImpl: captureConsole().impl, rotateOnStart: true, maxBackups: 3 });
    const backups = listBackups(dir);
    assert(backups.length === 3, 'pruneBackups trims to maxBackups (3) newest backups');
    // The just-rotated active content (newest) must be among the survivors.
    const survived = backups.map(b => fs.readFileSync(path.join(dir, b), 'utf8')).join('');
    assert(/active to rotate/.test(survived), 'the freshly-rotated (newest) backup is never pruned');
    assert(!/old 1/.test(survived) && !/old 2/.test(survived), 'the oldest backups are pruned first');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- maxBackups < 0 means unbounded (never destroy) ---------------------------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-log-u-'));
  try {
    for (let i = 1; i <= 4; i++) fs.writeFileSync(path.join(dir, `telegram-bot-2020-01-0${i}T00-00-00-000Z.log`), `old ${i}\n`);
    fs.writeFileSync(path.join(dir, 'telegram-bot.log'), 'active\n');
    createBotLogger({ dir, now: advancingClock(), consoleImpl: captureConsole().impl, rotateOnStart: true, maxBackups: -1 });
    assert(listBackups(dir).length === 5, 'maxBackups < 0 keeps every backup (4 old + 1 rotated), pruning nothing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// --- filesystem failure disables file logging but never throws ----------------
{
  const cap = captureConsole();
  const throwingFs = {
    mkdirSync: () => {
      throw new Error('EACCES: permission denied');
    },
    existsSync: () => false,
    statSync: () => ({ size: 0 }),
    appendFileSync: () => {
      throw new Error('EACCES');
    },
    renameSync: () => {},
    readdirSync: () => [],
    unlinkSync: () => {},
  };
  const logger = createBotLogger({ dir: '/forbidden', fsImpl: throwingFs, consoleImpl: cap.impl, now: advancingClock() });
  assert(logger.fileDisabled === true, 'logger disables file writes when the log dir cannot be created');
  // Must still log to console without throwing.
  logger.info('still alive via console');
  assert(
    cap.lines.some(l => /still alive via console/.test(l)),
    'console logging still works when the file is disabled'
  );
}

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
