#!/usr/bin/env node

/**
 * Issue #2189, requirement R2: re-enter the session that was killed.
 *
 * The incident report asked for a killed session to be resumed *in the same
 * `$` session / container* rather than restarted from scratch. `$` could not do
 * that, so this repo filed link-foundation/start#162; `start-command@0.33.0`
 * delivers it as `--resume <id> [-- <command>]` plus `--resume-all`, and
 * src/isolation-runner.resume.lib.mjs is the downstream wrapper.
 *
 * What is locked in here:
 *   1. The `executionResume` / `executionResumeAll` parsers read JSON, links
 *      notation and text, and never throw on garbage.
 *   2. `command-stream`'s `$` *resolves* on a non-zero exit instead of
 *      throwing, so both wrappers must inspect the exit code. Verified against
 *      a stub `$` that refuses on stderr with exit 1 — before this check every
 *      refusal was reported as a successful resume.
 *   3. An older `$` that does not know the verb yields `unsupported: true`
 *      rather than an exception, so callers keep their previous behaviour.
 *      The stub reproduces 0.32.1's exact wording.
 *   4. A missing `$` is reported, not thrown.
 *   5. `stopIsolatedSession` shares the root cause of (2) and is fixed with it:
 *      `$ --stop <unknown>` exits 1, and reporting that as a successful stop
 *      made a session nobody stopped look handled.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-foundation/start/issues/162
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { stopIsolatedSession } from '../src/isolation-runner.lib.mjs';
import { isUnsupportedStartCommandVerb, parseExecutionResumeAllOutput, parseExecutionResumeOutput, RESUME_ALL_ACTIONS, RESUME_MODES, resumeAllIsolationSessions, resumeIsolatedSession } from '../src/isolation-runner.resume.lib.mjs';

console.log('=== Issue #2189 — `$ --resume` / `$ --resume-all` wrappers ===\n');

// ---------------------------------------------------------------------------
// 1. Parsers
// ---------------------------------------------------------------------------
console.log('1. Parsing `$ --resume` output\n');

// The exact shape start-command 0.33.0 prints for a snapshot resume of a
// stopped docker container (src/lib/execution-resume.js).
const snapshotJson = JSON.stringify({
  identifier: '11111111-2222-3333-4444-555555555555',
  uuid: '11111111-2222-3333-4444-555555555555',
  mode: 'docker-snapshot',
  backend: 'docker',
  sessionName: 'hive-solve-1-resume-1',
  previousSessionName: 'hive-solve-1',
  snapshotImage: 'start-command-resume/hive-solve-1:1',
  command: 'solve https://github.com/o/r/issues/1 --resume abc-123',
  message: 'Resumed session in new container hive-solve-1-resume-1 from snapshot of hive-solve-1',
});

const snapshot = parseExecutionResumeOutput(snapshotJson);
assert(snapshot.uuid === '11111111-2222-3333-4444-555555555555', 'the original execution UUID survives the resume, so one logical session stays addressable');
assert(snapshot.mode === RESUME_MODES.DOCKER_SNAPSHOT, `docker-snapshot mode is read (got ${snapshot.mode})`);
assert(snapshot.sessionName === 'hive-solve-1-resume-1', 'the new session name is read, so the bot can track the container that now holds the work');
assert(snapshot.previousSessionName === 'hive-solve-1', 'the previous session name is read');
assert(snapshot.snapshotImage === 'start-command-resume/hive-solve-1:1', 'the snapshot image is read');

const links = parseExecutionResumeOutput(['executionResume', '  identifier abc', '  uuid abc', '  mode docker-start', '  backend docker', '  sessionName hive-solve-2', '  command solve https://x', '  message Resumed detached docker container: hive-solve-2'].join('\n'));
assert(links.mode === RESUME_MODES.DOCKER_START && links.sessionName === 'hive-solve-2', 'links notation (the `$` default output format) parses');

const text = parseExecutionResumeOutput(['Resume Mode:   relaunch', 'UUID:          u-1', 'Backend:       screen', 'Session Name:  hive-solve-3', 'Command:       echo hi', 'Relaunched screen session: hive-solve-3'].join('\n'));
assert(text.mode === RESUME_MODES.RELAUNCH && text.sessionName === 'hive-solve-3', '`--output-format text` parses too');

assert(parseExecutionResumeOutput('').uuid === null, 'empty output yields nulls, not a throw');
assert(parseExecutionResumeOutput('not json at all').uuid === null, 'unparseable output yields nulls, not a throw');

console.log('\n2. Parsing `$ --resume-all` output\n');

const resumeAllJson = JSON.stringify({
  count: 2,
  executions: [
    { uuid: 'u-1', backend: 'docker', sessionName: 's-1', state: 'running', action: 'reattached', exitCode: null, message: 'Re-attached completion watcher to running container: s-1' },
    { uuid: 'u-2', backend: 'docker', sessionName: 's-2', state: 'missing', action: 'reconciled', exitCode: 137, message: 'Session ended while unsupervised; record finalized.' },
  ],
});
const executions = parseExecutionResumeAllOutput(resumeAllJson);
assert(executions.length === 2, `both executions are read (got ${executions.length})`);
assert(executions[0].action === RESUME_ALL_ACTIONS.REATTACHED && executions[0].exitCode === null, 'a live container is reported as re-attached with no exit code');
assert(executions[1].action === RESUME_ALL_ACTIONS.RECONCILED && executions[1].exitCode === 137, 'a session that died unsupervised is reconciled with its exit code — the limbo state issue #2189 reported');
assert(parseExecutionResumeAllOutput('').length === 0, 'empty output yields an empty list');
assert(parseExecutionResumeAllOutput('Error: something').length === 0, 'unparseable output yields an empty list, never a throw — startup must not be blocked');
assert(parseExecutionResumeAllOutput(JSON.stringify([{ uuid: 'u-3', action: 'running' }])).length === 1, 'a bare array is accepted as well');

console.log('\n3. Unsupported-verb detection\n');

assert(isUnsupportedStartCommandVerb('Error: Unknown wrapper option: --resume-all'), "0.32.1's exact refusal is recognized as an unsupported verb");
assert(isUnsupportedStartCommandVerb('error: unrecognized option `--resume`'), 'other argument parsers are recognized too');
assert(!isUnsupportedStartCommandVerb('Session "s-1" is still running. Use `$ --attach u-1` to re-enter it.'), 'a real refusal is NOT mistaken for an unsupported verb');
assert(!isUnsupportedStartCommandVerb('No execution found with UUID or session name: u-9'), 'an unknown execution is NOT mistaken for an unsupported verb');

// ---------------------------------------------------------------------------
// 4. End to end against a stub `$`
// ---------------------------------------------------------------------------
console.log('\n4. Wrapper behaviour against a stub `$`\n');

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-issue-2189-resume-'));
const originalPath = process.env.PATH;

async function withStubStartCommand(script, run) {
  const binDir = path.join(tempDir, `bin-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(path.join(binDir, '$'), script, { mode: 0o755 });
  process.env.PATH = `${binDir}:${originalPath}`;
  try {
    return await run();
  } finally {
    process.env.PATH = originalPath;
  }
}

const successStub = `#!/bin/sh
case "$1" in
  --resume) echo '${snapshotJson}' ;;
  --resume-all) echo '${resumeAllJson}' ;;
esac
exit 0
`;

// 0.32.1 verbatim: the message goes to stderr and the process exits 1 — and
// \`command-stream\` resolves rather than throwing, which is exactly what the
// wrappers must not read as success.
const oldVersionStub = `#!/bin/sh
echo "Error: Unknown wrapper option: $1" >&2
exit 1
`;

const refusalStub = `#!/bin/sh
echo 'Error: Session "hive-solve-1" is still running. Use \`$ --attach u-1\` to re-enter it, or \`$ --stop u-1\` first.' >&2
exit 1
`;

const resumed = await withStubStartCommand(successStub, () => resumeIsolatedSession('u-1', { command: 'solve https://github.com/o/r/issues/1 --resume abc-123' }));
assert(resumed.success === true, `a successful resume is reported as success (error: ${resumed.error})`);
assert(resumed.sessionName === 'hive-solve-1-resume-1' && resumed.uuid === '11111111-2222-3333-4444-555555555555', 'the parsed session name and preserved UUID reach the caller');

const reconciled = await withStubStartCommand(successStub, () => resumeAllIsolationSessions({}));
assert(reconciled.success === true && reconciled.executions.length === 2, `--resume-all reports both executions (got ${reconciled.executions.length})`);

const onOldBinary = await withStubStartCommand(oldVersionStub, () => resumeIsolatedSession('u-1', { command: 'solve https://x' }));
assert(onOldBinary.success === false, 'a non-zero exit is NOT reported as a successful resume (command-stream resolves instead of throwing)');
assert(onOldBinary.unsupported === true, 'an older `$` is reported as unsupported so the caller can fall back');

const allOnOldBinary = await withStubStartCommand(oldVersionStub, () => resumeAllIsolationSessions({}));
assert(allOnOldBinary.success === false && allOnOldBinary.unsupported === true, '`--resume-all` degrades the same way on an older `$`');
assert(allOnOldBinary.executions.length === 0, 'no executions are invented when the verb is unsupported');

const refused = await withStubStartCommand(refusalStub, () => resumeIsolatedSession('u-1', { command: 'solve https://x' }));
assert(refused.success === false, 'a still-running session is not resumed');
assert(refused.unsupported === false, 'a real refusal is reported as a refusal, not as a missing feature');
assert(/still running/.test(refused.error || ''), `the upstream reason reaches the caller (got ${refused.error})`);

console.log('\n5. Missing `$`\n');

const emptyDir = path.join(tempDir, 'empty');
await fs.mkdir(emptyDir, { recursive: true });
process.env.PATH = emptyDir;
try {
  const missing = await resumeIsolatedSession('u-1', { command: 'solve https://x' });
  assert(missing.success === false && missing.unsupported === true, 'a missing `$` is reported, not thrown');
  const missingAll = await resumeAllIsolationSessions({});
  assert(missingAll.success === false && missingAll.executions.length === 0, '`--resume-all` with no `$` returns an empty reconciliation');
} finally {
  process.env.PATH = originalPath;
}

assert((await resumeIsolatedSession(null, {})).error !== null, 'resuming without an identifier is rejected up front');

// ---------------------------------------------------------------------------
// 6. Same root cause: `$ --stop` refusals must not read as success
// ---------------------------------------------------------------------------
console.log('\n6. `$ --stop` exit code\n');

const stopRefusalStub = `#!/bin/sh
echo 'Error: No execution found with UUID or session name: u-9' >&2
exit 1
`;
const stopOkStub = `#!/bin/sh
echo 'Stopped execution u-1'
exit 0
`;

const stopRefused = await withStubStartCommand(stopRefusalStub, () => stopIsolatedSession('u-9'));
assert(stopRefused.success === false, 'a refused `$ --stop` is reported as a failure, not as a stop that happened');
assert(/No execution found/.test(stopRefused.error || ''), `the upstream reason reaches the operator (got ${stopRefused.error})`);

const stopped = await withStubStartCommand(stopOkStub, () => stopIsolatedSession('u-1'));
assert(stopped.success === true && /Stopped execution/.test(stopped.output), 'a successful `$ --stop` still reports success');

await fs.rm(tempDir, { recursive: true, force: true });

printSummary('Issue #2189 — isolation resume wrappers');
process.exit(getFailCount() > 0 ? 1 : 0);
