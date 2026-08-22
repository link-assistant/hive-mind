#!/usr/bin/env node

/**
 * Tests for Telegram terminal watch helpers (issue #467).
 *
 * Run with: node tests/test-issue-467-terminal-watch.mjs
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { formatTerminalWatchMessage, parseTerminalWatchArgs, registerTerminalWatchCommand, resolveTerminalWatchRepository, tailTextForTerminal, watchTerminalLogSession } from '../src/telegram-terminal-watch-command.lib.mjs';

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

// Poll `predicate` until it is truthy or `timeoutMs` elapses. Used instead of a
// fixed sleep so the timing-based watch tests do not flake under CI load, where
// the polling loop may need more wall-clock time to fire (issue #2028: fixing
// CI false negatives).
async function waitUntil(predicate, { timeoutMs = 3000, intervalMs = 5 } = {}) {
  const start = process.hrtime.bigint();
  const limitNs = BigInt(timeoutMs) * 1000000n;
  while (process.hrtime.bigint() - start < limitNs) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return predicate();
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

const aliasParsed = parseTerminalWatchArgs(`/watch ${uuid} --width 90`);
assertEqual(aliasParsed.sessionId, uuid, 'extracts session id from /watch alias');
assertEqual(aliasParsed.errors, [], 'accepts /watch alias without treating it as an argument');

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

await waitUntil(() => edits.length >= 2 && String(edits.at(-1)?.[3] || '').includes('Terminal watch complete'));
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

await waitUntil(() => unchangedStatusCalls >= 2);
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

await waitUntil(() => changedEdits.length >= 1);
changedControl.stop();
assert(changedEdits.length === 1, 'edits Telegram exactly once for one changed terminal snapshot', { editCount: changedEdits.length });
assert(String(changedEdits[0]?.[3] || '').includes('Updates: 1'), 'counts only changed terminal snapshots as updates', { message: changedEdits[0]?.[3] });

await fs.rm(noChangeTempDir, { recursive: true, force: true });

console.log('\n--- /terminal_watch requester access and /watch alias (Issue #1778) ---');

function createTerminalWatchHarness({ commandText, sessionInfo, repoVisibility, statusResult, logPath, fromId = 1778001, getChatMember, sendMessage, forwardMessage, copyMessage }) {
  const handlers = new Map();
  const replies = [];
  const sentMessages = [];
  const forwardedMessages = [];
  const copiedMessages = [];
  const editedMessages = [];
  let getChatMemberCalls = 0;

  const telegram = {
    getChatMember: async (...args) => {
      getChatMemberCalls++;
      return getChatMember ? await getChatMember(...args) : { status: 'member' };
    },
    sendMessage: async (...args) => {
      sentMessages.push(args);
      if (sendMessage) return await sendMessage(...args);
      return { message_id: 9001 };
    },
    forwardMessage: async (...args) => {
      forwardedMessages.push(args);
      if (forwardMessage) return await forwardMessage(...args);
      return { message_id: 9002 };
    },
    copyMessage: async (...args) => {
      copiedMessages.push(args);
      if (copyMessage) return await copyMessage(...args);
      return { message_id: 9003 };
    },
    editMessageText: async (...args) => {
      editedMessages.push(args);
      return true;
    },
  };

  const bot = {
    telegram,
    command: (name, handler) => {
      for (const commandName of Array.isArray(name) ? name : [name]) {
        handlers.set(commandName, handler);
      }
    },
  };

  const ctx = {
    chat: { id: -1001778, type: 'supergroup' },
    from: { id: fromId, username: 'task_starter' },
    message: { message_id: 501, text: commandText },
    telegram,
    reply: async (text, options) => {
      replies.push([text, options]);
      return { message_id: 7001, chat: { id: -1001778 }, text };
    },
  };

  const register = async () => {
    await registerTerminalWatchCommand(bot, {
      isOldMessage: () => false,
      isChatAuthorized: () => true,
      isTopicAuthorized: () => false,
      getTrackedSessionInfo: () => sessionInfo,
      querySessionStatus: async () => statusResult,
      isTerminalSessionStatus: status => status === 'executed',
      detectRepositoryVisibility: async () => repoVisibility,
      parseGitHubUrl: () => ({ valid: true, owner: 'owner', repo: 'repo' }),
    });
  };

  return {
    bot,
    ctx,
    handlers,
    replies,
    sentMessages,
    forwardedMessages,
    copiedMessages,
    editedMessages,
    register,
    get getChatMemberCalls() {
      return getChatMemberCalls;
    },
    logPath,
  };
}

const aliasHarness = createTerminalWatchHarness({
  commandText: `/watch ${uuid}`,
  sessionInfo: { requesterUserId: 1778001, isolationBackend: 'screen', url: 'https://github.com/owner/repo/issues/1778' },
  repoVisibility: { isPublic: true, visibility: 'public' },
  statusResult: { exists: true, uuid, status: 'executed', isolation: 'screen', logPath, command: 'solve https://github.com/owner/repo/issues/1778' },
  logPath,
});
await aliasHarness.register();
assert(aliasHarness.handlers.has('watch'), 'registers /watch as an alias for /terminal_watch');

const requesterTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-watch-1778-'));
const requesterLogPath = path.join(requesterTempDir, `${uuid}.log`);
await fs.writeFile(requesterLogPath, 'requester session log\n');

const requesterHarness = createTerminalWatchHarness({
  commandText: `/terminal_watch ${uuid}`,
  sessionInfo: { requesterUserId: 1778001, isolationBackend: 'screen', url: 'https://github.com/owner/repo/issues/1778' },
  repoVisibility: { isPublic: true, visibility: 'public' },
  statusResult: { exists: true, uuid, status: 'executed', isolation: 'screen', logPath: requesterLogPath, command: 'solve https://github.com/owner/repo/issues/1778' },
  logPath: requesterLogPath,
});
await requesterHarness.register();
await requesterHarness.handlers.get('terminal_watch')(requesterHarness.ctx);
await new Promise(resolve => setTimeout(resolve, 20));
assert(requesterHarness.getChatMemberCalls === 0, 'session requester does not need chat-owner lookup');
assert(
  requesterHarness.replies.some(([text]) => String(text).includes('Terminal watch complete')),
  'session requester can start /terminal_watch for their own task'
);

const ownerHarness = createTerminalWatchHarness({
  commandText: `/terminal_watch ${uuid}`,
  sessionInfo: { requesterUserId: 1778001, isolationBackend: 'screen', url: 'https://github.com/owner/repo/issues/1778' },
  repoVisibility: { isPublic: true, visibility: 'public' },
  statusResult: { exists: true, uuid, status: 'executed', isolation: 'screen', logPath: requesterLogPath, command: 'solve https://github.com/owner/repo/issues/1778' },
  logPath: requesterLogPath,
  fromId: 1778002,
  getChatMember: async () => ({ status: 'creator' }),
});
await ownerHarness.register();
await ownerHarness.handlers.get('terminal_watch')(ownerHarness.ctx);
await new Promise(resolve => setTimeout(resolve, 20));
assert(ownerHarness.getChatMemberCalls === 1, 'non-requester chat owner still uses owner authorization path');
assert(
  ownerHarness.replies.some(([text]) => String(text).includes('Terminal watch complete')),
  'chat owner can still start /terminal_watch for any task'
);

const dmError = new Error("Forbidden: bot can't initiate conversation with a user");
dmError.code = 403;
const dmHarness = createTerminalWatchHarness({
  commandText: `/watch ${uuid}`,
  sessionInfo: { requesterUserId: 1778001, isolationBackend: 'screen', url: 'https://github.com/owner/private-repo/issues/1778' },
  repoVisibility: { isPublic: false, visibility: 'private' },
  statusResult: { exists: true, uuid, status: 'executed', isolation: 'screen', logPath: requesterLogPath, command: 'solve https://github.com/owner/private-repo/issues/1778' },
  logPath: requesterLogPath,
  forwardMessage: async () => {
    throw dmError;
  },
  copyMessage: async () => {
    throw dmError;
  },
  sendMessage: async () => {
    throw dmError;
  },
});
await dmHarness.register();
const dmWatchHandler = dmHarness.handlers.get('watch');
const originalConsoleError = console.error;
console.error = () => {};
try {
  if (dmWatchHandler) {
    await dmWatchHandler(dmHarness.ctx);
  }
} finally {
  console.error = originalConsoleError;
}
assert(typeof dmWatchHandler === 'function', 'can invoke the /watch alias handler');
assert(dmHarness.getChatMemberCalls === 0, 'session requester private-repo watch does not need chat-owner lookup');
assert(
  dmHarness.replies.some(([text]) => String(text).includes('Please open a private chat with me and send /start')),
  'DM delivery failure tells requester to start the bot privately'
);

await fs.rm(requesterTempDir, { recursive: true, force: true });

console.log('\n' + '='.repeat(80));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(80));

if (failed > 0) process.exit(1);
