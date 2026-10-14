#!/usr/bin/env node
/**
 * Regression test for issue #3206: while one command prepares its work session
 * (here: `/codex … --model formal-ai`, whose first launch pulls the Formal AI
 * sidecar image), the bot must keep answering every other chat.
 *
 * The real src/telegram-bot.mjs runs in a child process. The preload in
 * tests/fixtures/issue-3206/telegraf-harness.mjs replaces Telegraf with a fake
 * that polls exactly like Telegraf 4 (one batch at a time, `Promise.all`), and
 * the PATH starts with fake `docker`, `gh` and `pgrep` binaries: `docker pull`
 * hangs, everything else fails fast. No network and no real docker is used.
 *
 * The `/help` update becomes available as soon as the `docker pull` starts; its
 * reply must follow within one second. A repeated `/codex` for the same URL in
 * that batch is refused as a duplicate instead of starting a second launch.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3206
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HELP_REPLY_BUDGET_MS = 1000;
const STARTUP_DEADLINE_MS = 45_000;

function writeExecutable(path, body) {
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function prepareSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'hive-3206-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  const alive = join(dir, 'alive');
  const pullStarted = join(dir, 'pull-started');
  writeFileSync(alive, '');
  // `docker pull` hangs until the test removes the `alive` file (at most 30 s).
  writeExecutable(
    join(bin, 'docker'),
    `echo "docker $*" >> "${join(dir, 'calls.log')}"
case "$1" in
  pull) touch "${pullStarted}"; i=0; while [ -e "${alive}" ] && [ $i -lt 300 ]; do sleep 0.1; i=$((i+1)); done; exit 1;;
  info) echo '{}'; exit 0;;
  *) exit 1;;
esac`
  );
  writeExecutable(join(bin, 'gh'), `echo "gh $*" >> "${join(dir, 'calls.log')}"\nexit 1`);
  writeExecutable(join(bin, 'pgrep'), 'exit 1');
  return { dir, bin, home, alive, pullStarted, callsLog: join(dir, 'calls.log') };
}

function commandUpdate(id, text) {
  return {
    update_id: id,
    message: {
      message_id: id,
      chat: { id: -1003206, type: 'supergroup', title: 'Issue 3206' },
      from: { id: 3206, is_bot: false, first_name: 'Tester', username: 'tester' },
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

/**
 * Run the bot with the given update batches and collect the harness events
 * until `watch(event, finish)` calls `finish` or the deadline passes.
 */
function runBot({ sandbox, batches, watch, deadlineMs }) {
  return new Promise(resolve => {
    const events = [];
    let output = '';
    const child = spawn(process.execPath, ['--import', join(root, 'tests/fixtures/issue-3206/telegraf-harness.mjs'), join(root, 'src/telegram-bot.mjs'), '--token', '3206:test-token', '--isolation', 'docker'], {
      cwd: sandbox.home,
      env: cleanEnv({
        HOME: sandbox.home,
        PATH: `${sandbox.bin}:${process.env.PATH}`,
        HIVE_HARNESS_BATCHES: JSON.stringify(batches),
        // Host load must not route the command into the queue.
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
    const finish = reason => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      rmSync(sandbox.alive, { force: true });
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already gone.
      }
      resolve({ events, output, reason });
    };
    const deadline = setTimeout(() => finish('deadline'), deadlineMs);
    child.on('message', event => {
      events.push(event);
      watch(event, finish);
    });
    child.on('exit', () => finish('exit'));
  });
}

test('a /codex launch stuck in docker pull does not delay /help in another update', async () => {
  const sandbox = prepareSandbox();
  try {
    const batches = [
      { atMs: 100, updates: [commandUpdate(1, '/codex https://github.com/o/r/issues/1 --model formal-ai')] },
      { afterFile: sandbox.pullStarted, updates: [commandUpdate(2, '/help'), commandUpdate(3, '/codex https://github.com/o/r/issues/1 --model formal-ai')] },
    ];
    const isHelpReply = event => event.type === 'api' && event.method === 'sendMessage' && /SwarmMindBot Help/.test(event.payload?.text || '');
    const isDuplicateReply = event => event.type === 'api' && event.method === 'sendMessage' && /This URL is being processed|already running for this URL/.test(event.payload?.text || '');
    const helpAvailable = events => events.find(event => event.type === 'available' && event.index === 1);
    let helpReplied = false;
    let duplicateReplied = false;
    let budgetTimer = null;
    const { events, output, reason } = await runBot({
      sandbox,
      batches,
      deadlineMs: STARTUP_DEADLINE_MS,
      watch: (event, finish) => {
        helpReplied ||= isHelpReply(event);
        duplicateReplied ||= isDuplicateReply(event);
        if (helpReplied && duplicateReplied) finish('both-replied');
        // Stop waiting well after the budget so a failure is quick and clear.
        if (event.type === 'available' && event.index === 1) budgetTimer = setTimeout(() => finish('help-timeout'), HELP_REPLY_BUDGET_MS * 3);
      },
    });
    clearTimeout(budgetTimer);
    const calls = existsSync(sandbox.callsLog) ? readFileSync(sandbox.callsLog, 'utf8') : '';
    const context = `reason=${reason}\n--- docker/gh calls ---\n${calls}\n--- bot output (tail) ---\n${output.slice(-3000)}`;
    assert.ok(existsSync(sandbox.pullStarted), `the /codex launch must reach docker pull\n${context}`);
    const available = helpAvailable(events);
    assert.ok(available, `the /help update must become available\n${context}`);
    const reply = events.find(isHelpReply);
    assert.ok(reply, `/help got no reply while /codex was stuck in docker pull\n${context}`);
    const latency = reply.atMs - available.atMs;
    assert.ok(latency <= HELP_REPLY_BUDGET_MS, `/help answered after ${latency} ms (budget ${HELP_REPLY_BUDGET_MS} ms)\n${context}`);
    assert.ok(events.some(isDuplicateReply), `the repeated /codex for the same URL must be refused while the first launch runs\n${context}`);
    assert.equal(calls.split('\n').filter(line => line.startsWith('docker pull')).length, 1, `only one launch may pull the image\n${context}`);
  } finally {
    rmSync(sandbox.dir, { recursive: true, force: true });
  }
});
