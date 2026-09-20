#!/usr/bin/env node
/**
 * Tests for issue #1684: Better UI/UX for /solve commands in telegram bot.
 *
 * Verifies that:
 * - Starting message uses `🔄 Starting...` (not `🚀 Starting solve command...`)
 * - Executing message uses `⏳ Executing...` (not `⏳ Solve command executing...`)
 * - Completion message uses `✅ Work session finished successfully` (not `✅ Work Session Completed`)
 * - Failure message uses `❌ Work session failed (exit code: N)`
 * - Completion message preserves the requester/URL/options infoBlock for security/audit
 * - Completion message has Duration before Session
 * - Completion message has no `🔗 URL:` line and no trailing footer text
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1684
 */

import { formatStartingWorkSessionMessage, formatExecutingWorkSessionMessage, formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1684: Telegram bot UI/UX message formatting');
console.log('='.repeat(60));

const infoBlock = 'Requested by: @drakonard\n' + 'URL: https://github.com/link-assistant/agent/pull/267\n\n' + '🛠 Options: --tool claude\n' + '🔒 Locked options: --attach-logs --verbose --no-tool-check --auto-accept-invite --tokens-budget-stats --auto-attach-solution-summary --isolation screen';

console.log('\n  Starting message:');
const starting = formatStartingWorkSessionMessage({ infoBlock });
assert(starting.startsWith('🔄 Starting...'), 'Starting message uses 🔄 Starting...');
assert(!starting.includes('🚀 Starting solve command'), 'Starting message no longer uses old 🚀 prefix');
assert(!starting.includes('🚀 Starting hive command'), 'Starting message no longer uses old 🚀 hive prefix');
assert(starting.includes('Requested by: @drakonard'), 'Starting message preserves requester for audit');
assert(starting.includes('URL: https://github.com/link-assistant/agent/pull/267'), 'Starting message preserves URL for audit');

console.log('\n  Executing message:');
const executing = formatExecutingWorkSessionMessage({
  sessionName: '3fe0b5b3-1d4c-45d7-b3b9-95b23bec7158',
  isolationBackend: 'screen',
  infoBlock,
});
assert(executing.startsWith('⏳ Executing...'), 'Executing message uses ⏳ Executing...');
assert(!executing.includes('Solve command executing'), 'Executing message no longer references command name');
assert(!executing.includes('Hive command executing'), 'Executing message no longer references hive command name');
assert(executing.includes('📊 Session: `3fe0b5b3-1d4c-45d7-b3b9-95b23bec7158`'), 'Executing message includes session id');
assert(executing.includes('🔒 Isolation: `screen`'), 'Executing message includes isolation backend');
assert(executing.includes('Requested by: @drakonard'), 'Executing message preserves requester');

console.log('\n  Successful completion message:');
const success = formatSessionCompletionMessage({
  sessionName: '3fe0b5b3-1d4c-45d7-b3b9-95b23bec7158',
  sessionInfo: {
    startTime: new Date('2026-04-25T12:00:00.000Z'),
    url: 'https://github.com/link-assistant/agent/pull/267',
    isolationBackend: 'screen',
  },
  statusResult: {
    status: 'executed',
    exitCode: 0,
    startTime: '2026-04-25T12:00:00.000Z',
    endTime: '2026-04-25T12:11:02.000Z',
  },
  infoBlock,
});
assert(success.startsWith('✅ *Work session finished successfully*'), 'Successful completion uses new headline');
assert(!success.includes('Work Session Completed'), 'Old completion headline is removed');
assert(!success.includes('The work session has finished. You can now review the results.'), 'Old footer is removed');
assert(!success.includes('🔗 URL:'), 'Standalone URL line is removed (URL is in infoBlock)');
const durationIdx = success.indexOf('⏱️ Duration:');
const sessionIdx = success.indexOf('📊 Session:');
assert(durationIdx >= 0 && sessionIdx >= 0 && durationIdx < sessionIdx, 'Duration is shown before Session');
assert(success.includes('⏱️ Duration: 11m 2s'), 'Successful completion shows duration from status output');
assert(success.includes('🔒 Isolation: `screen`'), 'Successful completion shows isolation');
assert(success.includes('Requested by: @drakonard'), 'Successful completion preserves requester for audit');
assert(success.includes('URL: https://github.com/link-assistant/agent/pull/267'), 'Successful completion preserves URL for audit');
assert(success.includes('🛠 Options: --tool claude'), 'Successful completion preserves user options');
assert(success.includes('🔒 Locked options:'), 'Successful completion preserves locked options block');

console.log('\n  Failed completion message:');
const failure = formatSessionCompletionMessage({
  sessionName: 'failed-session-id',
  sessionInfo: {
    startTime: new Date('2026-04-25T12:00:00.000Z'),
    url: 'https://github.com/link-assistant/agent/pull/267',
    isolationBackend: 'screen',
  },
  statusResult: {
    status: 'executed',
    exitCode: 2,
    startTime: '2026-04-25T12:00:00.000Z',
    endTime: '2026-04-25T12:00:30.000Z',
  },
  infoBlock,
});
assert(failure.startsWith('❌ *Work session failed (exit code: 2)*'), 'Failed completion uses new failure headline');
assert(!failure.includes('Work Session Failed'), 'Old failure headline is removed');
assert(failure.includes('⏱️ Duration: 30s'), 'Failed completion shows duration');
assert(failure.includes('Requested by: @drakonard'), 'Failed completion preserves requester for audit');

console.log('\n  Completion message uses sessionInfo.infoBlock fallback:');
const successFromSession = formatSessionCompletionMessage({
  sessionName: 'fallback-session',
  sessionInfo: {
    startTime: new Date('2026-04-25T12:00:00.000Z'),
    url: 'https://github.com/link-assistant/agent/pull/267',
    isolationBackend: 'screen',
    infoBlock,
  },
  statusResult: {
    status: 'executed',
    exitCode: 0,
    startTime: '2026-04-25T12:00:00.000Z',
    endTime: '2026-04-25T12:01:00.000Z',
  },
});
assert(successFromSession.includes('Requested by: @drakonard'), 'Completion falls back to sessionInfo.infoBlock when explicit infoBlock missing');

console.log('\n  Empty infoBlock degrades gracefully:');
const noInfo = formatSessionCompletionMessage({
  sessionName: 'no-info-session',
  sessionInfo: {
    startTime: new Date('2026-04-25T12:00:00.000Z'),
    isolationBackend: 'screen',
  },
  statusResult: {
    status: 'executed',
    exitCode: 0,
    startTime: '2026-04-25T12:00:00.000Z',
    endTime: '2026-04-25T12:00:30.000Z',
  },
});
assert(noInfo.startsWith('✅ *Work session finished successfully*'), 'Empty infoBlock still produces valid message');
assert(!noInfo.includes('Requested by:'), 'Empty infoBlock does not introduce stray audit lines');

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
