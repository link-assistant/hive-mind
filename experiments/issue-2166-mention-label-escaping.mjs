#!/usr/bin/env node

/**
 * Experiment for issue #2166 (R4): backslash-escaping inside a legacy-Markdown
 * link label is never unescaped by TDLib, so users literally see `\_`.
 * Run: `node experiments/issue-2166-mention-label-escaping.mjs`
 */

import { buildUserMention } from '../src/buildUserMention.lib.mjs';
import { parseTelegramLegacyMarkdown } from '../src/telegram-markdown-validator.lib.mjs';
for (const u of [
  { id: 1, username: 'my_cool_bot' },
  { id: 2, first_name: 'John_Doe' },
  { id: 3, first_name: 'Star*User' },
  { id: 4, first_name: 'A]B[' },
]) {
  const m = buildUserMention({ user: u, parseMode: 'Markdown' });
  const r = parseTelegramLegacyMarkdown(`Requested by: ${m}\nIssue: x`);
  console.log(JSON.stringify(m), r.ok ? 'OK ' + JSON.stringify(r.text) : 'FAIL ' + r.description);
}
