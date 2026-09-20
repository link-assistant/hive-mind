#!/usr/bin/env node
/**
 * Unit tests for resume planning of killed /solve sessions (issue #1927 review
 * follow-up).
 *
 * The PR's defensive detection turns a silent OOM hang into a reported kill. The
 * follow-up adds the *resume* half: a surviving parent (the Telegram bot, or
 * /hive) can relaunch the killed /solve with the AI tool's `--resume <sessionId>`
 * flow. Two invariants must hold and are covered here:
 *
 *   1. When a single /solve run produced MULTIPLE tool sessions, the LAST one is
 *      selected for resume — never the first.
 *   2. Auto-resume is bounded so a reliably-crashing job cannot storm.
 *
 * @see https://github.com/link-assistant/hive-mind/pull/1928#issuecomment-4726972047
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { extractSessionIds, selectLastSessionId, readLastSessionIdFromLog, findLatestSessionLogId, stripResumeFlag, buildResumeCommand, planKilledSessionResume, formatResumeSection } from '../src/session-resume.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: killed-session resume planning');
console.log('='.repeat(60));

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

// --- extractSessionIds --------------------------------------------------------
assert(JSON.stringify(extractSessionIds('')) === '[]', 'extractSessionIds returns [] for empty input');
assert(JSON.stringify(extractSessionIds(null)) === '[]', 'extractSessionIds returns [] for null input');
assert(JSON.stringify(extractSessionIds(`📌 Session ID: ${ID1}\nwork...\n📌 Session ID: ${ID2}`)) === JSON.stringify([ID1, ID2]), 'extractSessionIds returns ids in order');
assert(JSON.stringify(extractSessionIds(`Session ID: \`${ID1}\`\nSession ID: ${ID1}\nSession ID: \`${ID2}\``)) === JSON.stringify([ID1, ID2]), 'extractSessionIds collapses consecutive duplicates and strips backticks');
assert(JSON.stringify(extractSessionIds('Session ID: unknown')) === '[]', 'extractSessionIds skips the "unknown" placeholder');

// --- selectLastSessionId (the core "use the last of them" rule) ---------------
assert(selectLastSessionId(`Session ID: ${ID1}\nSession ID: ${ID2}\nSession ID: ${ID3}`) === ID3, 'selectLastSessionId picks the LAST of three sessions');
assert(selectLastSessionId(`📌 Session ID: ${ID1}`) === ID1, 'selectLastSessionId returns the only session');
assert(selectLastSessionId('no markers here') === null, 'selectLastSessionId returns null when none present');

// --- readLastSessionIdFromLog -------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-test-'));
const logPath = path.join(tmpDir, 'capture.log');
fs.writeFileSync(logPath, `start\n📌 Session ID: ${ID1}\n... limit reached, resuming ...\n📌 Session ID: ${ID2}\nKilled\nExit Code: 137\n`);
assert(readLastSessionIdFromLog(logPath) === ID2, 'readLastSessionIdFromLog reads the LAST session id from a multi-session log');
assert(readLastSessionIdFromLog(path.join(tmpDir, 'missing.log')) === null, 'readLastSessionIdFromLog returns null for a missing log (never throws)');
assert(readLastSessionIdFromLog(null) === null, 'readLastSessionIdFromLog returns null for a null path');
// tail-only scan still finds an id that sits within the tail window
const bigPrefix = 'x'.repeat(5000);
const tailLog = path.join(tmpDir, 'tail.log');
fs.writeFileSync(tailLog, `${bigPrefix}\n📌 Session ID: ${ID3}\n`);
assert(readLastSessionIdFromLog(tailLog, { tailBytes: 1024 }) === ID3, 'readLastSessionIdFromLog finds the id within a small tail window');

// --- findLatestSessionLogId ---------------------------------------------------
const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-logs-'));
const older = path.join(logsDir, `${ID1}.log`);
const newer = path.join(logsDir, `${ID2}.log`);
fs.writeFileSync(older, 'a');
fs.writeFileSync(newer, 'b');
// force a deterministic ordering regardless of filesystem timestamp resolution
fs.utimesSync(older, new Date('2026-06-14T19:00:00Z'), new Date('2026-06-14T19:00:00Z'));
fs.utimesSync(newer, new Date('2026-06-14T19:10:00Z'), new Date('2026-06-14T19:10:00Z'));
fs.writeFileSync(path.join(logsDir, 'solve-not-a-uuid.log'), 'ignore me');
assert(findLatestSessionLogId({ dir: logsDir }) === ID2, 'findLatestSessionLogId returns the most-recent <sessionId>.log');
assert(findLatestSessionLogId({ dir: path.join(logsDir, 'nope') }) === null, 'findLatestSessionLogId returns null for a missing dir');

// --- stripResumeFlag ----------------------------------------------------------
assert(JSON.stringify(stripResumeFlag(['url', '--resume', 'old', '--tool', 'codex'])) === JSON.stringify(['url', '--tool', 'codex']), 'stripResumeFlag drops --resume <id>');
assert(JSON.stringify(stripResumeFlag(['url', '-r', 'old'])) === JSON.stringify(['url']), 'stripResumeFlag drops -r <id>');
assert(JSON.stringify(stripResumeFlag(['url', '--resume=old', '--verbose'])) === JSON.stringify(['url', '--verbose']), 'stripResumeFlag drops --resume=<id>');
assert(JSON.stringify(stripResumeFlag(['url', '--model', 'opus'])) === JSON.stringify(['url', '--model', 'opus']), 'stripResumeFlag leaves resume-free args untouched');

// --- buildResumeCommand -------------------------------------------------------
const url = 'https://github.com/acme/widgets/issues/42';
const r1 = buildResumeCommand({ sessionInfo: { command: 'solve', url, tool: 'claude' }, lastSessionId: ID2 });
assert(r1 && r1.binary === 'solve' && r1.args.includes('--resume') && r1.args[r1.args.length - 1] === ID2, 'buildResumeCommand appends --resume <lastId> for a minimal solve session');
assert(r1.display === `solve ${url} --resume ${ID2}`, 'buildResumeCommand renders a clean display command');

const r2 = buildResumeCommand({ sessionInfo: { command: 'solve', url, tool: 'codex' }, lastSessionId: ID2 });
assert(r2.args.includes('--tool') && r2.args.includes('codex'), 'buildResumeCommand preserves a non-claude --tool when reconstructing from url');

const r3 = buildResumeCommand({ sessionInfo: { command: 'solve', args: [url, '--model', 'opus', '--resume', ID1] }, lastSessionId: ID2 });
assert(r3.display === `solve ${url} --model opus --resume ${ID2}`, 'buildResumeCommand reuses persisted args and replaces a stale --resume id');

assert(buildResumeCommand({ sessionInfo: { command: 'solve', url }, lastSessionId: null }) === null, 'buildResumeCommand returns null without a session id');
assert(buildResumeCommand({ sessionInfo: { command: 'hive', url }, lastSessionId: ID2 }) === null, 'buildResumeCommand returns null for non-solve commands (/hive is not --resume-able)');
assert(buildResumeCommand({ sessionInfo: { command: 'solve' }, lastSessionId: ID2 }) === null, 'buildResumeCommand returns null when no url is recoverable');

// --- planKilledSessionResume (bounded auto-resume) ----------------------------
const p1 = planKilledSessionResume({ sessionInfo: { command: 'solve', url }, lastSessionId: ID2, attempts: 0, maxAttempts: 1 });
assert(p1.resumable === true && p1.reason === 'ready' && p1.attempt === 1, 'planKilledSessionResume allows the first resume');
const p2 = planKilledSessionResume({ sessionInfo: { command: 'solve', url }, lastSessionId: ID2, attempts: 1, maxAttempts: 1 });
assert(p2.resumable === false && p2.reason === 'max-attempts-reached' && p2.command, 'planKilledSessionResume refuses to storm after maxAttempts (but still reports the command)');
const p3 = planKilledSessionResume({ sessionInfo: { command: 'solve', url }, lastSessionId: null });
assert(p3.resumable === false && p3.reason === 'no-session-id', 'planKilledSessionResume is not resumable without a session id');
const p4 = planKilledSessionResume({ sessionInfo: { command: 'hive', url }, lastSessionId: ID2 });
assert(p4.resumable === false && p4.reason === 'not-resumable', 'planKilledSessionResume is not resumable for non-solve commands');

// --- formatResumeSection ------------------------------------------------------
const section = formatResumeSection({ lastSessionId: ID2, command: r1 });
assert(section.includes(ID2) && section.includes(r1.display) && section.includes('Resume'), 'formatResumeSection surfaces the id and copy-paste command');
assert(formatResumeSection({ lastSessionId: null, command: null }) === '', 'formatResumeSection returns empty string when nothing to resume');

// cleanup
try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(logsDir, { recursive: true, force: true });
} catch {
  /* best effort */
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
