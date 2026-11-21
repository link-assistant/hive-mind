#!/usr/bin/env node
/**
 * RuleTester tests for telegram-safety/no-unescaped-telegram-markdown: dynamic
 * text at the top level of a legacy-Markdown Telegram message must be escaped,
 * placed in a code span, or marked with a reason.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3505
 */

import { join } from 'node:path';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import noUnescapedTelegramMarkdown, { _testing } from '../eslint-rules/no-unescaped-telegram-markdown.mjs';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const filename = join(process.cwd(), 'src/example.lib.mjs');
const telegramFilename = join(process.cwd(), 'src/telegram-example.lib.mjs');
const violation = { messageId: 'violation' };
const lines = (...code) => code.join('\n');

describe('markdownContextAt', () => {
  const { markdownContextAt } = _testing;
  it('is top level outside entities', () => {
    assert.equal(markdownContextAt(''), 'top');
    assert.equal(markdownContextAt('Status: '), 'top');
    assert.equal(markdownContextAt('a `code` then '), 'top');
    assert.equal(markdownContextAt('*bold* and _italic_ '), 'top');
    assert.equal(markdownContextAt('[label](https://x) '), 'top');
  });
  it('sees code spans, code blocks and link URLs', () => {
    assert.equal(markdownContextAt('Session: `'), 'code');
    assert.equal(markdownContextAt('```\n'), 'code');
    assert.equal(markdownContextAt('[open]('), 'url');
  });
  it('sees bold, italic and link labels as entities', () => {
    assert.equal(markdownContextAt('*Reason: '), 'entity');
    assert.equal(markdownContextAt('_note '), 'entity');
    assert.equal(markdownContextAt('['), 'entity');
  });
  it('ignores escaped openers', () => {
    assert.equal(markdownContextAt('a \\_ b '), 'top');
    assert.equal(markdownContextAt('a \\` b '), 'top');
  });
});

ruleTester.run('no-unescaped-telegram-markdown', noUnescapedTelegramMarkdown, {
  valid: [
    // Escaped, formatted, translated or literal values.
    { code: 'await safeReply(ctx, `Repository: ${escapeMarkdown(repo)}`);', filename },
    { code: "await safeReply(ctx, `${t('telegram.done', { url: escapeMarkdown(url) }, { locale })}`);", filename },
    { code: "await safeReply(ctx, `Count: ${items.length}, total ${count + 1}, ${'fixed'}`);", filename },
    { code: 'await safeSendMessage(bot.telegram, chatId, `Done in ${formatDuration(ms)}`);', filename },
    // Verbatim contexts: code spans, code blocks, link URLs.
    { code: 'await safeReply(ctx, `Session: \\`${sessionName}\\``);', filename },
    { code: 'await safeReply(ctx, `Log:\\n\\`\\`\\`\\n${output}\\n\\`\\`\\``);', filename },
    { code: 'await safeReply(ctx, `[Open](${url})`);', filename },
    // Another parse mode is not legacy Markdown.
    { code: "await safeReply(ctx, `Raw: ${value}`, { parse_mode: 'HTML' });", filename },
    { code: "await safeEditMessageText(tg, chatId, messageId, undefined, `❌ ${escapeMarkdownV2(error)}`, { parse_mode: 'MarkdownV2' });", filename },
    // A same-file helper that escapes.
    {
      code: lines('function line(url) {', '  return `Issue: ${escapeMarkdown(url)}`;', '}', 'await safeReply(ctx, line(issueUrl));'),
      filename,
    },
    // A local variable built from safe parts.
    {
      code: lines('let message = `Repository: ${escapeMarkdown(repo)}`;', "message += `\\n${t('telegram.hint')}`;", 'await safeReply(ctx, message);'),
      filename,
    },
    // Reasoned marker.
    { code: 'await safeReply(ctx, `Status: ${item.status}`); // telegram-markdown-ok: status is a fixed enum value', filename },
    { code: lines('// telegram-markdown-ok: commandName is a fixed label', 'await safeReply(ctx, `❌ ${commandName} rejected`);'), filename },
    // Non-formatter exports of telegram modules are not checked.
    { code: 'export function parseRepository(input) { return `${input}`; }', filename: telegramFilename },
    // Within the baseline.
    { code: 'await safeReply(ctx, `Status: ${status}`);', filename, options: [{ baseline: { 'src/example.lib.mjs': { count: 1, reason: 'legacy' } } }] },
  ],
  invalid: [
    // Issue #3505: the workflow status `in_progress` opened an italic entity.
    {
      code: lines('function describePending(pending = []) {', '  return pending.map(item => `${codeSpan(item.name)} (${item.status})`).join(", ");', '}', 'function formatStatus(event) {', '  const lines = [];', '  const pending = describePending(event.pending);', '  if (pending) lines.push(`🔄 Running: ${pending}`);', '  return lines.join("\\n");', '}', 'await safeEditMessageText(tg, chatId, messageId, undefined, formatStatus(event));'),
      filename,
      errors: [{ ...violation, line: 2 }],
    },
    // Issue #3505: a raw issue URL passed as the header of a cross-file formatter.
    {
      code: lines('const status = `📝 Issue: ${event.issueUrl}`;', 'await safeEditMessageText(tg, chatId, messageId, undefined, formatExecutingWorkSessionMessage({ sessionName, header: status }));'),
      filename,
      errors: [{ ...violation, line: 1 }],
    },
    // Raw values at the top level.
    { code: 'await safeReply(ctx, `❌ ${error.message}`);', filename, errors: [violation] },
    { code: 'await safeSendMessage(tg, chatId, `Branch: ${branch}`);', filename, errors: [violation] },
    { code: "await safeReply(ctx, '❌ ' + reason);", filename, errors: [violation] },
    // Inside bold the value is still parsed by Telegram.
    { code: 'await safeReply(ctx, `*Reason:* ${reason} and *${where}*`);', filename, errors: [violation] },
    // `+=` onto a message variable.
    {
      code: lines("let message = 'Stopped';", 'message += `\\nReason: ${stopInfo.reason}`;', 'await safeReply(ctx, message);'),
      filename,
      errors: [{ ...violation, line: 2 }],
    },
    // The parameter of a same-file wrapper.
    {
      code: lines('const edit = text => safeEditMessageText(tg, chatId, messageId, undefined, text);', 'await edit(`⚠️ ${result.warning}`);'),
      filename,
      errors: [{ ...violation, line: 2 }],
    },
    // Translation variables land in the message.
    { code: "await safeReply(ctx, t('telegram.stopped', { reason }, { locale }));", filename, errors: [violation] },
    // A cleaner keeps the dangerous characters.
    { code: 'await safeReply(ctx, `Error: ${sanitizeForPublication(stderr)}`);', filename, errors: [violation] },
    // Exported formatters of telegram modules are checked without an annotation.
    { code: 'export function formatTokenLine(token) { return `• ${token.name}`; }', filename: telegramFilename, errors: [violation] },
    // `@telegram-markdown` opts other formatters in.
    {
      code: lines('/** @telegram-markdown */', 'export function formatRecovery({ sessionName }) {', '  return `Recovery session: ${sessionName}`;', '}'),
      filename,
      errors: [{ ...violation, line: 3 }],
    },
    // A marker without a reason does not count.
    { code: 'await safeReply(ctx, `Status: ${status}`); // telegram-markdown-ok:', filename, errors: [violation] },
    // Over the baseline: every interpolation is listed.
    {
      code: lines('await safeReply(ctx, `Status: ${status}`);', 'await safeReply(ctx, `Branch: ${branch}`);'),
      filename,
      options: [{ baseline: { 'src/example.lib.mjs': { count: 1, reason: 'legacy' } } }],
      errors: [
        { messageId: 'overBaseline', line: 1 },
        { messageId: 'overBaseline', line: 2 },
      ],
    },
  ],
});
