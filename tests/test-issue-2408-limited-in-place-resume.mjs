#!/usr/bin/env node

/**
 * Issue #2408: one logical session keeps one execution UUID and one log, also
 * when it runs with Hive Mind container resource limits.
 *
 * Before start-command 0.35.0 a snapshot resume (`$ --resume <id> -- <cmd>`)
 * started the replacement container without the CPU/RAM limits Hive Mind had
 * applied with `docker update`, so resource-limited sessions were recovered by
 * a fresh launch — new UUID, new log. start#176 (filed from this issue) makes
 * `$ --resume` re-apply the stopped container's HostConfig limits, so:
 *
 *   1. The installed `$` version is parsed from `$ --version` and gates the
 *      in-place path (unknown or older → fresh launch, as before).
 *   2. A resumed limited session gets its CPU/RAM re-asserted with
 *      `docker update`, so a silent upstream miss cannot leave it unbounded.
 *   3. The disk limit is monitor-enforced against the writable layer, which a
 *      snapshot resets; the usage so far is carried into the new session and
 *      counted by the disk enforcement. Without a measurement to carry, the
 *      fresh path is used rather than silently resetting the allowance.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2408
 * @see https://github.com/link-foundation/start/issues/176
 */

import { planSameContainerResume, resumeKilledSessionInPlace, startCommandResumeKeepsResourceLimits, getCarriedContainerDiskUsage, IN_PLACE_SKIP_REASONS } from '../src/session-kill-resume.in-place.lib.mjs';
import { recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { enforceContainerDiskLimitForSession } from '../src/container-resource-monitor.lib.mjs';
import { parseStartCommandVersion } from '../src/start-command-cli.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2408: resource-limited sessions resume in place on start-command >= 0.35.0');
console.log('='.repeat(78));

const SESSION = '7edfe0cf-a4a0-47f5-bd68-a9b93b4dc18c';
const UUID = 'b1e2c3d4-0000-4000-8000-000000002408';
const TOOL_SESSION = '9c2a1b7e-3d44-4c11-9f0d-8a7b6c5d4e3f';
const MIB = 1024 * 1024;
const LIMITS = { cpuCores: 2, memoryBytes: 4096 * MIB, diskBytes: 100 * MIB, requested: { cpu: '2', memory: '4GiB', disk: '100MiB' } };

const limitedSession = (overrides = {}) => ({
  isolationBackend: 'docker',
  sessionId: SESSION,
  executionUuid: UUID,
  command: 'solve',
  tool: 'claude',
  containerResourceLimits: LIMITS,
  containerFilesystemLastBytes: 30 * MIB,
  args: ['https://github.com/link-foundation/meta-language/pull/196', '--auto-restart-until-mergeable'],
  ...overrides,
});
const plan = { command: { args: ['--resume', TOOL_SESSION], display: `solve --resume ${TOOL_SESSION}`, shell: `solve --resume ${TOOL_SESSION}` }, shouldResume: true, attempt: 1, maxAttempts: 1 };

const makeRunner = ({ version = '0.35.0', resume = null, reapply = { success: true, error: null } } = {}) => {
  const calls = { resume: [], reapply: [], launches: [] };
  return {
    calls,
    getStartCommandVersion: async () => version,
    generateSessionId: () => 'fresh-1111-2222-3333-444455556666',
    executeWithIsolation: async (command, args, opts) => {
      calls.launches.push({ command, args, opts });
      return { success: true, executionUuid: 'fresh-uuid', containerFilesystemStartBytes: 0, containerResourceLimits: LIMITS };
    },
    checkDockerContainerExists: async () => true,
    resumeIsolatedSession: async (identifier, options) => {
      calls.resume.push({ identifier, options });
      return resume || { success: true, uuid: UUID, mode: RESUME_MODES.DOCKER_SNAPSHOT, sessionName: `${SESSION}-resume-1`, snapshotImage: `start-command-resume/${SESSION}:1` };
    },
    applyDockerContainerResourceLimits: async (name, requested) => {
      calls.reapply.push({ name, requested });
      return reapply;
    },
  };
};

console.log('\n1. The `$` version gate');
assert(parseStartCommandVersion('start-command version: 0.35.0\n\nOS: linux') === '0.35.0', '`$ --version` output is parsed');
assert(parseStartCommandVersion('garbage') === null, 'an unrecognised `$ --version` output yields no version');
assert(startCommandResumeKeepsResourceLimits('0.35.0') && startCommandResumeKeepsResourceLimits('0.36.1'), '0.35.0 and later keep limits on resume');
assert(!startCommandResumeKeepsResourceLimits('0.34.1') && !startCommandResumeKeepsResourceLimits(null), 'older or unknown versions do not');

console.log('\n2. Which limited sessions may be re-entered');
assert(planSameContainerResume({ sessionName: SESSION, sessionInfo: limitedSession() }).reason === IN_PLACE_SKIP_REASONS.RESOURCE_LIMITS, 'without the gate a limited session still takes the fresh path');
assert(planSameContainerResume({ sessionName: SESSION, sessionInfo: limitedSession(), resumeKeepsResourceLimits: true }).eligible === true, 'with start-command >= 0.35.0 a limited session is eligible');
const unmeasured = planSameContainerResume({ sessionName: SESSION, sessionInfo: limitedSession({ containerFilesystemLastBytes: undefined }), resumeKeepsResourceLimits: true });
assert(unmeasured.eligible === false && unmeasured.reason === IN_PLACE_SKIP_REASONS.DISK_USAGE_UNKNOWN, 'a disk-limited session never measured is not resumed in place (its allowance would silently reset)');
assert(planSameContainerResume({ sessionName: SESSION, sessionInfo: limitedSession({ containerFilesystemLastBytes: undefined, containerResourceLimits: { cpuCores: 2, requested: { cpu: '2' } } }), resumeKeepsResourceLimits: true }).eligible === true, 'a CPU-only limited session needs no disk measurement');
assert(getCarriedContainerDiskUsage(limitedSession({ containerFilesystemInheritedBytes: 10 * MIB })) === 40 * MIB, 'carried usage = earlier containers + the current container');

console.log('\n3. The resume itself');
const runner = makeRunner();
const inPlace = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: limitedSession(), plan, runner });
assert(inPlace.resumed === true && inPlace.executionUuid === UUID, 'the limited session is resumed in place under the same execution UUID');
assert(runner.calls.reapply.length === 1 && runner.calls.reapply[0].name === `${SESSION}-resume-1`, 'CPU/RAM limits are re-asserted on the snapshot-derived container');
assert(runner.calls.reapply[0].requested.memory === '4GiB', 'the originally requested limits are the ones re-asserted');
assert(inPlace.containerFilesystemInheritedBytes === 30 * MIB, 'the writable-layer usage so far is carried into the resumed session');

const old = makeRunner({ version: '0.34.1' });
const oldResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: limitedSession(), plan, runner: old });
assert(oldResult.resumed === false && oldResult.reason === IN_PLACE_SKIP_REASONS.RESOURCE_LIMITS && old.calls.resume.length === 0, 'on start-command 0.34.x the limited session is not resumed in place');

const failedReapply = makeRunner({ reapply: { success: false, error: 'No such container' } });
const originalWarn = console.warn;
const warnings = [];
console.warn = (...args) => warnings.push(args.join(' '));
let failedResult;
try {
  failedResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: limitedSession(), plan, runner: failedReapply });
} finally {
  console.warn = originalWarn;
}
assert(failedResult.resumed === true && failedResult.resourceLimitReapplyError === 'No such container', 'a failed re-assert is reported on the result');
assert(
  warnings.some(line => line.includes('Could not re-assert CPU/RAM limits')),
  'a failed re-assert is logged as a warning'
);

const started = makeRunner({ resume: { success: true, uuid: UUID, mode: RESUME_MODES.DOCKER_START, sessionName: SESSION } });
const startedResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: limitedSession(), plan, runner: started });
assert(startedResult.resumed === true && started.calls.reapply.length === 0, 'a `docker start` of the same container keeps its own HostConfig; nothing to re-assert');
assert(startedResult.containerFilesystemInheritedBytes === null, 'and nothing is carried: the writable layer is the same one');

const relaunched = makeRunner({ resume: { success: true, uuid: UUID, mode: RESUME_MODES.RELAUNCH, sessionName: SESSION } });
const relaunchResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: limitedSession(), plan, runner: relaunched });
assert(relaunched.calls.reapply[0]?.name === SESSION, 'a relaunch (container vanished meanwhile) has no HostConfig to copy, so limits are re-asserted on it');
assert(relaunchResult.containerFilesystemInheritedBytes === null, 'a relaunch starts from the image, so no usage is carried');

console.log('\n4. The tracked recovery session and disk enforcement');
const tracked = [];
const recovered = await recoverKilledSession({
  sessionName: SESSION,
  sessionInfo: limitedSession({ containerFilesystemInheritedBytes: 10 * MIB, containerFilesystemLastObservedAt: '2026-10-02T16:55:00.000Z' }),
  killed: true,
  env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
  readLastSessionId: () => TOOL_SESSION,
  runner: makeRunner(),
  trackSession: (name, info) => tracked.push({ name, info }),
});
assert(recovered.resumed === true && recovered.inPlace === true, 'recoverKilledSession() resumes the limited session in place');
const info = tracked[0]?.info || {};
assert(info.executionUuid === UUID && info.containerResourceLimits?.diskBytes === LIMITS.diskBytes, 'the recovery keeps the UUID and the resolved limits');
assert(info.containerFilesystemInheritedBytes === 40 * MIB, 'the recovery session inherits every byte written so far');
assert(info.containerFilesystemLastBytes === undefined && info.containerFilesystemLastObservedAt === undefined, "the old container's measurement is not mistaken for the new one's");

const killed = [];
const within = await enforceContainerDiskLimitForSession(SESSION, { ...info }, 50 * MIB, {
  killContainer: async name => {
    killed.push(name);
    return { success: true };
  },
});
assert(within === null && killed.length === 0, 'usage within the carried allowance is left alone (40 + 50 ≤ 100 MiB)');
const breachInfo = { ...info, sessionId: `${SESSION}-resume-1` };
const breach = await enforceContainerDiskLimitForSession(SESSION, breachInfo, 70 * MIB, {
  killContainer: async name => {
    killed.push(name);
    return { success: true };
  },
});
assert(breach?.observedBytes === 110 * MIB && killed[0] === `${SESSION}-resume-1`, 'the carried usage counts: 40 + 70 > 100 MiB stops the resumed container');

const freshTracked = [];
await recoverKilledSession({
  sessionName: SESSION,
  sessionInfo: limitedSession({ containerFilesystemInheritedBytes: 10 * MIB }),
  killed: true,
  env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
  readLastSessionId: () => TOOL_SESSION,
  runner: makeRunner({ version: '0.34.1' }),
  trackSession: (name, freshInfo) => freshTracked.push(freshInfo),
});
assert(freshTracked[0]?.containerFilesystemInheritedBytes === undefined, 'a fresh launch starts a new container with a new, uncarried allowance');

printSummary(78);
process.exit(getFailCount() > 0 ? 1 : 0);
