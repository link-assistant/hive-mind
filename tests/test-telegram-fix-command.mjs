#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Telegram `/fix` command (issue #1733).
 */

import assert from 'assert/strict';
import { applyFixCommandDefaults, buildFixCommandArgs, findFixRepositoryArg, FIX_COMMAND_NAMES, getFixCommandNameFromText, getFixToolFromArgs, registerFixCommand } from '../src/telegram-fix-command.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

const repoUrl = 'https://github.com/link-assistant/hive-mind';

await test('/fix command is recognized', () => {
  assert.equal(getFixCommandNameFromText(`/fix ${repoUrl}`), 'fix');
  assert.equal(getFixCommandNameFromText('/fix@SwarmMindBot owner/repo'), 'fix');
  assert.equal(getFixCommandNameFromText(`/solve ${repoUrl}`), null);
  assert.equal(getFixCommandNameFromText(''), null);
});

await test('/fix implies --ci-cd because it is the only mode fix supports', () => {
  const built = buildFixCommandArgs(`/fix ${repoUrl}`);
  assert.deepEqual(built.args, [repoUrl, '--ci-cd']);
  assert.equal(built.repository.fullName, 'link-assistant/hive-mind');
});

await test('explicit --ci-cd is not duplicated', () => {
  const args = applyFixCommandDefaults([repoUrl, '--ci-cd']);
  assert.equal(args.filter(arg => arg === '--ci-cd').length, 1);
});

await test('/fix keeps user options and moves the repository to the front', () => {
  const built = buildFixCommandArgs(`/fix --model opus ${repoUrl} --think max`);
  assert.deepEqual(built.args, [repoUrl, '--model', 'opus', '--think', 'max', '--ci-cd']);
});

await test('/fix normalizes the owner/repo shorthand to a full URL', () => {
  const built = buildFixCommandArgs('/fix link-assistant/hive-mind --tool codex');
  assert.deepEqual(built.args, [repoUrl, '--tool', 'codex', '--ci-cd']);
  assert.equal(built.repositoryRaw, 'link-assistant/hive-mind');
  assert.equal(built.repository.url, repoUrl);
});

await test('/fix without a repository reports no repository', () => {
  const built = buildFixCommandArgs('/fix --model opus');
  assert.equal(built.repository, null);
  assert.equal(built.repositoryRaw, null);
});

await test('non-GitHub URLs are not accepted as the fix repository', () => {
  assert.equal(findFixRepositoryArg(['https://gitlab.com/owner/repo']), null);
  assert.equal(findFixRepositoryArg(['https://github.com/owner']), null);
  assert.equal(findFixRepositoryArg([repoUrl]), repoUrl);
});

await test('tool can be parsed from fix command arguments', () => {
  assert.equal(getFixToolFromArgs([repoUrl, '--tool', 'codex']), 'codex');
  assert.equal(getFixToolFromArgs([repoUrl, '--tool=agent']), 'agent');
  assert.equal(getFixToolFromArgs([repoUrl]), 'claude');
});

function buildFixHarness(overrides = {}) {
  const bot = { command() {} };
  const calls = { executed: [], replies: [], plainReplies: [] };
  const { handleFixCommand } = registerFixCommand(bot, {
    VERBOSE: false,
    fixEnabled: true,
    addBreadcrumb: async () => {},
    isOldMessage: () => false,
    isForwardedOrReply: () => false,
    isGroupChat: () => true,
    isTopicAuthorized: () => true,
    buildAuthErrorMessage: () => 'not authorized',
    isChatStopped: () => false,
    getStoppedChatRejectMessage: () => 'stopped',
    safeReply: async (_ctx, text) => {
      calls.replies.push(text);
      return { chat: { id: 100 }, message_id: 301 };
    },
    executeAndUpdateMessage: async (ctx, message, commandName, args, infoBlock, isolation, tool, urlContext) => {
      calls.executed.push({ commandName, args, infoBlock, isolation, tool, urlContext });
    },
    ...overrides,
  });
  return { handleFixCommand, calls };
}

function buildFixCtx(message) {
  return {
    chat: { id: 100, type: 'group' },
    from: { id: 200, username: 'tester' },
    message: { message_id: 300, ...message },
    reply: async (text, options) => {
      buildFixCtx.lastPlainReply = { text, options };
      return { chat: { id: 100 }, message_id: 301 };
    },
    telegram: { editMessageText: async () => {} },
  };
}

await test('/fix spawns the fix CLI with the repository, --ci-cd and forwarded options', async () => {
  const { handleFixCommand, calls } = buildFixHarness();
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl} --tool codex --model gpt-5.5` }));
  assert.equal(calls.executed.length, 1);
  assert.equal(calls.executed[0].commandName, 'fix');
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--tool', 'codex', '--model', 'gpt-5.5', '--ci-cd']);
  assert.equal(calls.executed[0].tool, 'codex');
  assert.equal(calls.executed[0].isolation, null);
  assert.deepEqual(calls.executed[0].urlContext, { owner: 'link-assistant', repo: 'hive-mind', normalized: repoUrl });
  assert.match(calls.executed[0].infoBlock, /Repository: /);
  assert.match(calls.executed[0].infoBlock, /🛠 Options: /);
});

await test('/fix forwards the resolved locale as --language', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ resolveLocale: () => 'ru' });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--ci-cd', '--language', 'ru']);
});

await test('/fix does not override an explicit --language', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ resolveLocale: () => 'ru' });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl} --language en` }));
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--language', 'en', '--ci-cd']);
});

await test('/fix extracts --isolation instead of forwarding it to the CLI', async () => {
  const { handleFixCommand, calls } = buildFixHarness();
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl} --isolation docker` }));
  assert.equal(calls.executed[0].isolation, 'docker');
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--ci-cd']);
});

await test('/fix rejects an invalid --isolation value', async () => {
  const { handleFixCommand, calls } = buildFixHarness();
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl} --isolation vm` }));
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.replies.length, 1);
  assert.match(calls.replies[0], /Invalid --isolation value/);
});

await test('/fix rejects an invalid model', async () => {
  const { handleFixCommand, calls } = buildFixHarness();
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl} --model not-a-model` }));
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.replies.length, 1);
  assert.match(calls.replies[0], /not-a-model/);
});

await test('/fix without a repository explains the usage and does not execute', async () => {
  const { handleFixCommand, calls } = buildFixHarness();
  await handleFixCommand(buildFixCtx({ text: '/fix --model opus' }));
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.replies.length, 1);
  assert.match(calls.replies[0], /Missing GitHub repository URL/);
});

// Issue #1922: forwarding the bot's own message must never re-execute a command.
await test('forwarded or replied /fix is ignored — no execution', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ isForwardedOrReply: () => true });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}`, forward_origin: { type: 'user', sender_user: { id: 1 } } }));
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.replies.length, 0);
});

await test('/fix is ignored when disabled on the bot instance', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ fixEnabled: false });
  const ctx = buildFixCtx({ text: `/fix ${repoUrl}` });
  await handleFixCommand(ctx);
  assert.equal(calls.executed.length, 0);
  assert.match(buildFixCtx.lastPlainReply.text, /disabled on this bot instance/);
});

await test('/fix is ignored in a stopped chat', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ isChatStopped: () => true });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.equal(calls.executed.length, 0);
  assert.deepEqual(calls.replies, ['stopped']);
});

await test('/fix is ignored outside group chats', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ isGroupChat: () => false });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.equal(calls.executed.length, 0);
  assert.match(buildFixCtx.lastPlainReply.text, /only works in group chats/);
});

await test('/fix is ignored in an unauthorized topic', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ isTopicAuthorized: () => false });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.equal(calls.executed.length, 0);
  assert.match(buildFixCtx.lastPlainReply.text, /not authorized/);
});

await test('/fix is ignored for messages sent before the bot started', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ isOldMessage: () => true });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.replies.length, 0);
});

// Issue #2085: /fix hands its generated issue to /solve, so the operator's
// TELEGRAM_SOLVE_OVERRIDES must reach the solve started by /fix — otherwise
// solve defaults like --attach-logs are silently dropped.
await test('/fix applies operator solve overrides to the forwarded solve args', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ solveOverrides: ['--attach-logs', '--auto-continue'] });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.equal(calls.executed.length, 1);
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--ci-cd', '--attach-logs', '--auto-continue']);
  assert.match(calls.executed[0].infoBlock, /🔒 Solve overrides: --attach-logs --auto-continue/);
});

await test('/fix solve overrides win over a conflicting user flag value', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ solveOverrides: ['--model', 'opus'] });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl} --model sonnet` }));
  // The user's --model sonnet is dropped and the operator override wins.
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--ci-cd', '--model', 'opus']);
});

await test('/fix honors an --isolation override from solve overrides', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ solveOverrides: ['--isolation', 'tmux', '--attach-logs'] });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.equal(calls.executed[0].isolation, 'tmux');
  // Isolation is extracted from the overrides, not forwarded to the CLI.
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--ci-cd', '--attach-logs']);
});

await test('/fix per-command --isolation still applies when overrides omit it', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ solveOverrides: ['--attach-logs'] });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl} --isolation docker` }));
  assert.equal(calls.executed[0].isolation, 'docker');
  assert.deepEqual(calls.executed[0].args, [repoUrl, '--ci-cd', '--attach-logs']);
});

await test('/fix rejects an invalid --isolation value inside solve overrides', async () => {
  const { handleFixCommand, calls } = buildFixHarness({ solveOverrides: ['--isolation', 'vm'] });
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.equal(calls.executed.length, 0);
  assert.equal(calls.replies.length, 1);
  assert.match(calls.replies[0], /Invalid --isolation value 'vm' in solve overrides/);
});

await test('/fix without solve overrides omits the locked-options line', async () => {
  const { handleFixCommand, calls } = buildFixHarness();
  await handleFixCommand(buildFixCtx({ text: `/fix ${repoUrl}` }));
  assert.doesNotMatch(calls.executed[0].infoBlock, /Solve overrides/);
});

await test('registerFixCommand registers every fix command name with the bot', () => {
  const registered = [];
  const bot = {
    command(patterns) {
      registered.push(patterns);
    },
  };
  const result = registerFixCommand(bot, { fixEnabled: true, addBreadcrumb: async () => {}, isOldMessage: () => false, isGroupChat: () => true, isTopicAuthorized: () => true, isChatStopped: () => false, safeReply: async () => {}, executeAndUpdateMessage: async () => {} });
  assert.deepEqual(result.FIX_COMMAND_NAMES, FIX_COMMAND_NAMES);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].length, FIX_COMMAND_NAMES.length);
  assert.equal(registered[0][0].test('fix'), true);
  assert.equal(registered[0][0].test('fixup'), false);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
