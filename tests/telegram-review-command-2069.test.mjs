/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { buildReviewCommandArgs, registerReviewCommand } from '../src/telegram-review-command.lib.mjs';
const url = 'https://github.com/owner/repo/pull/42';

function setup(overrides = {}, text = `/review ${url} --tool codex --think high`) {
  const calls = [];
  const replies = [];
  const registrations = [];
  const ctx = { chat: { id: 1, type: 'supergroup' }, from: { id: 2, first_name: 'Reviewer' }, message: { text, message_id: 3 } };
  const options = {
    reviewEnabled: true,
    isOldMessage: () => false,
    isForwarded: () => false,
    isGroupChat: () => true,
    isTopicAuthorized: () => true,
    buildAuthErrorMessage: () => 'unauthorized',
    isChatStopped: () => false,
    getStoppedChatRejectMessage: () => 'stopped',
    safeReply: async (_ctx, message) => {
      replies.push(message);
      return { message_id: 4 };
    },
    executeAndUpdateMessage: async (...args) => calls.push(args),
    validateModel: async () => null,
    resolveLocale: () => 'ru',
    ...overrides,
  };
  const { handleReviewCommand } = registerReviewCommand({ command: (...args) => registrations.push(args) }, options);
  return { ctx, calls, replies, registrations, run: () => handleReviewCommand(ctx) };
}

test('review accepts tool options and normalizes a replied PR link', () => {
  const result = buildReviewCommandArgs('/review@Bot --tool codex --focus "logic tests"', `Please review ${url}#discussion_r123`);
  assert.equal(result.target.url, url);
  assert.deepEqual(result.args, [url, '--tool', 'codex', '--focus', 'logic tests']);
  assert.throws(() => buildReviewCommandArgs('/review', 'https://github.com/owner/repo/issues/42'));
  assert.throws(() => buildReviewCommandArgs('/review', `${url} https://github.com/owner/repo/pull/43`));
});

test('registered handler starts review with selected tool, locale, URL context and isolation', async () => {
  const state = setup({}, `/ReViEw@Bot ${url} --tool codex --think high --isolation tmux`);
  await state.run();
  assert.ok(state.registrations[0][0].test('ReViEw'));
  assert.equal(state.calls.length, 1);
  const [, , command, args, , isolation, tool, target] = state.calls[0];
  assert.equal(command, 'review');
  assert.equal(tool, 'codex');
  assert.equal(isolation, 'tmux');
  assert.ok(args.includes('--think'));
  assert.deepEqual(args.slice(-2), ['--language', 'ru']);
  assert.equal(target.normalized, url);
  assert.equal(target.type, 'pull');
});

for (const [name, overrides] of [
  ['disabled', { reviewEnabled: false }],
  ['old message', { isOldMessage: () => true }],
  ['forwarded', { isForwarded: () => true }],
  ['private', { isGroupChat: () => false }],
  ['unauthorized', { isTopicAuthorized: () => false }],
  ['stopped', { isChatStopped: () => true }],
])
  test(`review does not run when ${name}`, async () => {
    const state = setup(overrides);
    await state.run();
    assert.equal(state.calls.length, 0);
  });

for (const flags of ['--auto-merge', '--tool bad', '--think nope', '--isolation nope', '-- model opus']) {
  test(`review rejects invalid options: ${flags}`, async () => {
    const state = setup({}, `/review ${url} ${flags}`);
    await state.run();
    assert.equal(state.calls.length, 0);
    assert.ok(state.replies.some(message => message.includes('❌')));
  });
}

test('bot registers review and includes it in the text fallback', async () => {
  const source = await readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  assert.match(source, /registerReviewCommand/);
  assert.match(source, /review: handleReviewCommand/);
});
