/**
 * @hive-mind-test-suite default
 * Issue #2301 (link-foundation/meta-language#196): the last AI session inside
 * `--auto-restart-until-mergeable` failed and its log could not be uploaded, yet:
 *  - `solve` exited 0, so the bot announced "Work session finished successfully";
 *  - the session end said "Skipping: End comment (logs already attached with session end message)",
 *    because an earlier iteration's log had been attached.
 * A loop's failed AI session now fails the run, and only the latest log counts as "attached".
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { getLoopToolFailure, hasLoopToolFailure, recordLoopToolFailure, resetLoopToolFailure } from '../src/automation-failure.lib.mjs';
import { finalizeSolveProcess } from '../src/solve.finalize.lib.mjs';
import { attachFinalLogIfMissing } from '../src/attach-logs-guarantee.lib.mjs';

const finalize = async () => {
  const exits = [];
  const logs = [];
  await finalizeSolveProcess({
    tempDir: '/tmp/none',
    argv: {},
    limitReached: false,
    path: { resolve: p => p },
    getLogFile: () => null,
    log: async message => logs.push(String(message)),
    closeSentry: async () => {},
    logActiveHandles: async () => {},
    cleanupTempDirectory: async () => {},
    safeExit: async (code, reason) => exits.push({ code, reason }),
  });
  return { exits, logs };
};

test('a run whose loop stopped on a failed AI session exits 1', async () => {
  resetLoopToolFailure();
  recordLoopToolFailure({ reason: 'tool_failure', mode: 'auto-restart-until-mergeable', message: 'Claude command failed with exit code 1' });
  try {
    assert.equal(hasLoopToolFailure(), true);
    const { exits, logs } = await finalize();
    assert.deepEqual(exits, [{ code: 1, reason: 'AI session failed (tool_failure)' }]);
    assert.match(logs.join('\n'), /Claude command failed with exit code 1/);
  } finally {
    resetLoopToolFailure();
  }
  assert.equal(getLoopToolFailure(), null);
});

test('a run without a loop failure still exits 0', async () => {
  resetLoopToolFailure();
  const { exits } = await finalize();
  assert.deepEqual(exits, [{ code: 0, reason: 'Process completed' }]);
});

test('every loop stop on a failed AI session records the failure', async () => {
  for (const file of ['src/solve.auto-merge.lib.mjs', 'src/solve.watch.lib.mjs']) {
    const source = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const stops = [...source.matchAll(/reason: '(tool_failure(?:_after_resume)?)'[\s\S]{0,600}?(?:return \{|break;)/g)];
    assert.ok(stops.length > 0, file);
    for (const [block, reason] of stops) assert.match(block, new RegExp(`recordLoopToolFailure\\(\\{ reason: '${reason}'`), `${file}: ${reason}`);
  }
});

test('an earlier attached log does not count when the latest upload failed', async () => {
  const logs = [];
  const attach = async () => assert.fail('a failed upload was already retried and reported; it is not repeated');
  const params = { shouldAttachLogs: true, prNumber: 196, owner: 'o', repo: 'r', $: null, log: async message => logs.push(message), sanitizeLogContent: x => x, getLogFile: () => '/tmp/x.log', attachLogToGitHub: attach, argv: {} };

  assert.equal(await attachFinalLogIfMissing({ ...params, globalState: { logAttachedToGitHub: true, latestLogAttachFailed: true } }), false);
  assert.match(logs.join('\n'), /latest session log could not be attached/);

  assert.equal(await attachFinalLogIfMissing({ ...params, globalState: { logAttachedToGitHub: true, latestLogAttachFailed: false } }), true);
});
