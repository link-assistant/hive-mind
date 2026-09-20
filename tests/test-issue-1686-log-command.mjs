#!/usr/bin/env node

/**
 * Tests for the /log Telegram command (issue #1686).
 *
 * We focus on the pure helpers exposed by:
 * - src/telegram-log-command.lib.mjs (extractSessionIdFromText, decideLogDestination, resolveLogPath)
 * - src/isolation-runner.lib.mjs (parseSessionStatusOutput now exposes logPath/isolation/command)
 *
 * Run with: node tests/test-issue-1686-log-command.mjs
 */

import { extractSessionIdFromText, decideLogDestination, resolveLogPath } from '../src/telegram-log-command.lib.mjs';
import { parseSessionStatusOutput } from '../src/isolation-runner.lib.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: /log command helpers (Issue #1686)');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

function assert(cond, name, details) {
  if (cond) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    if (details !== undefined) console.log(`     ${JSON.stringify(details)}`);
    failed++;
  }
}

function assertEqual(actual, expected, name) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (pass) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ----- extractSessionIdFromText ------------------------------------------------
console.log('\n--- extractSessionIdFromText() ---');

assertEqual(extractSessionIdFromText('/log 4d934f71-4cdb-4b8c-b474-582116d12c12'), '4d934f71-4cdb-4b8c-b474-582116d12c12', 'extracts UUID from "/log <UUID>"');

assertEqual(extractSessionIdFromText('/log 4D934F71-4CDB-4B8C-B474-582116D12C12'), '4d934f71-4cdb-4b8c-b474-582116d12c12', 'lowercases extracted UUID');

assertEqual(extractSessionIdFromText('⏳ Executing...\n\n📊 Session: `4d934f71-4cdb-4b8c-b474-582116d12c12`'), '4d934f71-4cdb-4b8c-b474-582116d12c12', 'extracts UUID from a typical Executing... message');

assertEqual(extractSessionIdFromText('✅ *Work session finished successfully*\n\n📊 Session: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`\nDuration: 1m'), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'extracts UUID from a completion message');

assertEqual(extractSessionIdFromText(''), null, 'returns null for empty text');
assertEqual(extractSessionIdFromText(null), null, 'returns null for null');
assertEqual(extractSessionIdFromText(undefined), null, 'returns null for undefined');
assertEqual(extractSessionIdFromText('/log 12345'), null, 'returns null for non-UUID arg');
assertEqual(extractSessionIdFromText('/log 4d934f71-4cdb-4b8c-b474'), null, 'returns null for truncated UUID');

// First UUID wins when multiple are present.
assertEqual(extractSessionIdFromText('/log 4d934f71-4cdb-4b8c-b474-582116d12c12 11111111-2222-3333-4444-555555555555'), '4d934f71-4cdb-4b8c-b474-582116d12c12', 'returns the first UUID when multiple are present');

// ----- parseSessionStatusOutput surfaces logPath/isolation --------------------
console.log('\n--- parseSessionStatusOutput() exposes logPath/isolation/command ---');

const directJson = JSON.stringify({
  uuid: '4d934f71-4cdb-4b8c-b474-582116d12c12',
  status: 'executed',
  exitCode: 2,
  command: '--help',
  logPath: '/tmp/start-command/logs/direct/4d934f71-4cdb-4b8c-b474-582116d12c12.log',
  startTime: '2026-04-25T18:40:04.297Z',
  endTime: '2026-04-25T18:40:04.329Z',
  options: { isolation: 'screen' },
});

const directParsed = parseSessionStatusOutput(directJson);
assert(directParsed.exists, 'JSON: marks the session as exists');
assertEqual(directParsed.uuid, '4d934f71-4cdb-4b8c-b474-582116d12c12', 'JSON: extracts uuid');
assertEqual(directParsed.status, 'executed', 'JSON: lowercases status');
assertEqual(directParsed.exitCode, 2, 'JSON: parses exitCode as number');
assertEqual(directParsed.command, '--help', 'JSON: surfaces command');
assertEqual(directParsed.logPath, '/tmp/start-command/logs/direct/4d934f71-4cdb-4b8c-b474-582116d12c12.log', 'JSON: surfaces logPath');
assertEqual(directParsed.isolation, 'screen', 'JSON: derives isolation from options.isolation when no top-level field');

const isolationJson = JSON.stringify({
  uuid: '11111111-2222-3333-4444-555555555555',
  status: 'executing',
  isolation: 'TMUX',
  logPath: '/tmp/start-command/logs/isolation/tmux/11111111-2222-3333-4444-555555555555.log',
});
const isolationParsed = parseSessionStatusOutput(isolationJson);
assertEqual(isolationParsed.isolation, 'tmux', 'JSON: top-level isolation is lowercased');
assertEqual(isolationParsed.logPath, '/tmp/start-command/logs/isolation/tmux/11111111-2222-3333-4444-555555555555.log', 'JSON: tmux logPath surfaces');

const textOutput = `4d934f71-4cdb-4b8c-b474-582116d12c12
  uuid 4d934f71-4cdb-4b8c-b474-582116d12c12
  status executed
  exitCode 0
  command "solve https://github.com/foo/bar/issues/1"
  logPath /tmp/start-command/logs/isolation/screen/4d934f71-4cdb-4b8c-b474-582116d12c12.log
  isolation screen
  startTime "2026-04-25T18:40:04.297Z"
  endTime "2026-04-25T18:40:04.329Z"
`;
const textParsed = parseSessionStatusOutput(textOutput);
assert(textParsed.exists, 'TEXT: marks session as exists');
assertEqual(textParsed.uuid, '4d934f71-4cdb-4b8c-b474-582116d12c12', 'TEXT: extracts uuid');
assertEqual(textParsed.status, 'executed', 'TEXT: lowercases status');
assertEqual(textParsed.exitCode, 0, 'TEXT: parses exitCode');
assertEqual(textParsed.logPath, '/tmp/start-command/logs/isolation/screen/4d934f71-4cdb-4b8c-b474-582116d12c12.log', 'TEXT: surfaces logPath');
assertEqual(textParsed.isolation, 'screen', 'TEXT: surfaces isolation');
assertEqual(textParsed.command, 'solve https://github.com/foo/bar/issues/1', 'TEXT: surfaces command');

const emptyParsed = parseSessionStatusOutput('');
assertEqual(emptyParsed.exists, false, 'EMPTY: marks not-exists');
assertEqual(emptyParsed.logPath, null, 'EMPTY: logPath is null');
assertEqual(emptyParsed.isolation, null, 'EMPTY: isolation is null');

// ----- decideLogDestination ---------------------------------------------------
console.log('\n--- decideLogDestination() ---');

const baseStatus = { exists: true, uuid: 'u', status: 'executed', exitCode: 0, isolation: 'screen', logPath: '/tmp/x.log' };

assertEqual(decideLogDestination({ statusResult: baseStatus, sessionInfo: null, repoVisibility: { isPublic: true, visibility: 'public' }, chatType: 'group' }).destination, 'chat', 'public repo + group chat → chat delivery');
assertEqual(decideLogDestination({ statusResult: baseStatus, sessionInfo: null, repoVisibility: { isPublic: true, visibility: 'public' }, chatType: 'supergroup' }).destination, 'chat', 'public repo + supergroup → chat delivery');
assertEqual(decideLogDestination({ statusResult: baseStatus, sessionInfo: null, repoVisibility: { isPublic: true, visibility: 'public' }, chatType: 'private' }).destination, 'dm', 'public repo + private chat (DM) → dm delivery (already in DM)');
assertEqual(decideLogDestination({ statusResult: baseStatus, sessionInfo: null, repoVisibility: { isPublic: false, visibility: 'private' }, chatType: 'group' }).destination, 'dm', 'private repo → dm delivery');
assertEqual(decideLogDestination({ statusResult: baseStatus, sessionInfo: null, repoVisibility: { isPublic: false, visibility: 'internal' }, chatType: 'supergroup' }).destination, 'dm', 'internal-visibility repo → dm delivery');

assertEqual(decideLogDestination({ statusResult: baseStatus, sessionInfo: null, repoVisibility: null, chatType: 'group' }).destination, 'dm', 'unknown visibility → dm delivery (fail-closed)');
assertEqual(decideLogDestination({ statusResult: baseStatus, sessionInfo: null, repoVisibility: { isPublic: true, visibility: null }, chatType: 'group' }).destination, 'dm', 'isPublic:true but visibility unknown → dm delivery (fail-closed)');

const directStatus = { ...baseStatus, isolation: null };
assertEqual(decideLogDestination({ statusResult: directStatus, sessionInfo: null, repoVisibility: { isPublic: true, visibility: 'public' }, chatType: 'group' }).destination, 'reject', 'non-isolation session → reject (issue #1686 R4)');

const directStatus2 = { ...baseStatus, isolation: 'direct' };
assertEqual(decideLogDestination({ statusResult: directStatus2, sessionInfo: null, repoVisibility: { isPublic: true, visibility: 'public' }, chatType: 'group' }).destination, 'reject', 'isolation:"direct" → reject');

assertEqual(decideLogDestination({ statusResult: { exists: false }, sessionInfo: null, repoVisibility: null, chatType: 'group' }).destination, 'reject', 'unknown session → reject');

// sessionInfo carries isolation backend even when $ --status doesn't.
const statusWithoutIsolation = { exists: true, uuid: 'u', status: 'executed', isolation: null };
assertEqual(decideLogDestination({ statusResult: statusWithoutIsolation, sessionInfo: { isolationBackend: 'docker' }, repoVisibility: { isPublic: true, visibility: 'public' }, chatType: 'group' }).destination, 'chat', 'sessionInfo.isolationBackend overrides missing status.isolation');
assertEqual(decideLogDestination({ statusResult: statusWithoutIsolation, sessionInfo: { isolationBackend: 'docker' }, repoVisibility: { isPublic: false, visibility: 'private' }, chatType: 'supergroup' }).destination, 'dm', 'sessionInfo.isolationBackend + private repo → dm');

// ----- resolveLogPath ---------------------------------------------------------
console.log('\n--- resolveLogPath() ---');

assertEqual(resolveLogPath({ statusResult: { uuid: 'u', logPath: '/explicit/path.log' }, isolationBackend: 'screen' }), '/explicit/path.log', 'prefers statusResult.logPath when present');

assertEqual(resolveLogPath({ statusResult: { uuid: 'aaaa', logPath: null }, isolationBackend: 'tmux' }), '/tmp/start-command/logs/isolation/tmux/aaaa.log', 'falls back to isolation/<backend>/<uuid>.log');

assertEqual(resolveLogPath({ statusResult: { uuid: 'bbbb', logPath: null }, isolationBackend: null }), '/tmp/start-command/logs/direct/bbbb.log', 'falls back to direct/<uuid>.log when no backend');

assertEqual(resolveLogPath({ statusResult: { uuid: null, logPath: null }, isolationBackend: 'screen' }), null, 'returns null when uuid is missing and no logPath is provided');

// -------------------------- summary ------------------------------------------
console.log('\n' + '='.repeat(80));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));
if (failed > 0) {
  process.exit(1);
}
