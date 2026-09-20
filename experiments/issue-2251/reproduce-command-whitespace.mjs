#!/usr/bin/env node

/**
 * Show how visually similar Telegram separators travel through command
 * detection, argument parsing, and per-tool alias selection.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2251
 */

import process from 'node:process';

import { revealHiddenCharacters } from '../../src/github-url-recovery.lib.mjs';
import { extractCommandFromText } from '../../src/telegram-message-filters.lib.mjs';
import { applySolveToolAlias, getSolveToolAliasFromText, parseCommandArgs } from '../../src/telegram-solve-command.lib.mjs';

const issueUrl = 'https://github.com/G-Ivan-A/hybrid-Intelligence-lab/issues/577';
const samples = [
  ['issue payload', `/claude\u00a0${issueUrl}`],
  ['NBSP before option', `/claude\u00a0${issueUrl}\u00a0--verbose`],
  ['narrow NBSP before option', `/claude\u202f${issueUrl}\u202f--verbose`],
  ['zero-width command boundary', `/claude\u200b${issueUrl}`],
];

for (const [name, text] of samples) {
  const toolAlias = getSolveToolAliasFromText(text);
  process.stdout.write(
    `${JSON.stringify({
      name,
      visibleText: revealHiddenCharacters(text),
      fallbackCommand: extractCommandFromText(text),
      args: applySolveToolAlias(parseCommandArgs(text), toolAlias),
    })}\n`
  );
}
