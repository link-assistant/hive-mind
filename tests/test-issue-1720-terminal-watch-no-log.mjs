#!/usr/bin/env node

/**
 * Regression test for issue #1720.
 *
 * @hive-mind-test-suite default
 *
 * Verifies that:
 * 1. `/terminal_watch` does NOT upload the session log document on its own —
 *    that responsibility belongs to `/log`.
 * 2. `/log` continues to deliver logs as a reply to the originating message
 *    (which Telegraf annotates with `message_thread_id` for forum topics) and
 *    therefore respects topics by construction.
 *
 * Run with: node tests/test-issue-1720-terminal-watch-no-log.mjs
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { watchTerminalLogSession } from '../src/telegram-terminal-watch-command.lib.mjs';
import { registerLogCommand } from '../src/telegram-log-command.lib.mjs';

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

console.log('='.repeat(80));
console.log('Regression: /terminal_watch must not attach logs (Issue #1720)');
console.log('='.repeat(80));

// --- 1. /terminal_watch does not call sendDocument -----------------------------
console.log('\n--- watchTerminalLogSession() does not upload logs on completion ---');

const uuid = '938a9d28-8b2a-4cb0-aa37-35dc8bcac0d5';
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tw-1720-'));
const logPath = path.join(tempDir, `${uuid}.log`);
await fs.writeFile(logPath, 'first line\n');

const edits = [];
const documents = [];
const messages = [];
let statusCalls = 0;
const bot = {
  telegram: {
    editMessageText: async (...args) => edits.push(args),
    sendDocument: async (...args) => documents.push(args),
    sendMessage: async (...args) => messages.push(args),
  },
};

watchTerminalLogSession({
  bot,
  chatId: 999,
  messageId: 1000,
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

assert(edits.length >= 2, 'still edits the live message while running and at completion', { edits: edits.length });
assert(documents.length === 0, 'does NOT call sendDocument on completion', { documents });
assert(messages.length === 0, 'does NOT call sendMessage (e.g. for oversize logs) on completion', { messages });
assert(String(edits.at(-1)?.[3] || '').includes('Terminal watch complete'), 'final edit shows the watch is complete');

await fs.rm(tempDir, { recursive: true, force: true });

// --- 2. /log replies to the originating message (preserves topic via Telegraf) -
console.log('\n--- /log replies to the originating message (so Telegraf carries message_thread_id) ---');

const logTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'log-1720-'));
const sessionUuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const logFilePath = path.join(logTempDir, `${sessionUuid}.log`);
await fs.writeFile(logFilePath, 'log content\n');

const replyDocCalls = [];
const replyTextCalls = [];

const fakeBot = {
  command: (_name, handler) => {
    fakeBot._handler = handler;
  },
};

await registerLogCommand(fakeBot, {
  VERBOSE: false,
  isOldMessage: () => false,
  isChatAuthorized: () => true,
  // Stub the network calls.
  querySessionStatus: async () => ({ exists: true, uuid: sessionUuid, status: 'executed', isolation: 'screen', logPath: logFilePath }),
  getTrackedSessionInfo: () => ({ isolationBackend: 'screen', url: 'https://github.com/foo/bar' }),
  detectRepositoryVisibility: async () => ({ isPublic: true, visibility: 'public' }),
  parseGitHubUrl: url => {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    return match ? { valid: true, owner: match[1], repo: match[2] } : { valid: false };
  },
});

const ctx = {
  chat: { id: -100123456, type: 'supergroup', is_forum: true },
  from: { id: 42 },
  message: {
    text: `/log ${sessionUuid}`,
    message_id: 555,
    message_thread_id: 777, // forum topic id
  },
  reply: async (text, opts) => {
    replyTextCalls.push({ text, opts });
    return { message_id: 1 };
  },
  replyWithDocument: async (doc, opts) => {
    replyDocCalls.push({ doc, opts });
    return { message_id: 2 };
  },
  telegram: {
    getChatMember: async () => ({ status: 'creator' }),
  },
};

await fakeBot._handler(ctx);

assert(replyDocCalls.length === 1, '/log issues exactly one replyWithDocument call for a public-repo session', { replyDocCalls: replyDocCalls.length });
const docCall = replyDocCalls[0];
assert(docCall?.opts?.reply_to_message_id === 555, '/log replies to the message that contained the command', { opts: docCall?.opts });
// Telegraf's Context#replyWithDocument transparently injects message_thread_id from
// ctx.message into the outgoing payload (see node_modules/telegraf/lib/context.js).
// We do not need to set it ourselves — but we must use ctx.replyWithDocument (not
// bot.telegram.sendDocument), which is what we are asserting here.
assert(typeof ctx.replyWithDocument === 'function' && replyDocCalls.length === 1, '/log uses ctx.replyWithDocument so Telegraf carries message_thread_id automatically');

await fs.rm(logTempDir, { recursive: true, force: true });

console.log('\n' + '='.repeat(80));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));

if (failed > 0) process.exit(1);
