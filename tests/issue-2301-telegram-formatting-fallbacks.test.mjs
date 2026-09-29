/**
 * @hive-mind-test-suite default
 * Issue #2301: a production bot log showed 1474 "⚠️ Formatting error detected. Showing plain text
 * fallback." notices. Every one had one of two root causes:
 *  - 1462 were "400: Bad Request: message is not modified" edits. They are not formatting errors, and
 *    the plain-text retry replaced a correct message with a false warning;
 *  - 12 were /queue statuses that printed a bare URL with `_` in the repo name
 *    (https://github.com/Surrogate-TM/save_visiogetbb/pull/18). Legacy Markdown opens an italic
 *    entity there and rejects the whole message.
 * The fallback itself must keep working for genuine formatting errors.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { isTelegramMessageNotModifiedError, isTelegramTargetBadRequestError, safeEditMessageText, safeSendMessage } from '../src/telegram-safe-reply.lib.mjs';
import { formatQueueExecutingItems, formatQueueHistorySection, formatQueueItemLink, formatQueuePendingItems } from '../src/telegram-solve-queue.helpers.lib.mjs';
import { isValidTelegramMarkdown, parseTelegramLegacyMarkdown } from '../src/telegram-markdown-validator.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';

const FALLBACK_MARKER = /Formatting error detected/;

function badRequest(description) {
  const error = new Error(`400: ${description}`);
  error.description = description;
  error.response = { error_code: 400, description };
  return error;
}

const NOT_MODIFIED = 'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message';
const UNDERSCORE_URL = 'https://github.com/Surrogate-TM/save_visiogetbb/pull/18';

function recordingTelegram(editImpl) {
  const edits = [];
  const sends = [];
  return {
    edits,
    sends,
    editMessageText: async (chatId, messageId, inlineMessageId, text, options) => {
      edits.push({ text, options });
      return editImpl(text, options, edits.length);
    },
    sendMessage: async (chatId, text, options) => {
      sends.push({ text, options });
      return { message_id: 99 };
    },
  };
}

test('not-modified edits reach the caller unchanged and never show a formatting warning', async () => {
  const telegram = recordingTelegram(() => {
    throw badRequest(NOT_MODIFIED);
  });
  await assert.rejects(safeEditMessageText(telegram, 1, 2, undefined, '*Queue* status', {}), error => isTelegramMessageNotModifiedError(error));
  assert.equal(telegram.edits.length, 1, 'no plain-text retry');
  assert.equal(telegram.sends.length, 0);
  assert.ok(!telegram.edits.some(edit => FALLBACK_MARKER.test(edit.text)));
});

test('target 400s (deleted message, unknown chat) are rethrown without a false formatting warning', async () => {
  for (const description of ['Bad Request: message to edit not found', "Bad Request: message can't be edited", 'Bad Request: chat not found']) {
    assert.ok(isTelegramTargetBadRequestError(badRequest(description)), description);
    const telegram = recordingTelegram(() => {
      throw badRequest(description);
    });
    await assert.rejects(safeEditMessageText(telegram, 1, 2, undefined, 'text', {}), { description });
    assert.equal(telegram.edits.length, 1, `${description}: no plain-text retry`);

    const sendTelegram = {
      calls: [],
      sendMessage: async (chatId, text) => {
        sendTelegram.calls.push(text);
        throw badRequest(description);
      },
    };
    await assert.rejects(safeSendMessage(sendTelegram, 1, 'text'), { description });
    assert.equal(sendTelegram.calls.length, 1, `${description}: no plain-text send retry`);
  }
});

test('a genuine formatting rejection still falls back to plain text (safety net kept)', async () => {
  const telegram = recordingTelegram((text, options) => {
    if (options?.parse_mode) throw badRequest("Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 0");
    return { message_id: 2 };
  });
  // Valid for the local validator, so only Telegram's rejection can trigger the fallback.
  await safeEditMessageText(telegram, 1, 2, undefined, '*fine*', {});
  assert.equal(telegram.edits.length, 2);
  assert.equal(telegram.edits[1].options.parse_mode, undefined);
  assert.match(telegram.edits[1].text, FALLBACK_MARKER);
});

test('an unrecognised 400 still falls back to plain text', async () => {
  const telegram = recordingTelegram((text, options) => {
    if (options?.parse_mode) throw badRequest('Bad Request: something new');
    return { message_id: 2 };
  });
  await safeEditMessageText(telegram, 1, 2, undefined, 'hello', {});
  assert.equal(telegram.edits.length, 2);
});

test('SolveQueue.updateItemMessage treats "not modified" as up to date', async () => {
  const queue = new SolveQueue({ verbose: false });
  const logged = [];
  queue.log = message => logged.push(message);
  const telegram = recordingTelegram(() => {
    throw badRequest(NOT_MODIFIED);
  });
  const item = { messageInfo: { chatId: 1, messageId: 2 }, ctx: { telegram }, lastMessageUpdateTime: 0 };
  await queue.updateItemMessage(item, 'same text');
  assert.ok(item.lastMessageUpdateTime > 0, 'refresh time recorded so the periodic update backs off');
  assert.deepEqual(logged, []);
  assert.equal(telegram.edits.length, 1);
});

test('queue links with `_` in the repository name are valid legacy Markdown', () => {
  const link = formatQueueItemLink(UNDERSCORE_URL);
  assert.equal(link, `[Surrogate-TM/save_visiogetbb#18](${UNDERSCORE_URL})`);
  const parsed = parseTelegramLegacyMarkdown(`• ${link} (▶️ 5m)`);
  assert.ok(parsed.ok);
  assert.equal(parsed.text, '• Surrogate-TM/save_visiogetbb#18 (▶️ 5m)');
  assert.deepEqual(
    parsed.entities.map(entity => entity.url),
    [UNDERSCORE_URL]
  );

  const items = [{ url: UNDERSCORE_URL, waitMs: 1000 }];
  for (const text of [formatQueueExecutingItems({ items, locale: 'en', label: 'Processing' }), formatQueuePendingItems({ items, locale: 'en', label: 'Pending' }), formatQueueHistorySection({ items: [{ url: UNDERSCORE_URL, completedAt: new Date(), startedAt: new Date() }], emoji: '✅', label: 'Completed', max: 5, locale: 'en' })]) {
    assert.ok(isValidTelegramMarkdown(text), text);
  }
});

test('failed queue items keep a raw error reason from breaking the status message', () => {
  const error = 'spawn start_command ENOENT: *missing* `bin` [x]';
  const text = formatQueueHistorySection({ items: [{ url: UNDERSCORE_URL, error }], emoji: '❌', label: 'Failed', max: 5, locale: 'en', withError: true });
  const parsed = parseTelegramLegacyMarkdown(text);
  assert.ok(parsed.ok, text);
  assert.ok(parsed.text.includes(`— ${error}`));
});

test('non-GitHub queue URLs are escaped for top-level Markdown', () => {
  const url = 'https://example.com/a_b*c`d[e';
  const text = formatQueueItemLink(url);
  const parsed = parseTelegramLegacyMarkdown(text);
  assert.ok(parsed.ok);
  assert.equal(parsed.text, url);
});

test('backslashes in bare queue URLs are shown exactly, not doubled', () => {
  for (const url of ['https://example.com/a\\_b', 'https://example.com/a\\\\_b', 'https://example.com/x\\', 'C:\\dir\\file_name']) {
    const parsed = parseTelegramLegacyMarkdown(formatQueueItemLink(url));
    assert.ok(parsed.ok, url);
    assert.equal(parsed.text, url);
  }
});
