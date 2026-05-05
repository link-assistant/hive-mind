#!/usr/bin/env node

/**
 * Tests for Telegram terminal watch helpers (issue #467).
 *
 * Run with: node tests/test-issue-467-terminal-watch.mjs
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { formatTerminalWatchMessage, parseTerminalWatchArgs, resolveTerminalWatchRepository, tailTextForTerminal, watchTerminalLogSession } from '../src/telegram-terminal-watch-command.lib.mjs';

let passed = 0;
let failed = 0;

function assert(condition, name, details) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    if (details !== undefined) console.log(`     ${JSON.stringify(details)}`);
    failed++;
  }
}

function assertEqual(actual, expected, name) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), name, { expected, actual });
}

console.log('='.repeat(80));
console.log('Unit Tests: Telegram terminal watch (Issue #467)');
console.log('='.repeat(80));

console.log('\n--- parseTerminalWatchArgs() ---');
const uuid = '4d934f71-4cdb-4b8c-b474-582116d12c12';
const parsed = parseTerminalWatchArgs(`/terminal_watch ${uuid} --size 100x20 --interval-ms 3000 --max-chars=2000`);
assertEqual(parsed.sessionId, uuid, 'extracts session id from direct command');
assertEqual(parsed.options.width, 100, 'parses --size width');
assertEqual(parsed.options.height, 20, 'parses --size height');
assertEqual(parsed.options.intervalMs, 3000, 'parses --interval-ms');
assertEqual(parsed.options.maxChars, 2000, 'parses --max-chars inline form');
assertEqual(parsed.errors, [], 'accepts valid options without errors');

const bad = parseTerminalWatchArgs(`/terminal_watch ${uuid} --size nope --height 3 --unknown`);
assert(bad.errors.length === 3, 'reports invalid size, height, and unknown option', bad.errors);

console.log('\n--- tailTextForTerminal() ---');
const logText = ['line 1', 'line 2', 'line 3', 'line 4 is very long'].join('\n');
assertEqual(tailTextForTerminal(logText, { width: 10, height: 2, maxChars: 100 }), 'line 3\n...ry long', 'keeps last height lines and trims long lines from the left');
assertEqual(tailTextForTerminal('', { width: 80, height: 25 }), '(no log output yet)', 'renders empty logs explicitly');

console.log('\n--- formatTerminalWatchMessage() ---');
const formatted = formatTerminalWatchMessage({
  sessionId: uuid,
  statusResult: { status: 'executing' },
  logText: 'before\n```danger\nnow',
  options: { width: 120, height: 25, maxChars: 1000 },
  updateCount: 2,
  repoDescription: 'owner/repo',
});
assert(formatted.includes('Live terminal watch'), 'formats live watch title');
assert(formatted.includes(`Session: \`${uuid}\``), 'includes session id');
assert(formatted.includes("'''danger"), 'sanitizes nested code fences in logs');
assert(formatted.includes('Repo: `owner/repo`'), 'includes repository description');

console.log('\n--- resolveTerminalWatchRepository() ---');
const resolved = await resolveTerminalWatchRepository({
  sessionInfo: null,
  statusResult: { command: `solve https://github.com/link-assistant/hive-mind/issues/467 --tool codex` },
  parseGitHubUrl: url => {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    return match ? { valid: true, owner: match[1], repo: match[2] } : { valid: false };
  },
  detectRepositoryVisibility: async (owner, repo) => ({ visibility: 'public', isPublic: owner === 'link-assistant' && repo === 'hive-mind' }),
});
assertEqual(resolved.repoDescription, 'link-assistant/hive-mind', 'derives repo from $ --status command when in-memory tracking is missing');
assertEqual(resolved.repoVisibility?.isPublic, true, 'returns detected visibility');

console.log('\n--- watchTerminalLogSession() ---');
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-watch-test-'));
const logPath = path.join(tempDir, `${uuid}.log`);
await fs.writeFile(logPath, 'first line\nsecond line\n');

const edits = [];
const documents = [];
let statusCalls = 0;
const bot = {
  telegram: {
    editMessageText: async (...args) => edits.push(args),
    sendDocument: async (...args) => documents.push(args),
    sendMessage: async (...args) => edits.push(['sendMessage', ...args]),
  },
};

watchTerminalLogSession({
  bot,
  chatId: 123,
  messageId: 456,
  sessionId: uuid,
  logPath,
  options: { width: 80, height: 10, intervalMs: 10, maxChars: 1000 },
  querySessionStatus: async () => {
    statusCalls++;
    if (statusCalls === 2) await fs.writeFile(logPath, 'final line\n');
    return { exists: true, uuid, status: statusCalls >= 2 ? 'executed' : 'executing', logPath, isolation: 'screen' };
  },
  isTerminalSessionStatus: status => status === 'executed',
});

await new Promise(resolve => setTimeout(resolve, 80));
assert(edits.length >= 2, 'edits the watch message while running and at completion', { editCount: edits.length });
// /terminal_watch must not upload the log file itself — that is /log's job (issue #1720).
assert(documents.length === 0, 'does not attach the full log when the session reaches terminal status (issue #1720)', { documents });
assert(String(edits.at(-1)?.[3] || '').includes('Terminal watch complete'), 'freezes final message as complete');

await fs.rm(tempDir, { recursive: true, force: true });

console.log('\n--- watchTerminalLogSession() change detection (Issue #1750) ---');
const noChangeTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-watch-1750-'));
const noChangeLogPath = path.join(noChangeTempDir, `${uuid}.log`);
await fs.writeFile(noChangeLogPath, 'stable line\n');

const unchangedEdits = [];
let unchangedStatusCalls = 0;
const unchangedInitialStatus = { exists: true, uuid, status: 'executing', logPath: noChangeLogPath, isolation: 'screen' };
const unchangedInitialMessage = formatTerminalWatchMessage({
  sessionId: uuid,
  statusResult: unchangedInitialStatus,
  logText: 'stable line\n',
  options: { width: 80, height: 10, intervalMs: 10, maxChars: 1000 },
  updateCount: 0,
});
const unchangedControl = watchTerminalLogSession({
  bot: {
    telegram: {
      editMessageText: async (...args) => unchangedEdits.push(args),
    },
  },
  chatId: 123,
  messageId: 789,
  sessionId: uuid,
  logPath: noChangeLogPath,
  options: { width: 80, height: 10, intervalMs: 10, maxChars: 1000 },
  initialStatusResult: unchangedInitialStatus,
  initialLogText: 'stable line\n',
  initialMessage: unchangedInitialMessage,
  querySessionStatus: async () => {
    unchangedStatusCalls++;
    return { exists: true, uuid, status: 'executing', logPath: noChangeLogPath, isolation: 'screen' };
  },
  isTerminalSessionStatus: status => status === 'executed',
});

await new Promise(resolve => setTimeout(resolve, 55));
unchangedControl.stop();
assert(unchangedStatusCalls >= 2, 'polls the session more than once while the watch is active', { unchangedStatusCalls });
assert(unchangedEdits.length === 0, 'does not edit Telegram message when terminal snapshot is unchanged', { editCount: unchangedEdits.length });

const changedEdits = [];
let changedStatusCalls = 0;
await fs.writeFile(noChangeLogPath, 'first snapshot\n');
const changedInitialStatus = { exists: true, uuid, status: 'executing', logPath: noChangeLogPath, isolation: 'screen' };
const changedOptions = { width: 80, height: 10, intervalMs: 10, maxChars: 1000 };
const changedControl = watchTerminalLogSession({
  bot: {
    telegram: {
      editMessageText: async (...args) => changedEdits.push(args),
    },
  },
  chatId: 123,
  messageId: 790,
  sessionId: uuid,
  logPath: noChangeLogPath,
  options: changedOptions,
  initialStatusResult: changedInitialStatus,
  initialLogText: 'first snapshot\n',
  initialMessage: formatTerminalWatchMessage({
    sessionId: uuid,
    statusResult: changedInitialStatus,
    logText: 'first snapshot\n',
    options: changedOptions,
    updateCount: 0,
  }),
  querySessionStatus: async () => {
    changedStatusCalls++;
    if (changedStatusCalls === 2) await fs.writeFile(noChangeLogPath, 'second snapshot\n');
    return { exists: true, uuid, status: 'executing', logPath: noChangeLogPath, isolation: 'screen' };
  },
  isTerminalSessionStatus: status => status === 'executed',
});

await new Promise(resolve => setTimeout(resolve, 80));
changedControl.stop();
assert(changedEdits.length === 1, 'edits Telegram exactly once for one changed terminal snapshot', { editCount: changedEdits.length });
assert(String(changedEdits[0]?.[3] || '').includes('Updates: 1'), 'counts only changed terminal snapshots as updates', { message: changedEdits[0]?.[3] });

await fs.rm(noChangeTempDir, { recursive: true, force: true });

console.log('\n' + '='.repeat(80));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));

if (failed > 0) process.exit(1);
