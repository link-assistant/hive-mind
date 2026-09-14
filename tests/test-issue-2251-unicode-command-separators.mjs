#!/usr/bin/env node

/**
 * Regression tests for issue #2251: Telegram command links can contain
 * invisible or visually ambiguous Unicode separators.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2251
 */

import assert from 'node:assert/strict';

import { getFixCommandNameFromText } from '../src/telegram-fix-command.lib.mjs';
import { extractCommandFromText, extractGitHubUrl } from '../src/telegram-message-filters.lib.mjs';
import { registerMergeCommand } from '../src/telegram-merge-command.lib.mjs';
import { parseModelsCommandArgs } from '../src/telegram-models-command.lib.mjs';
import { applySolveToolAlias, getSolveToolAliasFromText, parseCommandArgs } from '../src/telegram-solve-command.lib.mjs';
import { extractStopTarget, registerStartStopCommands } from '../src/telegram-start-stop-command.lib.mjs';
import { getTaskCommandNameFromText } from '../src/telegram-task-command.lib.mjs';
import { parseTerminalWatchArgs } from '../src/telegram-terminal-watch-command.lib.mjs';

const issueUrl = 'https://github.com/G-Ivan-A/hybrid-Intelligence-lab/issues/577';

function parseSolveCommand(text) {
  return applySolveToolAlias(parseCommandArgs(text), getSolveToolAliasFromText(text));
}

const issuePayload = `/claude\u00a0${issueUrl}`;
assert.equal(issuePayload.codePointAt('/claude'.length), 0x00a0, "fixture must contain the issue's U+00A0 NO-BREAK SPACE");
assert.deepEqual(extractCommandFromText(issuePayload), { command: 'claude', botMention: null });
assert.deepEqual(parseSolveCommand(issuePayload), [issueUrl, '--tool', 'claude']);

for (const { name, separator } of [
  { name: 'NO-BREAK SPACE', separator: '\u00a0' },
  { name: 'FIGURE SPACE', separator: '\u2007' },
  { name: 'NARROW NO-BREAK SPACE', separator: '\u202f' },
  { name: 'NEXT LINE', separator: '\u0085' },
  { name: 'TAB', separator: '\t' },
]) {
  assert.deepEqual(parseSolveCommand(`/claude${separator}${issueUrl}${separator}--verbose`), [issueUrl, '--verbose', '--tool', 'claude'], `${name} should separate command arguments`);
}

assert.deepEqual(parseSolveCommand(`/claude\u200b${issueUrl}`), [issueUrl, '--tool', 'claude'], 'an invisible format character at the command boundary should not hide the tool alias');

assert.deepEqual(parseCommandArgs(`/solve ${issueUrl} --title "review\u00a0notes"`), [issueUrl, '--title', 'review\u00a0notes'], 'Unicode whitespace inside quotes must remain part of the argument');

assert.equal(getTaskCommandNameFromText(`/split\u200b${issueUrl}`), 'split');
assert.equal(getFixCommandNameFromText('/fix\u200bG-Ivan-A/hybrid-Intelligence-lab'), 'fix');
assert.deepEqual(parseCommandArgs(`/merge\u200b${issueUrl}\u00a0--auto-resolve`), [issueUrl, '--auto-resolve']);
assert.deepEqual(parseModelsCommandArgs('/models\u200b--tool\u0085codex').tools, ['codex']);
assert.deepEqual(extractStopTarget(`/stop\u200b${issueUrl}\u0085ignored`, null), { kind: 'url', value: issueUrl, source: 'argument' });

const extractedReplyUrl = extractGitHubUrl(`context\u0085${issueUrl}`, {
  parseGitHubUrl: value => (value === issueUrl ? { valid: true, type: 'issue', normalized: value } : { valid: false }),
  cleanNonPrintableChars: value => value.replace(/[\u0085\u200b]/g, ''),
});
assert.deepEqual(extractedReplyUrl, { url: issueUrl, error: null, linkCount: 1 });

const sessionId = '12345678-1234-1234-1234-123456789abc';
const terminalWatch = parseTerminalWatchArgs(`/watch\u200b${sessionId}\u202f--size\u202f100x20`);
assert.equal(terminalWatch.sessionId, sessionId);
assert.deepEqual(terminalWatch.options, { width: 100, height: 20, intervalMs: 2500, maxChars: 3400 });
assert.deepEqual(terminalWatch.errors, []);

let mergeRegistration;
const fakeBot = {
  command(pattern, handler) {
    mergeRegistration = { pattern, handler };
  },
  action() {},
};
const { handleMergeCommand } = registerMergeCommand(fakeBot, {});
assert.equal(mergeRegistration.handler, handleMergeCommand, '/merge must expose the same handler to Telegraf and the text fallback');

let stopRegistration;
const stopBot = {
  command(name, handler) {
    if (name === 'stop') stopRegistration = handler;
  },
};
const { handleStopCommand } = registerStartStopCommands(stopBot, {});
assert.equal(stopRegistration, handleStopCommand, '/stop must expose the same handler to Telegraf and the text fallback');

console.log('PASS: issue #2251 Unicode command separators');
