/**
 * @hive-mind-test-suite default
 * Issue #744 (and #733): an AI session must not kill the bot with broad process-kill commands.
 *
 * On 2025-11-14 a solve session without Docker isolation hit EADDRINUSE, said
 * "Let me kill all node processes" and ran `pkill -9 node`, which killed the
 * Telegram bot running as the same user on the same host (#733). This test
 * checks the three guards added on top of Docker isolation: the prompt rule in
 * every tool's system prompt, the Claude deny rules, and the bot's process title.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { buildDisallowedToolsList, PROCESS_KILL_DENY_RULES, resolveClaudeSessionToolFlags } from '../src/useless-tools.lib.mjs';
import { shellQuote } from '../src/shell-command.lib.mjs';

const tools = ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen'];
const params = { issueUrl: 'https://github.com/link-assistant/hive-mind/issues/744', issueNumber: 744, prNumber: 745, prUrl: 'https://github.com/link-assistant/hive-mind/pull/745', branchName: 'issue-744', tempDir: '/tmp/work', workspaceTmpDir: '/tmp/work-tmp', owner: 'link-assistant', repo: 'hive-mind', argv: {} };

for (const tool of tools) {
  test(`${tool}: the system prompt forbids broad process kills and says to stop processes by recorded PID`, async () => {
    const { buildSystemPrompt } = await import(`../src/${tool}.prompts.lib.mjs`);
    const system = buildSystemPrompt(params);
    assert.match(system, /Stop only processes you started, by the PID you recorded/);
    assert.match(system, /Never run broad process-kill commands such as pkill node, pkill -f with a broad pattern, killall, kill -9 -1 or kill 0/);
    assert.match(system, /they also kill the bot, the other sessions and the tool running you/);
    assert.match(system, /lsof -i :PORT or ss -ltnp/);
    assert.equal(system.split('Stop only processes you started').length - 1, 1, `${tool}: the rule appears once`);
  });
}

test('PROCESS_KILL_DENY_RULES denies pkill and killall through the Bash tool', () => {
  assert.deepEqual([...PROCESS_KILL_DENY_RULES], ['Bash(pkill:*)', 'Bash(killall:*)']);
  assert.ok(Object.isFrozen(PROCESS_KILL_DENY_RULES));
  // The baseline settings.json list stays the useless-tools list only.
  for (const rule of PROCESS_KILL_DENY_RULES) assert.ok(!buildDisallowedToolsList().includes(rule));
});

test('Claude sessions always get the deny rules, also with useless tools enabled', async () => {
  const log = async () => {};
  const fallbackBuildMcpConfigWithoutPlaywright = async () => null;
  for (const argv of [{}, { uselessToolsDisabled: false }, { playwrightMcp: false }]) {
    const { disallowedToolsList } = await resolveClaudeSessionToolFlags({ argv, log, fallbackBuildMcpConfigWithoutPlaywright });
    for (const rule of PROCESS_KILL_DENY_RULES) assert.ok(disallowedToolsList.includes(rule), `${JSON.stringify(argv)}: ${rule}`);
  }
});

test('the displayed claude command quotes the deny rules so a shell does not glob or split them', () => {
  assert.equal(shellQuote('Bash(pkill:*)'), "'Bash(pkill:*)'");
  const source = readFileSync(new URL('../src/claude.lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /--disallowedTools \$\{disallowedToolsList\.map\(shellQuote\)\.join\(' '\)\}/);
});

test('the Telegram bot sets a process title that `pkill node` and `killall node` do not match', () => {
  const source = readFileSync(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  const head = source.split('\n').slice(0, 15).join('\n');
  assert.match(head, /^process\.title = 'hive-telegram-bot';$/m, 'set before any slow startup work');
});

test('on Linux the title replaces both the comm name and the cmdline that pkill and killall match', { skip: process.platform !== 'linux' }, async () => {
  const child = spawn(process.execPath, ['-e', "process.title = 'hive-telegram-bot'; process.stdout.write('ready'); setTimeout(() => {}, 10000);"], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('error', reject);
    });
    const comm = readFileSync(`/proc/${child.pid}/comm`, 'utf8').trim();
    const cmdline = readFileSync(`/proc/${child.pid}/cmdline`, 'utf8').replace(/\0/g, ' ');
    assert.equal(comm, 'hive-telegram-b'); // truncated to 15 characters by the kernel
    assert.doesNotMatch(comm, /node/); // `pkill node`, `pkill -x node`, `killall node`
    assert.doesNotMatch(cmdline, /node/); // `pkill -f node`
  } finally {
    child.kill();
  }
});
