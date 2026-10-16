#!/usr/bin/env node
/**
 * Watchdog for issue #3278: every bot command runs against stubbed slow
 * dependencies, and the test fails if the bot's event loop is blocked past the
 * budget while it serves them.
 *
 * The real src/telegram-bot.mjs runs in a child process with the Telegraf
 * stand-in of tests/fixtures/issue-3206/telegraf-harness.mjs and the event-loop
 * monitor of tests/fixtures/issue-3278/loop-monitor.mjs. The PATH starts with
 * fake `docker`, `gh`, `git`, `$`, `screen`, `tmux`, `pgrep`, `ps` and agent CLI
 * binaries that each take seconds to answer: a handler that waits for one
 * synchronously (execSync, spawnSync) blocks the loop for that long, while an
 * async call only delays its own reply.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3278
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// No single stall of the bot's event loop may exceed this while it serves commands.
// A handler that waits synchronously for a stubbed binary blocks for at least
// SLOW_DEPENDENCY_S; compiling a lazily imported module on first use takes a
// few hundred ms and stays under the budget.
const BLOCK_BUDGET_MS = 1000;
// How long the slow fake binaries take to answer.
const SLOW_DEPENDENCY_S = 3;
// How long the commands are observed after the bot fetched them.
const OBSERVE_MS = 8000;
const STARTUP_DEADLINE_MS = 45_000;

const SLOW_BINARIES = ['docker', 'gh', 'git', '$', 'screen', 'tmux', 'pgrep', 'ps', 'claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini', 'npm', 'npx', 'bun'];
const SESSION = '3c6c0e57-3278-4c1a-9b0d-2f9a7c3b9b5e';
const COMMANDS = ['/help', '/start', '/top', '/tokens', '/queue', '/language', '/subscribe', '/unsubscribe', '/limits', '/version', '/models', '/merge https://github.com/o/r', '/organize', '/accept_invites', `/log ${SESSION}`, `/watch ${SESSION}`, `/stop ${SESSION}`, `/terminal_watch ${SESSION}`, '/solve https://github.com/o/r/issues/1', '/task https://github.com/o/r/issues/1', '/split https://github.com/o/r/issues/1', '/fix https://github.com/o/r/pull/1', '/hive https://github.com/o/r'];

function prepareSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'hive-3278-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  for (const name of SLOW_BINARIES) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\nsleep ${SLOW_DEPENDENCY_S}\nexit 1\n`);
    chmodSync(file, 0o755);
  }
  return { dir, bin, home };
}

const GROUP = { id: -1003278, type: 'supergroup', title: 'Issue 3278' };
const PRIVATE = { id: 3278, type: 'private', first_name: 'Tester' };

function commandUpdate(id, text, chat = GROUP) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: Math.floor(Date.now() / 1000) + 60,
      chat,
      from: { id: 3278, is_bot: false, first_name: 'Tester', username: 'tester' },
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }],
    },
  };
}

function cleanEnv(overrides) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(TELEGRAM_|HIVE_MIND_|GH_|GITHUB_|SENTRY)/.test(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

/** Run the bot with one batch of commands and collect the harness and monitor events. */
function runBot(sandbox) {
  return new Promise(resolve => {
    const events = [];
    let output = '';
    const harness = join(root, 'tests/fixtures/issue-3206/telegraf-harness.mjs');
    const monitor = join(root, 'tests/fixtures/issue-3278/loop-monitor.mjs');
    const child = spawn(process.execPath, ['--import', harness, '--import', monitor, join(root, 'src/telegram-bot.mjs'), '--token', '3278:test-token', '--isolation', 'docker'], {
      cwd: sandbox.home,
      env: cleanEnv({
        HOME: sandbox.home,
        PATH: `${sandbox.bin}:${process.env.PATH}`,
        // The tester owns the chat, so owner-only commands do their real work.
        HIVE_HARNESS_MEMBER_STATUS: 'creator',
        HIVE_HARNESS_BATCHES: JSON.stringify([{ atMs: 100, updates: [...COMMANDS.map((text, index) => commandUpdate(index + 1, text)), commandUpdate(COMMANDS.length + 1, '/auth --status claude', PRIVATE)] }]),
        HIVE_MIND_CPU_THRESHOLD: '1000',
        HIVE_MIND_RAM_THRESHOLD: '1000',
        HIVE_MIND_DISK_THRESHOLD: '1000',
      }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      detached: true,
    });
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (output += chunk));
    let finished = false;
    let observeTimer = null;
    const finish = reason => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearTimeout(observeTimer);
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      resolve({ events, output, reason });
    };
    const deadline = setTimeout(() => finish('deadline'), STARTUP_DEADLINE_MS);
    child.on('message', event => {
      events.push(event);
      if (event.type === 'batch' && event.index === 0) observeTimer = setTimeout(() => finish('observed'), OBSERVE_MS);
    });
    child.on('exit', () => finish('exit'));
  });
}

test('no bot command blocks the event loop on a slow dependency', async () => {
  const sandbox = prepareSandbox();
  try {
    const { events, output, reason } = await runBot(sandbox);
    const fetched = events.findIndex(event => event.type === 'batch' && event.index === 0);
    const context = `reason=${reason}\n--- bot output (tail) ---\n${output.slice(-3000)}`;
    assert.ok(fetched >= 0, `the bot must fetch the command batch\n${context}`);
    assert.equal(reason, 'observed', `the bot must keep running while the commands are served\n${context}`);
    const replies = events.slice(fetched).filter(event => event.type === 'api' && event.method === 'sendMessage');
    assert.ok(
      replies.some(event => /SwarmMindBot Help/.test(event.payload?.text || '')),
      `/help must be answered while the other commands wait on slow dependencies\n${context}`
    );
    // Only stalls that end after the bot fetched the commands are theirs; module loading at startup is not.
    const stalls = events.slice(fetched).filter(event => event.type === 'stall');
    const worst = stalls.reduce((max, stall) => Math.max(max, stall.blockedMs), 0);
    assert.ok(worst <= BLOCK_BUDGET_MS, `the event loop was blocked for ${worst} ms (budget ${BLOCK_BUDGET_MS} ms); stalls: ${JSON.stringify(stalls)}\n${context}`);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});
