/**
 * @hive-mind-test-suite default
 * Issue #3206: besides the launch commands, /models (which may update the
 * agentic CLIs), /auth (which runs a login command), /log (which sanitizes and
 * uploads a log), /stop (which waits for `$ --stop`), /terminal_watch, /limits
 * and /version used to hold the Telegram update loop
 * while their slow step ran. They now run through the same background wrapper,
 * so the update completes at once and the work finishes in the background.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { registerAuthCommand } from '../src/telegram-auth-command.lib.mjs';
import { detachHandler } from '../src/telegram-background-task.lib.mjs';
import { registerLogCommand } from '../src/telegram-log-command.lib.mjs';
import { registerModelsCommand } from '../src/telegram-models-command.lib.mjs';
import { registerStartStopCommands } from '../src/telegram-start-stop-command.lib.mjs';
import { registerTerminalWatchCommand } from '../src/telegram-terminal-watch-command.lib.mjs';

/** A slow step that stays pending until `release()` is called. */
function pendingStep() {
  let release;
  let started = false;
  const done = new Promise(resolve => (release = resolve));
  return {
    run: async (...args) => {
      started = true;
      await done;
      return args;
    },
    release: () => release(),
    get started() {
      return started;
    },
  };
}

function fakeBot() {
  const handlers = new Map();
  return { handlers, command: (pattern, handler) => handlers.set(String(pattern), handler) };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const message = (text, chat) => ({ message: { message_id: 7, text, date: Math.floor(Date.now() / 1000) }, chat, from: { id: 42, username: 'tester' }, telegram: { getChatMember: async () => ({ status: 'creator' }) }, reply: async () => ({}) });

test('/models returns before the CLI refresh finishes', async () => {
  const step = pendingStep();
  const bot = fakeBot();
  registerModelsCommand(bot, { isGroupChat: () => true, isTopicAuthorized: () => true, safeReply: async () => ({}), freshness: step.run, loadCatalogue: async () => ({ models: [] }), detachHandler });
  const handler = bot.handlers.get('/^models$/i');
  const result = handler(message('/models', { id: -1, type: 'supergroup' }));
  assert.equal(result, undefined, 'the update completes without waiting');
  await settle();
  assert.equal(step.started, true, 'the refresh runs in the background');
  step.release();
});

test('/auth returns before the login command finishes', async () => {
  const step = pendingStep();
  const bot = fakeBot();
  registerAuthCommand(bot, { allowedChats: [-1], runCommand: step.run, safeReply: async () => ({}), detachHandler });
  const result = bot.handlers.get('auth')(message('/auth --status claude', { id: 42, type: 'private' }));
  assert.equal(result, undefined, 'the update completes without waiting');
  for (let i = 0; i < 20 && !step.started; i++) await settle();
  assert.equal(step.started, true, 'the auth command runs in the background');
  step.release();
});

test('/log returns before the session lookup finishes', async () => {
  const step = pendingStep();
  const bot = fakeBot();
  await registerLogCommand(bot, { isChatAuthorized: () => true, querySessionStatus: step.run, getTrackedSessionInfo: () => null, detectRepositoryVisibility: async () => ({ isPublic: true }), parseGitHubUrl: () => null, detachHandler });
  const result = bot.handlers.get('log')(message('/log 3c6c0e57-3206-4c1a-9b0d-2f9a7c3b9b5e', { id: -1, type: 'supergroup' }));
  assert.equal(result, undefined, 'the update completes without waiting');
  for (let i = 0; i < 20 && !step.started; i++) await settle();
  assert.equal(step.started, true, 'the session lookup runs in the background');
  step.release();
});

test('/stop returns before the session has stopped', async () => {
  const step = pendingStep();
  const bot = fakeBot();
  registerStartStopCommands(bot, { isOldMessage: () => false, isGroupChat: () => true, isChatAuthorized: () => true, isTopicAuthorized: () => true, safeReply: async () => ({ chat: { id: -1 }, message_id: 8 }), safeEditMessageText: async () => ({}), getTrackedSessionInfo: () => ({ chatId: -1, userId: 42 }), markSessionStopRequested: async () => true, stopIsolatedSession: step.run, detachHandler });
  const result = bot.handlers.get('stop')(message('/stop 3c6c0e57-3206-4c1a-9b0d-2f9a7c3b9b5e', { id: -1, type: 'supergroup' }));
  assert.equal(result, undefined, 'the update completes without waiting');
  for (let i = 0; i < 20 && !step.started; i++) await settle();
  assert.equal(step.started, true, '`$ --stop` runs in the background');
  step.release();
});

test('/terminal_watch and /watch return before the session lookup finishes', async () => {
  const bot = fakeBot();
  const steps = [];
  const querySessionStatus = (...args) => steps.at(-1).run(...args);
  await registerTerminalWatchCommand(bot, { isChatAuthorized: () => true, querySessionStatus, isTerminalSessionStatus: () => false, detachHandler });
  for (const command of ['terminal_watch', 'watch']) {
    const step = pendingStep();
    steps.push(step);
    const result = bot.handlers.get(command)(message(`/${command} 3c6c0e57-3206-4c1a-9b0d-2f9a7c3b9b5e`, { id: -1, type: 'supergroup' }));
    assert.equal(result, undefined, `/${command} completes without waiting`);
    for (let i = 0; i < 20 && !step.started; i++) await settle();
    assert.equal(step.started, true, `/${command} looks the session up in the background`);
    step.release();
  }
});

test('the bot registers /limits and /version through the background wrapper', () => {
  const source = fs.readFileSync(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8'); // hive-sync-ok: test reads a source file
  assert.match(source, /bot\.command\(\s*'limits',\s*detach\(/);
  assert.match(source, /bot\.command\(\s*'version',\s*detach\(/);
  assert.match(source, /registerModelsCommand\(bot, \{[^}]*detachHandler:/);
  assert.match(source, /registerAuthCommand\(bot, \{[^}]*detachHandler:/);
  assert.match(source, /auth: detach\(handleAuthCommand/);
  assert.match(source, /models: detach\(handleModelsCommand/);
  assert.match(source, /stop: detach\(handleStopCommand/);
});
