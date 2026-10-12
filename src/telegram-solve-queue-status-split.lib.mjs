#!/usr/bin/env node
/**
 * Split the detailed `/queue` status into Telegram-sized messages without
 * losing context (issue #2823).
 *
 * The generic splitter (`splitTelegramMessageText`) cuts at line boundaries,
 * so a long Pending list continued in a second message as bare
 * `• owner/repo#n (⏳ 9h …)` rows: the reader could not tell which tool queue
 * or which list those items belonged to. This splitter knows the shape of the
 * status message and repeats the tool header (`*codex* (continued)`) and the
 * current list header (`  *Pending* (17, continued):`) at the top of every
 * continuation message.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2823
 */

import { lt } from './limits-i18n.lib.mjs';
import { splitTelegramMessageText, TELEGRAM_TEXT_LIMIT } from './telegram-safe-reply.lib.mjs';

// `*codex*` — a tool header at column 0 (the title line starts with an emoji).
const TOOL_HEADER_RE = /^\*([^*\n]+)\*$/;
// `  *Pending* (17):` — a list header nested under a tool header.
const LIST_HEADER_RE = /^( {2})\*([^*\n]+)\* \((\d+)\):$/;

/**
 * @param {string} text - Output of `SolveQueue.formatDetailedStatus`.
 * @param {object} [options]
 * @param {number} [options.limit=TELEGRAM_TEXT_LIMIT] - Max characters per message.
 * @param {string|null} [options.locale] - Locale for the "continued" marker.
 * @returns {string[]} One or more messages; always at least one element.
 */
export function splitQueueStatusMessage(text, { limit = TELEGRAM_TEXT_LIMIT, locale = null } = {}) {
  const source = String(text ?? '');
  if (source.length <= limit) return [source];

  const continued = lt('queue_continued', {}, { locale });
  const toolContinuation = tool => `*${tool}* (${continued})`;
  const listContinuation = list => `${list.indent}*${list.label}* (${list.count}, ${continued}):`;

  const chunks = [];
  let lines = [];
  let length = 0;
  let tool = null; // tool header the next line belongs to
  let list = null; // list header the next line belongs to

  const push = line => {
    length += (lines.length ? 1 : 0) + line.length;
    lines.push(line);
  };
  const flush = () => {
    // Do not end a message with dangling headers or blank lines: move them to
    // the next message, where they introduce their items.
    const carried = [];
    while (lines.length > 0) {
      const last = lines[lines.length - 1];
      if (last.trim() === '' || TOOL_HEADER_RE.test(last) || LIST_HEADER_RE.test(last)) carried.unshift(lines.pop());
      else break;
    }
    if (lines.length === 0) {
      // Nothing but headers fit; keep them rather than looping forever.
      lines = carried.splice(0);
    }
    chunks.push(lines.join('\n'));
    lines = [];
    length = 0;
    return carried.filter(line => line.trim() !== '');
  };

  for (const line of source.split('\n')) {
    const toolMatch = line.match(TOOL_HEADER_RE);
    const listMatch = line.match(LIST_HEADER_RE);
    if (length > 0 && length + 1 + line.length > limit) {
      const carried = flush();
      const startsWithToolHeader = carried.length > 0 ? TOOL_HEADER_RE.test(carried[0]) : Boolean(toolMatch);
      const startsWithListHeader = carried.some(header => LIST_HEADER_RE.test(header)) || Boolean(listMatch);
      if (tool && !startsWithToolHeader && line.trim() !== '') {
        push(toolContinuation(tool));
        if (list && !startsWithListHeader) push(listContinuation(list));
      }
      for (const header of carried) push(header);
    }
    if (lines.length === 0 && line.trim() === '' && chunks.length > 0) {
      // Never start a continuation message with a blank line.
      tool = null;
      list = null;
      continue;
    }
    if (toolMatch) {
      tool = toolMatch[1];
      list = null;
    } else if (listMatch) {
      list = { indent: listMatch[1], label: listMatch[2], count: listMatch[3] };
    } else if (line.trim() === '') {
      // A blank line ends the tool block.
      tool = null;
      list = null;
    }
    push(line);
  }
  if (lines.length > 0) chunks.push(lines.join('\n'));

  // A single pathological line longer than the limit still needs the generic
  // splitter's hard cut.
  return chunks.flatMap(chunk => (chunk.length > limit ? splitTelegramMessageText(chunk, limit) : [chunk]));
}
