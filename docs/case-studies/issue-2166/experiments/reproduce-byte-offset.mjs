#!/usr/bin/env node

/**
 * Issue #2166 — reproduce, offline, the exact 400 the production bot hit.
 *
 * Telegram reported:
 *   "Can't find end of the entity starting at byte offset 65"   (update 957727704)
 *   "Can't find end of the entity starting at byte offset 79"   (update 957727705)
 *
 * Both messages carried `parse_mode: 'Markdown'` and a GitHub URL for the
 * repository `Surrogate-TM/save_visiogetbb`. The single `_` in the repository
 * name opens an italic entity that is never closed.
 *
 * Run: node docs/case-studies/issue-2166/experiments/reproduce-byte-offset.mjs
 */

import { validateTelegramText } from '../../../../src/telegram-markdown-validator.lib.mjs';

const url = 'https://github.com/Surrogate-TM/save_visiogetbb/pull/18#issuecomment-5370631063';

const payloads = [
  { update: 957727704, reportedOffset: 65, text: `🗑 Removed queued task for ${url} from \`codex\` queue.` },
  { update: 957727705, reportedOffset: 79, text: `ℹ️ No queued or running task found for ${url}.` },
];

let ok = true;
for (const { update, reportedOffset, text } of payloads) {
  const byteOffset = Buffer.from(text, 'utf8').indexOf('_'.charCodeAt(0));
  const validation = validateTelegramText(text, 'Markdown');
  const matches = byteOffset === reportedOffset && !validation.valid;
  ok &&= matches;
  console.log(`update ${update}:`);
  console.log(`  first '_' at byte ${byteOffset} (Telegram said ${reportedOffset}) → ${byteOffset === reportedOffset ? 'match' : 'MISMATCH'}`);
  console.log(`  local validator: ${validation.valid ? 'accepted (BUG)' : `rejected — ${validation.description}`}`);
}

console.log(ok ? '\nReproduced: the pre-send validator catches both payloads before they reach the Bot API.' : '\nFAILED to reproduce.');
process.exit(ok ? 0 : 1);
