#!/usr/bin/env node
/* global console, process, setTimeout */
// Issue #2889: end-to-end check of the in-place command handoff with a real
// Docker daemon and start-command (`$`).
//
//   1. Launch a task container exactly as Hive Mind does (handoff prefix +
//      start gate), release its gate, let it run, then kill it (exit 137).
//   2. Write a recovery command into the stopped container with `docker cp`.
//   3. `$ --resume <session>` WITHOUT a command → start-command's docker-start
//      mode restarts the same container, which runs the recovery command.
//   4. Verify: same container id, recovery output in its logs, no
//      `start-command-resume/*` image, no `<session>-resume-*` container.
//
// With --compare-snapshot it then does what Hive Mind did before: resume WITH a
// command. start-command before 0.37 commits the container's writable layer to
// an image; 0.37 (link-foundation/start#198) hands the command in place itself.
//
// START_COMMAND_BIN selects the `$` binary; its directory is put first on PATH
// so the Hive Mind helpers (which resolve `$` with `which`) use the same build.
//
// Usage: node experiments/issue-2889-docker-start-handoff.mjs [--compare-snapshot] [--image alpine:3.20]
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { buildDockerIsolationStartArgs, querySessionStatus, releaseDockerContainerStartGate, resumeIsolatedSession, readDockerResumeHandoffPath, writeDockerResumeHandoff } from '../src/isolation-runner.lib.mjs';
import { buildShellCommandLine } from '../src/docker-resume-handoff.lib.mjs';

const argv = process.argv.slice(2);
const image = argv.includes('--image') ? argv[argv.indexOf('--image') + 1] : 'alpine:3.20';
const compareSnapshot = argv.includes('--compare-snapshot');
const startBin = process.env.START_COMMAND_BIN || `${os.homedir()}/.bun/bin/$`;
process.env.PATH = `${path.dirname(startBin)}${path.delimiter}${process.env.PATH || ''}`;
const sessionId = crypto.randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
};
const docker = (...args) => sh('docker', args);
const waitFor = async (what, check, ms = 60000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) if (check()) return true;
  throw new Error(`timed out waiting for ${what}`);
};
const resumeImages = () => docker('images', '--filter', `reference=start-command-resume/${sessionId}*`, '--format', '{{.Repository}}:{{.Tag}} {{.Size}}').out;
let failures = 0;
let uuid;
let startAtLeast037;
const check = (ok, label) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  if (!ok) failures++;
};

try {
  const startVersion = sh(startBin, ['--version']).out.split('\n')[0];
  const [major, minor] = (startVersion.match(/(\d+)\.(\d+)\.\d+/) || []).slice(1).map(Number);
  startAtLeast037 = major > 0 || minor >= 37;
  console.log(`docker ${docker('version', '--format', '{{.Server.Version}}').out}, ${startVersion}, image ${image}, session ${sessionId}`);
  if (docker('image', 'inspect', image).code !== 0) docker('pull', '-q', image);

  // 1. Launch like Hive Mind (no host mounts in this experiment).
  const args = buildDockerIsolationStartArgs('sh', ['-c', 'echo TASK-STARTED; dd if=/dev/zero of=/root/build-output bs=1M count=64 2>/dev/null; echo TASK-WROTE-64MiB; sleep 600'], { sessionId, env: { ...process.env, HIVE_MIND_DOCKER_ISOLATION_IMAGE: image }, homeDir: os.tmpdir(), existsSync: () => false, installGuard: () => null });
  const launched = sh(startBin, args);
  console.log(`$ launch exit ${launched.code}`);
  await waitFor('the container', () => docker('inspect', sessionId).code === 0);
  console.log('Container command:', docker('inspect', '-f', '{{json .Config.Cmd}}', sessionId).out);
  await releaseDockerContainerStartGate(sessionId, false);
  await waitFor('the task output', () => docker('logs', sessionId).out.includes('TASK-WROTE-64MiB'));
  const containerId = docker('inspect', '-f', '{{.Id}}', sessionId).out;
  docker('kill', sessionId);
  await waitFor('the container to stop', () => docker('inspect', '-f', '{{.State.Status}}', sessionId).out === 'exited');
  console.log(`Killed: exit ${docker('inspect', '-f', '{{.State.ExitCode}}', sessionId).out}, writable layer ${docker('inspect', '--size', '-f', '{{.SizeRw}}', sessionId).out} bytes`);
  // start-command records the execution as finished once its watcher sees the exit.
  await sleep(3000);

  // 2. Hand the recovery command to the stopped container.
  const handoffPath = await readDockerResumeHandoffPath(sessionId, { verbose: true });
  check(Boolean(handoffPath), 'the task container accepts a resume handoff');
  const written = await writeDockerResumeHandoff(sessionId, handoffPath, buildShellCommandLine('sh', ['-c', 'echo RECOVERY-RAN; ls -la /root/build-output; sleep 600']), { verbose: true });
  check(written.success, 'the recovery command was copied into the stopped container');

  // 3. Resume without a command, addressed by the execution UUID as Hive Mind does.
  uuid = (await querySessionStatus(sessionId))?.uuid || sessionId;
  console.log(`Execution UUID: ${uuid}`);
  const started = Date.now();
  const resumed = await resumeIsolatedSession(uuid, { command: null, verbose: true });
  console.log(`$ --resume (no command): ${JSON.stringify({ success: resumed.success, mode: resumed.mode, sessionName: resumed.sessionName, error: resumed.error })} in ${Date.now() - started} ms`);
  check(resumed.success && resumed.mode === 'docker-start', 'start-command chose docker-start');

  // 4. Same container, recovery command ran, nothing copied.
  await waitFor('the recovery output', () => docker('logs', sessionId).out.includes('RECOVERY-RAN'));
  check(docker('inspect', '-f', '{{.Id}}', sessionId).out === containerId, 'the very same container is running again');
  check(/build-output/.test(docker('logs', sessionId).out.split('RECOVERY-RAN')[1] || ''), "the recovery sees the killed task's files (same writable layer)");
  check(!docker('logs', sessionId).out.split('RECOVERY-RAN')[1]?.includes('TASK-STARTED'), 'the gated task did not run again');
  check(resumeImages() === '', 'no start-command-resume/* image was committed');
  check(docker('ps', '-a', '--filter', `name=${sessionId}-resume-`, '--format', '{{.Names}}').out === '', 'no <session>-resume-* container was created');

  if (compareSnapshot) {
    docker('kill', sessionId);
    await waitFor('the container to stop', () => docker('inspect', '-f', '{{.State.Status}}', sessionId).out === 'exited');
    await sleep(3000);
    const t0 = Date.now();
    const snap = await resumeIsolatedSession(uuid, { command: 'echo SNAPSHOT-RESUME', verbose: true });
    console.log(`$ --resume -- <command> (previous behaviour): mode=${snap.mode} in ${Date.now() - t0} ms; images: ${resumeImages() || '(none)'}`);
    if (startAtLeast037) check(snap.mode === 'docker-start' && resumeImages() === '', 'start-command >= 0.37 also resumes a new command in place (link-foundation/start#198 fixed upstream)');
    else check(snap.mode === 'docker-snapshot' && resumeImages() !== '', 'with a command, start-command commits the writable layer (the copy #2889 avoids)');
  }

  // 5. A container start-command >= 0.37 created without the Hive Mind prefix
  //    (Hive Mind 2.35.4–2.35.7) resumes through start-command's own marker.
  if (startAtLeast037) {
    const plain = `${sessionId}-plain`;
    sh(startBin, ['--isolated', 'docker', '--image', image, '--detached', '--session', plain, '--', 'sh', '-c', 'echo PLAIN-TASK; sleep 600']);
    await waitFor('the plain container output', () => docker('logs', plain).out.includes('PLAIN-TASK'));
    const plainId = docker('inspect', '-f', '{{.Id}}', plain).out;
    docker('kill', plain);
    await waitFor('the plain container to stop', () => docker('inspect', '-f', '{{.State.Status}}', plain).out === 'exited');
    await sleep(3000);
    const marker = await readDockerResumeHandoffPath(plain, { verbose: true });
    check(marker === `/.start-command-resume-${plain}`, "a start-command 0.37 container without the prefix is resumable through start-command's marker");
    check((await writeDockerResumeHandoff(plain, marker, buildShellCommandLine('sh', ['-c', 'echo PLAIN-RECOVERY; sleep 600']), { verbose: true })).success, 'the recovery command was copied to that marker');
    const plainResumed = await resumeIsolatedSession((await querySessionStatus(plain))?.uuid || plain, { command: null, verbose: true });
    check(plainResumed.mode === 'docker-start', 'start-command chose docker-start for it');
    await waitFor('the plain recovery output', () => docker('logs', plain).out.includes('PLAIN-RECOVERY'));
    check(docker('inspect', '-f', '{{.Id}}', plain).out === plainId && resumeImages() === '', 'the same container ran the recovery, nothing was committed');
  }
} catch (error) {
  failures++;
  console.log(`FAIL: ${error.message}`);
} finally {
  for (const name of docker('ps', '-a', '--filter', `name=${sessionId}`, '--format', '{{.Names}}').out.split('\n').filter(Boolean)) docker('rm', '-f', name);
  for (const ref of resumeImages().split('\n').filter(Boolean)) docker('rmi', ref.split(' ')[0]);
}
console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
process.exit(failures ? 1 : 0);
