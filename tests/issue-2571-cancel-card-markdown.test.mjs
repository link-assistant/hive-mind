/**
 * @hive-mind-test-suite default
 *
 * Issue #2571: the production log has a /stop "Cancelled" card that Telegram
 * refused with "Can't find end of the entity starting at byte offset 113" —
 * the underscore in `@anton_poroshin` opened an italic entity that never closed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { updateQueueCardForCancellation } from '../src/telegram-start-stop-command.lib.mjs';
import { parseTelegramLegacyMarkdown, validateTelegramText } from '../src/telegram-markdown-validator.lib.mjs';

function cardItem() {
  const edits = [];
  const item = {
    messageInfo: { chatId: -1002975819706, messageId: 42 },
    ctx: {
      telegram: {
        editMessageText: async (chatId, messageId, _inline, text, options) => {
          edits.push({ text, options });
          return true;
        },
      },
    },
  };
  return { item, edits };
}

test('a user name with an underscore keeps the Cancelled card valid Markdown', async () => {
  const { item, edits } = cardItem();
  const ok = await updateQueueCardForCancellation(item, 'https://github.com/owner/my_repo/issues/7', 'codex', '@anton_poroshin');
  assert.equal(ok, true);
  assert.equal(edits.length, 1, 'One edit, no plain-text retry');
  assert.equal(edits[0].options?.parse_mode, 'Markdown');
  assert.deepEqual(validateTelegramText(edits[0].text, 'Markdown'), { valid: true });
  const shown = parseTelegramLegacyMarkdown(edits[0].text);
  const plain = shown.text ?? shown;
  assert.match(String(plain), /by @anton_poroshin via \/stop\./, 'The reader still sees the exact user name');
  assert.match(String(plain), /my_repo/, 'The reader still sees the exact URL');
});
