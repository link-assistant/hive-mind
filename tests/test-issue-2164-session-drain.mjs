#!/usr/bin/env node
/**
 * Regression test for draining a finished task's session data (issue #2164, R7).
 *
 * The router's request log records what was sent to the model; the agent's own
 * `~/.claude` records what it then did. In a routed task the second lives only
 * inside a container that is about to be reclaimed, so this suite pins the
 * behaviour that gets it out: copy before teardown, never fail loudly, and
 * never leave the staging directory behind.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2164
 */

import fs from 'node:fs';
import path from 'node:path';

import { DRAINABLE_SESSION_PATHS, drainTaskSessionData, isSessionDrainEnabled, resolveSessionArchiveHostDir, TASK_SESSION_ARCHIVE_DIR } from '../src/router-session-drain.lib.mjs';
import { ROUTER_SIDECAR_CONTAINER_NAME } from '../src/router-isolation.lib.mjs';

let passed = 0;
let failed = 0;

function pass(label) {
  console.log(`  PASS: ${label}`);
  passed++;
}

function fail(label, expected, actual) {
  console.error(`  FAIL: ${label}`);
  if (expected !== undefined) console.error(`     expected: ${JSON.stringify(expected)}`);
  if (actual !== undefined) console.error(`     actual:   ${JSON.stringify(actual)}`);
  failed++;
}

function assertEqual(actual, expected, label) {
  if (actual === expected) pass(label);
  else fail(label, expected, actual);
}

const SESSION = 'a1b2c3d4-0000-4000-8000-000000000001';
const root = fs.mkdtempSync(path.join('/tmp', `hive-mind-test-2164-drain-${process.pid}-`));
const tmpDir = path.join(root, 'staging');
fs.mkdirSync(tmpDir, { recursive: true });

/**
 * A fake `docker` in which the task container exists and holds exactly the
 * paths listed in `present`; `docker cp` of anything else fails the way the
 * real one does.
 */
const makeDocker = ({ taskExists = true, present = [], routerUp = true } = {}) => {
  const calls = [];
  const run = async (binary, args) => {
    calls.push(args.join(' '));
    const [verb] = args;
    if (verb === 'inspect') {
      if (args[1] === SESSION && taskExists) return { stdout: 'false|task-image|sha256:task\n' };
      throw new Error('No such object');
    }
    if (verb === 'cp') {
      const [, source, destination] = args;
      if (source.startsWith(`${SESSION}:`)) {
        const wanted = source.slice(SESSION.length + 1);
        if (!present.includes(wanted)) throw new Error(`Could not find the file ${wanted}`);
        // Stand in for the real copy so the staging contents can be inspected.
        fs.mkdirSync(destination, { recursive: true });
        fs.writeFileSync(path.join(destination, 'transcript.jsonl'), '{}\n');
        return { stdout: '' };
      }
      if (destination.startsWith(`${ROUTER_SIDECAR_CONTAINER_NAME}:`)) {
        if (!routerUp) throw new Error('No such container');
        return { stdout: '' };
      }
    }
    if (verb === 'exec') {
      if (!routerUp) throw new Error('No such container');
      return { stdout: '' };
    }
    return { stdout: '' };
  };
  return { calls, run };
};

const stagingLeftovers = () => fs.readdirSync(tmpDir);
const claudePath = DRAINABLE_SESSION_PATHS.find(entry => entry.label === 'claude').source;

console.log('\n=== issue #2164: draining is on by default and configurable ===');

assertEqual(isSessionDrainEnabled({}), true, 'an audit trail that must be switched on would be missing when it matters, so it defaults on');
assertEqual(isSessionDrainEnabled({ HIVE_MIND_ROUTER_DRAIN_SESSIONS: '0' }), false, 'an operator can switch it off explicitly');
assertEqual(resolveSessionArchiveHostDir({}), null, 'without an override the archive lives in the router volume');
assertEqual(resolveSessionArchiveHostDir({ HIVE_MIND_SESSION_ARCHIVE_DIR: '/var/log/hive-mind' }), '/var/log/hive-mind', 'the root host can host the archive instead (R7)');

console.log('\n=== issue #2164: session data is copied into the router volume ===');

const docker = makeDocker({ present: [claudePath] });
const drained = await drainTaskSessionData({ sessionId: SESSION, env: {}, run: docker.run, tmpDir, now: () => new Date('2026-08-21T00:00:00.000Z') });

assertEqual(drained.error, null, 'a healthy drain reports no error');
assertEqual(drained.drained.join(','), 'claude', 'only the paths the task actually produced are archived');
assertEqual(drained.destination, `${TASK_SESSION_ARCHIVE_DIR}/${SESSION}`, 'the archive is keyed by session id, next to that session’s request log');
assertEqual(
  docker.calls.some(call => call === `exec ${ROUTER_SIDECAR_CONTAINER_NAME} mkdir -p ${TASK_SESSION_ARCHIVE_DIR}/${SESSION}`),
  true,
  'the destination is created inside the router before anything is copied into it'
);
assertEqual(
  docker.calls.some(call => call.startsWith('cp ') && call.endsWith(`${ROUTER_SIDECAR_CONTAINER_NAME}:${TASK_SESSION_ARCHIVE_DIR}/${SESSION}`) && call.includes('/.')),
  true,
  'the staging contents are copied in, not the staging directory itself'
);
assertEqual(stagingLeftovers().length, 0, 'the staging directory is removed even on the happy path');

console.log('\n=== issue #2164: the drain never becomes the reason a teardown fails ===');

const gone = await drainTaskSessionData({ sessionId: SESSION, env: {}, run: makeDocker({ taskExists: false }).run, tmpDir });
assertEqual(gone.skipped, 'task container is gone', 'a container that was already reclaimed is reported, not treated as an error');
assertEqual(gone.error, null, 'and is not an error');

const empty = await drainTaskSessionData({ sessionId: SESSION, env: {}, run: makeDocker({ present: [] }).run, tmpDir });
assertEqual(empty.skipped, 'task recorded no session data', 'a task that wrote nothing is skipped rather than archived empty');
assertEqual(stagingLeftovers().length, 0, 'and leaves no staging directory behind');

const noRouter = await drainTaskSessionData({ sessionId: SESSION, env: {}, run: makeDocker({ present: [claudePath], routerUp: false }).run, tmpDir });
assertEqual(typeof noRouter.error, 'string', 'a router that has already gone away yields an error the caller can log');
assertEqual(noRouter.drained.length, 0, 'and nothing is claimed to have been archived');
assertEqual(stagingLeftovers().length, 0, 'and the staging directory is still cleaned up');

const disabled = await drainTaskSessionData({ sessionId: SESSION, env: { HIVE_MIND_ROUTER_DRAIN_SESSIONS: 'false' }, run: makeDocker({ present: [claudePath] }).run, tmpDir });
assertEqual(disabled.skipped, 'disabled', 'the opt-out is honoured before any docker call is made');

console.log('\n=== issue #2164: archiving to the root host instead ===');

const hostArchive = path.join(root, 'archive');
const hostDocker = makeDocker({ present: [claudePath] });
const toHost = await drainTaskSessionData({ sessionId: SESSION, env: { HIVE_MIND_SESSION_ARCHIVE_DIR: hostArchive }, run: hostDocker.run, tmpDir });

assertEqual(toHost.destination, path.join(hostArchive, SESSION), 'the archive lands under the configured host directory');
assertEqual(fs.existsSync(path.join(hostArchive, SESSION, 'claude', 'transcript.jsonl')), true, "the agent's transcript survives the container that produced it");

const manifest = JSON.parse(fs.readFileSync(path.join(hostArchive, SESSION, 'manifest.json'), 'utf8'));
assertEqual(manifest.sessionId, SESSION, 'the archive is self-describing: an auditor can tell which task it came from');
assertEqual(manifest.paths.join(','), 'claude', 'and which paths it contains');
assertEqual(
  hostDocker.calls.some(call => call.startsWith('exec ')),
  false,
  'archiving to the host needs no running router at all'
);

fs.rmSync(root, { recursive: true, force: true });

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
