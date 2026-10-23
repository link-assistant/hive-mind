/**
 * @hive-mind-test-suite default
 * A kill recovery adds exactly one comment: its start comment, in the same
 * shape as every other session start, naming the attempt (issue #3530).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_TYPES, formatRecoveryAttempt, getSessionCommentContent, isKillRecoverySessionType } from '../src/solve.session.lib.mjs';
import { buildResumeCommand, stripRecoverySessionFlags, tagRecoveryCommand } from '../src/session-resume.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { startKillRecoverySession } from '../src/session-kill-resume.lib.mjs';

const PR = 'https://github.com/link-foundation/legal/pull/2';
const AT = new Date('2026-10-18T15:03:00.000Z');

test('kill-recovery start comments say what happened and which attempt it is', () => {
  const resumed = getSessionCommentContent(SESSION_TYPES.KILL_RESUME, AT, '', { recoveryAttempt: '2/3' });
  assert.equal(resumed.header, 'AI Work Session Resumed');
  assert.equal(resumed.description, 'Resumed at 2026-10-18T15:03:00.000Z after the session was killed (attempt 2/3, previous context kept). Please wait for it to finish before giving feedback.');
  const restarted = getSessionCommentContent(SESSION_TYPES.KILL_RESTART, AT, '', { recoveryAttempt: '1/3' });
  assert.equal(restarted.header, 'AI Work Session Started');
  assert.match(restarted.description, /^Restarted at .* after the session was killed \(attempt 1\/3, fresh context\)\./);
  // Without the attempt the comment is still uniform.
  assert.match(getSessionCommentContent(SESSION_TYPES.KILL_RESUME, AT).description, /killed \(previous context kept\)\./);
  assert.ok(getSessionCommentContent(SESSION_TYPES.KILL_RESTART, AT, '', { recoveryAttempt: '10/10' }).description.length <= 160, 'as concise as the other start comments (#2492)');
  // Other session types are unchanged.
  assert.equal(getSessionCommentContent(SESSION_TYPES.NEW, AT).description, 'Started at 2026-10-18T15:03:00.000Z. Please wait for it to finish before giving feedback.');
});

test('attempt parsing accepts n and n/m only', () => {
  assert.equal(formatRecoveryAttempt('2/3'), 'attempt 2/3');
  assert.equal(formatRecoveryAttempt('2'), 'attempt 2');
  assert.equal(formatRecoveryAttempt('two'), '');
  assert.equal(formatRecoveryAttempt(null), '');
  assert.ok(isKillRecoverySessionType('kill-resume') && isKillRecoverySessionType('kill-restart') && !isKillRecoverySessionType('auto-resume'));
});

test('solve accepts the session types and the attempt the monitor passes', () => {
  assert.ok(SOLVE_OPTION_DEFINITIONS['session-type'].choices.includes('kill-resume'));
  assert.ok(SOLVE_OPTION_DEFINITIONS['session-type'].choices.includes('kill-restart'));
  assert.equal(SOLVE_OPTION_DEFINITIONS['recovery-attempt'].hidden, true);
});

test('a recovery command is tagged once, and the tags never leak into the next command', () => {
  const command = buildResumeCommand({ sessionInfo: { url: PR, args: [PR, '--attach-logs'] }, lastSessionId: 'tool-1' });
  const tagged = tagRecoveryCommand(command, { attempt: 1, maxAttempts: 3 });
  assert.deepEqual(tagged.args, [PR, '--attach-logs', '--resume', 'tool-1', '--session-type', 'kill-resume', '--recovery-attempt', '1/3']);
  assert.equal(tagged.display, `solve ${tagged.args.join(' ')}`);
  // Tagging again (attempt 2) replaces the tags instead of stacking them.
  const again = tagRecoveryCommand(tagged, { attempt: 2, maxAttempts: 3 });
  assert.deepEqual(again.args.slice(-4), ['--session-type', 'kill-resume', '--recovery-attempt', '2/3']);
  assert.equal(again.args.filter(arg => arg === '--session-type').length, 1);
  // A command without --resume is a restart.
  assert.deepEqual(tagRecoveryCommand({ binary: 'solve', args: [PR] }, { attempt: 1, maxAttempts: 1 }).args, [PR, '--session-type', 'kill-restart', '--recovery-attempt', '1/1']);
  // The manual resume command built from the recovery's args drops the tags.
  const manual = buildResumeCommand({ sessionInfo: { url: PR, args: again.args }, lastSessionId: 'tool-2' });
  assert.deepEqual(manual.args, [PR, '--attach-logs', '--resume', 'tool-2']);
  assert.deepEqual(stripRecoverySessionFlags(['a', '--session-type=kill-resume', '--recovery-attempt', '1/2', 'b']), ['a', 'b']);
});

test('the launched recovery carries the tags, and a dropped --resume becomes a restart', async () => {
  const launches = [];
  const result = await startKillRecoverySession({
    sessionName: 'killed',
    sessionInfo: { startTime: new Date(0), isolationBackend: 'screen', args: [PR], url: PR, tool: 'codex' },
    plan: { shouldResume: true, attempt: 2, maxAttempts: 3, command: buildResumeCommand({ sessionInfo: { url: PR, args: [PR] }, lastSessionId: 'thread-1' }) },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    resolveFreshCommand: async ({ command }) => ({ command: { ...command, args: command.args.filter((arg, i, all) => arg !== '--resume' && all[i - 1] !== '--resume') }, outcome: 'dropped', detail: 'thread unreachable' }),
    runner: { generateSessionId: () => 'fresh', executeWithIsolation: async (binary, args) => (launches.push(args), { success: true }) },
    trackSession: () => {},
  });
  assert.equal(result.resumed, true);
  assert.deepEqual(launches[0], [PR, '--session-type', 'kill-restart', '--recovery-attempt', '2/3']);
});
