/**
 * Issue #2889, second part: copy-free `docker start` resumes, cache pruning
 * before a snapshot, removal of the replaced original and of obsolete
 * snapshot images, and Telegram notices for every stage.
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resumeKilledSessionInPlace } from '../src/session-kill-resume.in-place.lib.mjs';
import { recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { createSnapshotQueue } from '../src/kill-recovery-snapshot-guard.lib.mjs';
import { applyDockerTaskContainerCompletionAction, buildDockerTaskContainerCompletionAction } from '../src/session-monitor.lib.mjs';
import { CACHEDIR_TAG_SIGNATURE, buildSnapshotCachePruneScript, describeDockerTaskLaunch, parseSnapshotCachePruneOutput, pruneStoppedContainerCaches, removeReplacedResumeOriginal, removeSnapshotImages, snapshotImagesForContainer } from '../src/kill-recovery-snapshot-cleanup.lib.mjs';

const GIB = 1024 ** 3;
const URL = 'https://github.com/link-assistant/router/issues/727';
const HANDOFF = ['sh', '-c', 'p=$1; shift; if [ -f "$p" ]; then exec sh "$p"; fi; exec "$@"', 'start-command-handoff', '/.start-command-resume-c1'];
const FAIL_CLOSED_GATE = `gate='/tmp/hive-mind-disk-baseline-c1'; while [ ! -e "$gate" ]; do sleep 0.1; done; rm -f "$gate"; exec 'solve' '${URL}'`;
const TIMED_GATE = `gate='/tmp/hive-mind-disk-baseline-c1'; i=0; while [ ! -e "$gate" ] && [ "$i" -lt 300 ]; do i=$((i+1)); sleep 0.1; done; rm -f "$gate"; exec 'solve' '${URL}'`;
const info = (name, layerGiB = 31) => ({ command: 'solve', args: [URL, '--tool', 'codex'], tool: 'codex', isolationBackend: 'docker', sessionId: name, executionUuid: `${name}-uuid`, containerFilesystemLastBytes: layerGiB * GIB });
const plan = { attempt: 1, command: { binary: 'solve', args: [URL, '--tool', 'codex', '--resume', 'thread'] } };

function fakeRunner({ launch = null, mode = RESUME_MODES.DOCKER_SNAPSHOT, freeGiB = 500, startupFailed = false, prunedBytes = 0 } = {}) {
  const calls = [];
  return {
    calls,
    checkDockerContainerExists: async () => true,
    checkDockerDiskSpace: async () => {
      calls.push('disk');
      return { availableGiB: freeGiB };
    },
    inspectDockerTaskLaunch: async name => {
      calls.push(`inspect ${name}`);
      return launch;
    },
    pruneStoppedContainerCaches: async name => {
      calls.push(`prune ${name}`);
      return { pruned: prunedBytes > 0, freedBytes: prunedBytes, paths: ['/tmp/ws/target'], reason: null };
    },
    resumeIsolatedSession: async identifier => {
      calls.push(`resume ${identifier}`);
      const name = identifier.replace(/-uuid$/, '');
      return mode === RESUME_MODES.DOCKER_START ? { success: true, uuid: identifier, mode, sessionName: name, previousSessionName: null, snapshotImage: null } : { success: true, uuid: identifier, mode, sessionName: `${name}-resume-1`, previousSessionName: name, snapshotImage: `start-command-resume/${name}:1` };
    },
    checkResumedDockerStartup: async () => ({ failed: startupFailed, exitCode: startupFailed ? 127 : null, error: startupFailed ? 'exited with code 127' : null }),
    cleanupFailedResumeSnapshot: async () => ({ success: true }),
    removeReplacedResumeOriginal: async (result, { originalName }) => {
      calls.push(`remove-original ${originalName}`);
      return { removed: true, error: null };
    },
  };
}

test('launch inspection: start-command handoff and the Hive Mind start gate are recognized', () => {
  assert.deepEqual(describeDockerTaskLaunch([...HANDOFF, 'sh', '-c', FAIL_CLOSED_GATE]), { commandHandoff: true, startGate: 'fail-closed' });
  assert.deepEqual(describeDockerTaskLaunch(['sh', '-c', TIMED_GATE]), { commandHandoff: false, startGate: 'timed' });
  assert.deepEqual(describeDockerTaskLaunch(['sh', '-c', `exec 'solve' '${URL}'`]), { commandHandoff: false, startGate: null });
  assert.equal(describeDockerTaskLaunch(null), null);
});

test('a container with a command handoff resumes with docker start: no queue, no disk wait, no prune', async () => {
  const runner = fakeRunner({ launch: { commandHandoff: true, startGate: 'fail-closed' }, mode: RESUME_MODES.DOCKER_START, freeGiB: 1 });
  const notices = [];
  let queued = 0;
  const queue = { run: async task => (queued++, task()) };
  const result = await resumeKilledSessionInPlace({ sessionName: 'c1', sessionInfo: info('c1'), plan, runner, notify: async event => notices.push(event), snapshotGuard: { queue } });
  assert.equal(result.resumed, true);
  assert.equal(result.mode, RESUME_MODES.DOCKER_START);
  assert.equal(queued, 0);
  assert.ok(!runner.calls.includes('disk'));
  assert.ok(!runner.calls.some(call => call.startsWith('prune') || call.startsWith('remove-original')));
  assert.ok(notices.some(event => /docker start.*no snapshot/i.test(event.reason || '')));
});

test('a legacy fail-closed container is pruned before the snapshot and the freed space counts', async () => {
  // 31 GiB layer, 40 GiB free: 72 GiB needed before pruning, 22 GiB after.
  const runner = fakeRunner({ launch: { commandHandoff: false, startGate: 'fail-closed' }, freeGiB: 40, prunedBytes: 25 * GIB });
  const notices = [];
  const result = await resumeKilledSessionInPlace({ sessionName: 'c1', sessionInfo: info('c1', 31), plan, runner, notify: async event => notices.push(event), snapshotGuard: { queue: createSnapshotQueue(), waitMs: 0 } });
  assert.equal(result.resumed, true);
  assert.ok(runner.calls.indexOf('prune c1') < runner.calls.indexOf('resume c1-uuid'));
  assert.ok(notices.some(event => /Removed 25\.0 GiB of regenerable build caches/.test(event.reason || '')));
  assert.ok(notices.some(event => /^Snapshotting 6\.0 GiB of c1/.test(event.reason || '')));
});

test('a timed-gate container is never started for pruning', async () => {
  const runner = fakeRunner({ launch: { commandHandoff: false, startGate: 'timed' } });
  await resumeKilledSessionInPlace({ sessionName: 'c1', sessionInfo: info('c1', 2), plan, runner, snapshotGuard: { queue: createSnapshotQueue() } });
  assert.ok(!runner.calls.some(call => call.startsWith('prune')));
  const run = async () => assert.fail('docker must not run');
  const skipped = await pruneStoppedContainerCaches('c1', { launch: { commandHandoff: false, startGate: 'timed' }, run });
  assert.equal(skipped.pruned, false);
  assert.match(skipped.reason, /original task/);
  const handoff = await pruneStoppedContainerCaches('c1', { launch: { commandHandoff: true, startGate: 'fail-closed' }, run });
  assert.equal(handoff.pruned, false);
});

test('the snapshot stage is reported in Telegram with its size, even when unmeasured', async () => {
  const notices = [];
  const runner = fakeRunner({ freeGiB: 100 });
  await resumeKilledSessionInPlace({ sessionName: 'c1', sessionInfo: info('c1', 12), plan, runner, notify: async event => notices.push(event), snapshotGuard: { queue: createSnapshotQueue() } });
  assert.ok(notices.some(event => event.phase === 'launching' && /^Snapshotting 12\.0 GiB of c1 \(100\.0 GiB free, 34\.0 GiB needed\)/.test(event.reason || '')));
  const unmeasured = [];
  await resumeKilledSessionInPlace({ sessionName: 'c2', sessionInfo: { ...info('c2'), containerFilesystemLastBytes: undefined }, plan, runner: { ...fakeRunner(), checkDockerDiskSpace: async () => null }, notify: async event => unmeasured.push(event), snapshotGuard: { queue: createSnapshotQueue() } });
  assert.ok(unmeasured.some(event => /^Snapshotting c2 \(size not measured\)/.test(event.reason || '')));
});

test('the replaced original is removed only after the snapshot container started', async () => {
  const ok = fakeRunner();
  const result = await resumeKilledSessionInPlace({ sessionName: 'c1', sessionInfo: info('c1', 1), plan, runner: ok, snapshotGuard: { queue: createSnapshotQueue() } });
  assert.equal(result.originalRemoved, true);
  assert.ok(ok.calls.includes('remove-original c1'));
  const failed = fakeRunner({ startupFailed: true });
  await resumeKilledSessionInPlace({ sessionName: 'c1', sessionInfo: info('c1', 1), plan, runner: failed, snapshotGuard: { queue: createSnapshotQueue() } });
  assert.ok(!failed.calls.some(call => call.startsWith('remove-original')));
});

test('removeReplacedResumeOriginal removes only the confirmed original, without force', async () => {
  const calls = [];
  const run = async (cmd, args) => calls.push([cmd, ...args]);
  const result = { mode: 'docker-snapshot', sessionName: 'c1-resume-1', previousSessionName: 'c1', snapshotImage: 'start-command-resume/c1:1' };
  assert.equal((await removeReplacedResumeOriginal(result, { originalName: 'c1', run })).removed, true);
  assert.deepEqual(calls, [['docker', 'rm', 'c1']]);
  for (const bad of [
    { ...result, mode: 'docker-start' },
    { ...result, previousSessionName: 'other' },
    { ...result, sessionName: 'c1' },
  ]) {
    assert.equal((await removeReplacedResumeOriginal(bad, { originalName: 'c1', run })).removed, false);
  }
  assert.equal(calls.length, 1);
});

test('snapshot images of a finished task are derived from the container chain and removed', async () => {
  assert.deepEqual(snapshotImagesForContainer('Abc-resume-1-resume-2'), ['start-command-resume/abc-resume-1:2', 'start-command-resume/abc:1']);
  assert.deepEqual(snapshotImagesForContainer('abc'), []);
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(args.join(' '));
    if (args[2] === 'start-command-resume/abc:1') throw Object.assign(new Error('conflict'), { stderr: 'image is being used by stopped container' });
  };
  const removed = await removeSnapshotImages(['start-command-resume/abc-resume-1:2', 'start-command-resume/abc:1', 'konard/hive-mind:2.37.0', 'start-command-resume/abc:1'], { run });
  assert.deepEqual(calls, ['image rm start-command-resume/abc-resume-1:2', 'image rm start-command-resume/abc:1']);
  assert.deepEqual(removed.removed, ['start-command-resume/abc-resume-1:2']);
  assert.equal(removed.retained[0].image, 'start-command-resume/abc:1');
});

test('the completion action lists the snapshot images to remove with the container', () => {
  const action = buildDockerTaskContainerCompletionAction({ sessionName: 'abc', sessionInfo: { isolationBackend: 'docker', sessionId: 'abc-resume-1', command: 'solve', killRecoverySnapshotImages: ['start-command-resume/old:1'] }, exitCode: 0, status: 'executed', env: {} });
  assert.equal(action.shouldRemove, true);
  assert.deepEqual(action.snapshotImages, ['start-command-resume/abc:1', 'start-command-resume/old:1']);
});

test('the container is removed before its snapshot images, and never while its docker start recovery runs in it', async () => {
  const action = buildDockerTaskContainerCompletionAction({ sessionName: 'abc', sessionInfo: { isolationBackend: 'docker', sessionId: 'abc-resume-1', command: 'solve' }, exitCode: 0, status: 'executed', env: {} });
  const calls = [];
  const removeDockerContainer = async name => (calls.push(`rm ${name}`), { success: true });
  const removeImages = async images => calls.push(`rmi ${images.join(' ')}`);
  await applyDockerTaskContainerCompletionAction(action, { removeDockerContainer, removeImages });
  assert.deepEqual(calls, ['rm abc-resume-1', 'rmi start-command-resume/abc:1']);
  calls.length = 0;
  await applyDockerTaskContainerCompletionAction(action, { removeDockerContainer, removeImages, sessionInfo: { killRecoveryContainerName: 'abc-resume-1' } });
  assert.deepEqual(calls, []);
});

test('a snapshot resume records its image on the recovery session', async () => {
  const runner = { ...fakeRunner(), generateSessionId: () => 'fresh', executeWithIsolation: async () => assert.fail('no fresh launch') };
  const tracked = [];
  await recoverKilledSession({ sessionName: 'c1', sessionInfo: { ...info('c1', 1), killRecoverySnapshotImages: ['start-command-resume/c0:1'] }, runner, killed: true, env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' }, snapshotGuard: { queue: createSnapshotQueue() }, readLastSessionId: () => 'thread', trackSession: (name, data) => tracked.push({ name, data }) });
  assert.deepEqual(tracked[0].data.killRecoverySnapshotImages, ['start-command-resume/c0:1', 'start-command-resume/c1:1']);
});

test('the prune script removes only tagged caches and node_modules/.cache, never sources', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-2889-'));
  const write = (rel, text = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  write('ws/src/main.rs', 'fn main() {}');
  write('ws/Cargo.toml');
  write('ws/target/CACHEDIR.TAG', `${CACHEDIR_TAG_SIGNATURE}\n`);
  write('ws/target/debug/big', 'y'.repeat(8192));
  write('ws/untagged/target/keep');
  write('ws/fake/CACHEDIR.TAG', 'not a cache\n');
  write('ws/project/CACHEDIR.TAG', `${CACHEDIR_TAG_SIGNATURE}\n`);
  write('ws/project/package.json');
  write('ws/web/node_modules/.cache/babel/x');
  write('ws/web/node_modules/left-pad/index.js');
  write('ws/.git/target/CACHEDIR.TAG', `${CACHEDIR_TAG_SIGNATURE}\n`);
  const script = buildSnapshotCachePruneScript({ roots: [root], requireGate: false });
  const out = execFileSync('sh', ['-c', script], { encoding: 'utf8' });
  const parsed = parseSnapshotCachePruneOutput(out);
  const exists = rel => fs.existsSync(path.join(root, rel));
  assert.equal(exists('ws/target'), false);
  assert.equal(exists('ws/web/node_modules/.cache'), false);
  for (const kept of ['ws/src/main.rs', 'ws/Cargo.toml', 'ws/untagged/target/keep', 'ws/fake/CACHEDIR.TAG', 'ws/project/package.json', 'ws/web/node_modules/left-pad/index.js', 'ws/.git/target/CACHEDIR.TAG']) assert.ok(exists(kept), kept);
  assert.equal(parsed.paths.length, 2);
  assert.ok(parsed.freedBytes > 0);
  assert.equal(parsed.gateOpen, false);
  fs.rmSync(root, { recursive: true, force: true });
});

test('pruning holds the container in its closed gate, then kills it, even when the prune fails', async () => {
  const calls = [];
  const run = async (cmd, args) => {
    calls.push(args[0]);
    if (args[0] === 'exec') throw Object.assign(new Error('exit 3'), { stdout: 'gate-open\n' });
    return { stdout: '' };
  };
  const result = await pruneStoppedContainerCaches('c1', { launch: { commandHandoff: false, startGate: 'fail-closed' }, run });
  assert.deepEqual(calls, ['start', 'exec', 'kill']);
  assert.equal(result.pruned, false);
  assert.match(result.reason, /gate/);
  // The gate check reads PID 1, and the script's own text must not satisfy it.
  const script = buildSnapshotCachePruneScript({ roots: [os.tmpdir()] });
  assert.match(script, /\/proc\/1\/cmdline/);
  assert.doesNotMatch(script, /hive-mind-disk-baseline-/);
  const refused = (() => {
    try {
      return execFileSync('sh', ['-c', script], { encoding: 'utf8' });
    } catch (error) {
      return error.status === 3 ? error.stdout : '';
    }
  })();
  assert.equal(parseSnapshotCachePruneOutput(refused).gateOpen, true);
});
