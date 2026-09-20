#!/usr/bin/env node

/** @hive-mind-test-suite default */

import assert from 'node:assert/strict';
import { parseOrganizeRequest, registerOrganizeCommand } from '../src/telegram-organize-command.lib.mjs';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

const repoUrl = 'https://github.com/octo-org/project';

await test('parser accepts inline and replied repository URLs plus operator notes', () => {
  const inline = parseOrganizeRequest({ commandText: `/organize ${repoUrl} --dry-run --tool codex --model gpt-5.6-sol\nPrefer customer labels.` });
  assert.equal(inline.repository.url, repoUrl);
  assert.equal(inline.dryRun, true);
  assert.equal(inline.tool, 'codex');
  assert.equal(inline.model, 'gpt-5.6-sol');
  assert.equal(inline.operatorInstructions, 'Prefer customer labels.');

  const reply = parseOrganizeRequest({ commandText: '/organize --dry-run\nKeep priorities.', replyText: repoUrl });
  assert.equal(reply.repository.fullName, 'octo-org/project');
  assert.equal(reply.operatorInstructions, 'Keep priorities.');
});

await test('parser rejects issue URLs, conflicting repositories, and unknown options', () => {
  assert.match(parseOrganizeRequest({ commandText: '/organize https://github.com/octo-org/project/issues/1' }).error, /repository URL/i);
  assert.match(parseOrganizeRequest({ commandText: `/organize ${repoUrl}`, replyText: 'https://github.com/other/project' }).error, /one GitHub repository/i);
  assert.match(parseOrganizeRequest({ commandText: `/organize ${repoUrl} --close` }).error, /unknown option/i);
});

function harness(overrides = {}) {
  const calls = { replies: [], edits: [], runs: [] };
  const bot = { command() {} };
  const { handleOrganizeCommand } = registerOrganizeCommand(bot, {
    VERBOSE: false,
    organizeEnabled: true,
    addBreadcrumb: async () => {},
    isOldMessage: () => false,
    isForwarded: () => false,
    isGroupChat: () => true,
    isTopicAuthorized: () => true,
    buildAuthErrorMessage: () => 'not authorized',
    isChatStopped: () => false,
    getStoppedChatRejectMessage: () => 'stopped',
    safeReply: async (_ctx, text) => {
      calls.replies.push(text);
      return { chat: { id: 10 }, message_id: 11 };
    },
    safeEditMessageText: async (_ctx, message, text) => calls.edits.push({ message, text }),
    organizeRepository: async options => {
      calls.runs.push(options);
      return {
        repository: { url: repoUrl, fullName: 'octo-org/project' },
        dryRun: options.dryRun,
        counts: { scanned: 2, changed: 1, unchanged: 1, stale: 0, errors: 0 },
        entries: [{ issue: 1, url: `${repoUrl}/issues/1`, status: options.dryRun ? 'planned' : 'changed', summary: 'type: none → Bug; add: bug' }],
        unsupported: [],
        verification: { ok: true, errors: [] },
        auditPath: '/private/audit.json',
      };
    },
    ...overrides,
  });
  return { calls, handleOrganizeCommand };
}

function ctx({ text = `/organize ${repoUrl}`, replyText = null, forward = false } = {}) {
  return {
    chat: { id: 10, type: 'supergroup' },
    from: { id: 20, username: 'operator' },
    message: {
      message_id: 30,
      text,
      ...(replyText ? { reply_to_message: { text: replyText } } : {}),
      ...(forward ? { forward_origin: { type: 'user' } } : {}),
    },
  };
}

await test('authorized command runs in-process and publishes a concise summary', async () => {
  const { calls, handleOrganizeCommand } = harness();
  await handleOrganizeCommand(ctx({ text: `/organize ${repoUrl} --dry-run\nPrefer bug labels.` }));
  assert.equal(calls.runs.length, 1);
  assert.equal(calls.runs[0].dryRun, true);
  assert.equal(calls.runs[0].operatorInstructions, 'Prefer bug labels.');
  assert.equal(calls.replies.length, 1);
  assert.match(calls.replies[0], /Planning organization/i);
  assert.match(calls.edits[0].text, /Dry run/i);
  assert.match(calls.edits[0].text, /issues\/1/);
  assert.doesNotMatch(calls.edits[0].text, /audit\.json/);
});

await test('overlapping runs for the same repository are rejected atomically', async () => {
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const { calls, handleOrganizeCommand } = harness({
    organizeRepository: async options => {
      calls.runs.push(options);
      await gate;
      return {
        repository: { url: repoUrl, fullName: 'octo-org/project' },
        dryRun: options.dryRun,
        counts: { scanned: 0, changed: 0, unchanged: 0, stale: 0, errors: 0 },
        entries: [],
        unsupported: [],
        verification: { ok: true, errors: [] },
      };
    },
  });
  const first = handleOrganizeCommand(ctx());
  const second = handleOrganizeCommand(ctx());
  await new Promise(resolve => setImmediate(resolve));
  const observedRuns = calls.runs.length;
  release();
  await Promise.all([first, second]);
  assert.equal(observedRuns, 1);
  assert.match(calls.replies.join('\n'), /already active/i);
});

for (const [name, override, expected] of [
  ['disabled commands', { organizeEnabled: false }, /disabled/i],
  ['private chats', { isGroupChat: () => false }, /group chats/i],
  ['unauthorized topics', { isTopicAuthorized: () => false }, /not authorized/i],
  ['stopped chats', { isChatStopped: () => true }, /stopped/i],
]) {
  await test(`handler blocks ${name}`, async () => {
    const { calls, handleOrganizeCommand } = harness(override);
    await handleOrganizeCommand(ctx());
    assert.equal(calls.runs.length, 0);
    assert.match(calls.replies.join('\n'), expected);
  });
}

await test('forwarded commands are ignored but replies are valid input', async () => {
  const forwarded = harness({ isForwarded: () => true });
  await forwarded.handleOrganizeCommand(ctx({ forward: true }));
  assert.equal(forwarded.calls.runs.length, 0);
  assert.equal(forwarded.calls.replies.length, 0);

  const replied = harness();
  await replied.handleOrganizeCommand(ctx({ text: '/organize', replyText: repoUrl }));
  assert.equal(replied.calls.runs.length, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
