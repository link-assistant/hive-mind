#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2090: "Not all working sessions uploaded ... as per --development-log feature".
 *
 * A run with --auto-restart-until-mergeable executed three tool sessions
 * (a7583710-…, c57c4607-…, 4b713ee3-… in link-assistant/formal-ai#809) but the
 * pull request contained artifacts for the first session only, because
 * createDevelopmentLogFinalizer memoized a single collection per process and no
 * restart path invoked it again.
 *
 * These tests pin the fixed behaviour:
 *  1. a different session UUID produces its own sessions/<uuid>/ directory;
 *  2. the same session UUID is collected only once (no duplicate commits);
 *  3. each session stores only its own slice of the solve log (no truncation of
 *     the overall log, no N copies of the same prefix);
 *  4. the renamed `<sessionId>.log` is not copied again as a byte-identical
 *     duplicate of solve.log;
 *  5. exit-time forced finalization extends the last session's slice.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, appendFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevelopmentLogFinalizer, finalizeActiveDevelopmentLog, getActiveDevelopmentLogFinalizer, setActiveDevelopmentLogFinalizer } from '../src/development-log.finalize.lib.mjs';
import { collectAndCommitDevelopmentLogArtifacts, writeDevelopmentLogArtifacts } from '../src/development-log.lib.mjs';

// 1. Per-session dedupe: same UUID collected once, new UUID collected again.
{
  const collected = [];
  let sessionId = 'session-one';
  const finalize = createDevelopmentLogFinalizer({
    collect: async params => {
      collected.push(params.sessionId);
      return { sessionId: params.sessionId, logEndByte: collected.length * 100 };
    },
    getParams: () => ({ sessionId }),
  });
  // Creating a finalizer publishes it for the restart/exit chokepoints.
  assert.equal(getActiveDevelopmentLogFinalizer(), finalize);

  await finalize();
  await finalize();
  assert.deepEqual(collected, ['session-one'], 'the same session must be collected only once');

  // A restart iteration reports a different session UUID.
  await finalize({ sessionId: 'session-two' });
  await finalize({ sessionId: 'session-two' });
  await finalize({ sessionId: 'session-three' });
  assert.deepEqual(collected, ['session-one', 'session-two', 'session-three'], 'each distinct session UUID must be collected');

  // Log slices must not overlap: every collection starts where the previous ended.
  assert.deepEqual(finalize.getCollectedSessionKeys(), ['session-one', 'session-two', 'session-three']);

  // Exit-time forced finalize extends the LAST collected session, not the
  // stale `sessionId` variable still pointing at the first session.
  sessionId = 'session-one';
  const forced = await finalize({ force: true });
  assert.equal(forced.sessionId, 'session-three', 'forced finalize must extend the most recent session');
  assert.deepEqual(collected, ['session-one', 'session-two', 'session-three', 'session-three']);
}

// 2. Log start bytes advance per session and forced re-collection reuses the
//    session's own start byte.
{
  const starts = [];
  const finalize = createDevelopmentLogFinalizer({
    collect: async params => {
      starts.push([params.sessionId, params.logStartByte]);
      return { logEndByte: starts.length * 1000 };
    },
    getParams: () => ({ sessionId: 'a' }),
  });
  await finalize();
  await finalize({ sessionId: 'b' });
  await finalize({ sessionId: 'b', force: true });
  assert.deepEqual(starts, [
    ['a', 0],
    ['b', 1000],
    ['b', 1000],
  ]);
}

// 3. The module-level registry lets restart iterations finalize without
//    threading the finalizer through every call signature.
{
  setActiveDevelopmentLogFinalizer(null);
  assert.equal(getActiveDevelopmentLogFinalizer(), null);
  assert.deepEqual(await finalizeActiveDevelopmentLog({ sessionId: 'x' }), { skipped: 'no-active-finalizer' });

  const seen = [];
  setActiveDevelopmentLogFinalizer(
    createDevelopmentLogFinalizer({
      collect: async params => {
        seen.push(params.sessionId);
        return { logEndByte: 0 };
      },
      getParams: () => ({ sessionId: null }),
    })
  );
  await finalizeActiveDevelopmentLog({ sessionId: 'restart-session' });
  assert.deepEqual(seen, ['restart-session']);

  // Failures inside the collector must never break the exit path.
  setActiveDevelopmentLogFinalizer(() => {
    throw new Error('boom');
  });
  const result = await finalizeActiveDevelopmentLog({ force: true });
  assert.equal(result.skipped, 'error');
  setActiveDevelopmentLogFinalizer(null);
}

// 4. End-to-end on a real temp repository: three sessions, three directories,
//    disjoint log slices whose union is the complete log.
const tempRoot = await mkdtemp(join(tmpdir(), 'hive-development-log-2090-'));
try {
  const repositoryPath = join(tempRoot, 'repo');
  const logFile = join(tempRoot, 'solve.log');
  await mkdir(repositoryPath, { recursive: true });

  const commits = [];
  const fakeGit =
    ({ cwd }) =>
    async (strings, ...values) => {
      const command = strings.reduce((text, part, index) => `${text}${part}${values[index] ?? ''}`, '');
      if (command.startsWith('git commit')) commits.push({ cwd, command });
      return { code: command.startsWith('git diff') ? 1 : 0, stdout: '', stderr: '' };
    };

  let sessionId = null;
  const finalize = createDevelopmentLogFinalizer({
    collect: collectAndCommitDevelopmentLogArtifacts,
    getParams: () => ({
      enabled: true,
      repositoryPath,
      logFile,
      issueNumber: 2090,
      prNumber: 2091,
      tool: 'claude',
      sessionId,
      branchName: 'issue-2090-949229c26ca6',
      rawCommand: 'solve ... --development-log --auto-restart-until-mergeable',
      $: fakeGit,
      log: async () => {},
    }),
  });

  await writeFile(logFile, 'session-one-output\n', 'utf8');
  sessionId = 'a7583710-f266-4c39-b5cf-8583e137ffd4';
  await finalize();

  await appendFile(logFile, 'session-two-output\n', 'utf8');
  await finalize({ sessionId: 'c57c4607-7070-4ba4-b13c-4e56251caf54' });

  await appendFile(logFile, 'session-three-output\n', 'utf8');
  await finalize({ sessionId: '4b713ee3-58b5-4997-b1ce-953aa0709394' });

  const sessionsDirectory = join(repositoryPath, 'dev/log/issues/2090/pulls/2091/sessions');
  const sessionDirectories = (await readdir(sessionsDirectory)).sort();
  assert.deepEqual(sessionDirectories, ['4b713ee3-58b5-4997-b1ce-953aa0709394', 'a7583710-f266-4c39-b5cf-8583e137ffd4', 'c57c4607-7070-4ba4-b13c-4e56251caf54'], 'every working session must get its own directory');
  assert.equal(commits.length, 3, 'each session must produce its own development-log commit');

  const readSlice = async name => readFile(join(sessionsDirectory, name, 'solve.log'), 'utf8');
  assert.equal(await readSlice('a7583710-f266-4c39-b5cf-8583e137ffd4'), 'session-one-output\n');
  assert.equal(await readSlice('c57c4607-7070-4ba4-b13c-4e56251caf54'), 'session-two-output\n', 'later sessions must store their own slice, not a copy of the first one');
  assert.equal(await readSlice('4b713ee3-58b5-4997-b1ce-953aa0709394'), 'session-three-output\n');

  const metadata = JSON.parse(await readFile(join(sessionsDirectory, 'c57c4607-7070-4ba4-b13c-4e56251caf54', 'metadata.json'), 'utf8'));
  assert.equal(metadata.schemaVersion, 3);
  assert.equal(metadata.sessionId, 'c57c4607-7070-4ba4-b13c-4e56251caf54');
  assert.equal(metadata.artifacts.solveLogRange.startByte, 'session-one-output\n'.length);

  // The tail written after the last session (verification, auto-merge, cleanup)
  // is preserved by the forced finalize on the exit path.
  await appendFile(logFile, 'post-session-tail\n', 'utf8');
  await finalize({ force: true });
  assert.equal(await readSlice('4b713ee3-58b5-4997-b1ce-953aa0709394'), 'session-three-output\npost-session-tail\n');

  const wholeLog = await readFile(logFile, 'utf8');
  const union = (await readSlice('a7583710-f266-4c39-b5cf-8583e137ffd4')) + (await readSlice('c57c4607-7070-4ba4-b13c-4e56251caf54')) + (await readSlice('4b713ee3-58b5-4997-b1ce-953aa0709394'));
  assert.equal(union, wholeLog, 'the union of session slices must be the complete solve log');

  // 5. The tool renames the running log to <sessionId>.log; it must not be
  //    copied again as a byte-identical duplicate of solve.log (issue #2090:
  //    two identical ~7 MB files were committed per session).
  const renamedRepository = join(tempRoot, 'renamed-repo');
  const renamedLog = join(tempRoot, 'renamed-session.log');
  await writeFile(renamedLog, 'renamed log content\n', 'utf8');
  const renamedResult = await writeDevelopmentLogArtifacts({
    repositoryPath: renamedRepository,
    logFile: renamedLog,
    issueNumber: 2090,
    prNumber: 2091,
    tool: 'claude',
    sessionId: 'renamed-session',
    now: new Date('2026-07-20T10:00:00.000Z'),
    homeDir: join(tempRoot, 'empty-home'),
  });
  assert.deepEqual(renamedResult.sessionFiles, [], 'the running log must not be duplicated under its <sessionId>.log name');
  const renamedSessionFiles = await readdir(join(renamedRepository, renamedResult.sessionRelativeDirectory));
  assert.deepEqual(renamedSessionFiles.sort(), ['metadata.json', 'solve.log']);
  const renamedSize = (await stat(join(renamedRepository, renamedResult.copiedLogRelativePath))).size;
  assert.equal(renamedSize, 'renamed log content\n'.length);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

// 6. Wiring: the finalizer must be registered by solve, invoked by the shared
//    restart chokepoint (watch, auto-restart-until-mergeable, keep-working,
//    escalation, auto-ensure) and by every exit path.
{
  const solveSource = await readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  assert.ok(solveSource.includes('createDevelopmentLogFinalizer({'), 'solve.mjs must create (and thereby publish) the development-log finalizer');

  const restartSource = await readFile(new URL('../src/solve.restart-shared.lib.mjs', import.meta.url), 'utf8');
  assert.ok(restartSource.includes('finalizeActiveDevelopmentLog({ sessionId: toolResult.sessionId })'), 'every restart iteration must finalize its own session');
  assert.ok(restartSource.indexOf('finalizeActiveDevelopmentLog') < restartSource.indexOf('return toolResult;'), 'restart finalization must happen before the iteration returns');

  const exitHandlerSource = await readFile(new URL('../src/exit-handler.lib.mjs', import.meta.url), 'utf8');
  assert.ok(exitHandlerSource.includes('await finalizeActiveDevelopmentLog({ force: true });'), 'safeExit must finalize the development log on every exit path');
}

console.log('development-log multi-session tests passed (issue #2090)');
