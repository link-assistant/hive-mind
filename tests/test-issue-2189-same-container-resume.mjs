#!/usr/bin/env node

/**
 * Issue #2189, requirement R2 (downstream half): a killed session is recovered
 * *in the container it died in*.
 *
 * The wrapper around `$ --resume` is covered by
 * tests/test-issue-2189-isolation-resume.mjs. What is locked in here is the
 * policy and the wiring around it:
 *
 *   1. A docker session with an execution UUID whose container still exists is
 *      resumed in place — no `executeWithIsolation`, no second clone — and the
 *      recovery session is tracked under the name `$` returns, keeping the
 *      original execution UUID.
 *   2. Formal AI (#2146) and `--use-router` tasks are deliberately excluded:
 *      their internal Docker networks are attached by Hive Mind *after* the
 *      container is created, so a resumed container would come up without them
 *      and the task would fail open. They fall back to a fresh launch.
 *   3. Every other refusal — screen/tmux backend, missing UUID, vanished
 *      container, an older `$` that has no `--resume`, an upstream "still
 *      running" refusal — falls back to the previous behaviour instead of
 *      losing the recovery.
 *   4. The fallback launch no longer inherits the dead session's execution
 *      UUID, which would make `$ --status` answer about the wrong execution.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 * @see https://github.com/link-assistant/hive-mind/issues/2146
 * @see https://github.com/link-foundation/start/issues/162
 */

import { planSameContainerResume, resumeKilledSessionInPlace, IN_PLACE_SKIP_REASONS } from '../src/session-kill-resume.in-place.lib.mjs';
import { recoverKilledSession, KILL_RESUME_ATTEMPTS_FIELD } from '../src/session-kill-resume.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2189: a killed session is resumed in its own container');
console.log('='.repeat(78));

const SESSION = '30920087-c181-47f0-bc75-66a78402d400';
const UUID = 'f0b5c8f2-2f3f-4a0e-9a4f-2b1c7d5e6a90';
const TOOL_SESSION = '9c2a1b7e-3d44-4c11-9f0d-8a7b6c5d4e3f';

/** A killed session that every gate should let through. */
const killedSession = (overrides = {}) => ({
  isolationBackend: 'docker',
  sessionId: SESSION,
  executionUuid: UUID,
  command: 'solve',
  tool: 'claude',
  args: ['https://github.com/link-assistant/hive-mind/issues/2189', '--auto-continue'],
  ...overrides,
});

const plan = { command: { args: ['--resume', TOOL_SESSION], display: `solve --resume ${TOOL_SESSION}` }, shouldResume: true, attempt: 1, maxAttempts: 1 };

// ---------------------------------------------------------------------------
// 1. The pure policy
// ---------------------------------------------------------------------------
console.log('\n1. Which killed sessions may be re-entered');

const eligible = planSameContainerResume({ sessionName: SESSION, sessionInfo: killedSession() });
assert(eligible.eligible === true && eligible.identifier === UUID, 'a plain docker session with an execution UUID is eligible');
assert(eligible.containerName === SESSION, 'the container to inspect is the session id');

assert(planSameContainerResume({ sessionName: SESSION, sessionInfo: killedSession({ isolationBackend: 'screen' }) }).reason === IN_PLACE_SKIP_REASONS.NOT_DOCKER, 'screen sessions have no container to re-enter');
assert(planSameContainerResume({ sessionName: null, sessionInfo: killedSession({ sessionId: null, executionUuid: null }) }).reason === IN_PLACE_SKIP_REASONS.NO_IDENTIFIER, 'a session with nothing to address is skipped');
assert(planSameContainerResume({ sessionName: SESSION, sessionInfo: killedSession({ executionUuid: null }) }).identifier === SESSION, 'the session name addresses the execution when no UUID was recorded');

const formalAi = planSameContainerResume({ sessionName: SESSION, sessionInfo: killedSession({ args: ['url', '--model', 'formal-ai'] }) });
assert(formalAi.eligible === false && formalAi.reason === IN_PLACE_SKIP_REASONS.FORMAL_AI_TASK, 'a Formal AI task is not resumed in place (#2146 requires it to fail closed)');
assert(planSameContainerResume({ sessionName: SESSION, sessionInfo: killedSession({ model: 'formal-ai', args: ['url'] }) }).reason === IN_PLACE_SKIP_REASONS.FORMAL_AI_TASK, 'the Formal AI gate keys off the model, not only the args');
assert(planSameContainerResume({ sessionName: SESSION, sessionInfo: killedSession({ args: ['url', '--use-router'] }) }).reason === IN_PLACE_SKIP_REASONS.ROUTER_TASK, 'a --use-router task is not resumed in place');

// ---------------------------------------------------------------------------
// 2. The attempt itself
// ---------------------------------------------------------------------------
console.log('\n2. Resuming through `$ --resume`');

const makeRunner = (overrides = {}) => {
  const calls = { exists: [], resume: [], launches: [] };
  return {
    calls,
    generateSessionId: () => 'fresh-1111-2222-3333-444455556666',
    executeWithIsolation: async (command, args, opts) => {
      calls.launches.push({ command, args, opts });
      return { success: true, executionUuid: 'fresh-uuid', containerFilesystemStartBytes: 1024 };
    },
    checkDockerContainerExists: async name => {
      calls.exists.push(name);
      return overrides.exists !== false;
    },
    resumeIsolatedSession: async (identifier, options) => {
      calls.resume.push({ identifier, options });
      return overrides.resume || { success: true, unsupported: false, uuid: UUID, mode: RESUME_MODES.DOCKER_SNAPSHOT, backend: 'docker', sessionName: `${SESSION}-resume-1`, previousSessionName: SESSION, snapshotImage: `start-command-resume/${SESSION}:1`, error: null };
    },
    ...(overrides.runner || {}),
  };
};

const runner = makeRunner();
const inPlace = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner });
assert(inPlace.resumed === true && inPlace.reason === 'resumed-in-place', 'a live-but-stopped container is resumed in place');
assert(runner.calls.exists[0] === SESSION, 'the container is inspected before the resume is attempted');
assert(runner.calls.resume[0].identifier === UUID, 'the execution is addressed by its UUID, so `--status` keeps working');
assert(runner.calls.resume[0].options.command === plan.command.display, 'the recovery command is handed to `$ --resume -- <command>`');
assert(inPlace.sessionId === `${SESSION}-resume-1`, 'the session is tracked under the name `$` reports after the snapshot');
assert(inPlace.executionUuid === UUID, 'the execution UUID survives the resume, so one logical session keeps one log');
assert(inPlace.snapshotImage === `start-command-resume/${SESSION}:1`, 'the snapshot image is reported for the operator');

const gone = makeRunner({ exists: false });
const goneResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: gone });
assert(goneResult.resumed === false && goneResult.reason === IN_PLACE_SKIP_REASONS.CONTAINER_GONE, 'a container that was already reaped is not resumed');
assert(gone.calls.resume.length === 0, '`$ --resume` is not called when there is nothing left to re-enter');

const oldStart = makeRunner({ resume: { success: false, unsupported: true, error: 'Error: Unknown wrapper option: --resume' } });
assert((await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: oldStart })).reason === IN_PLACE_SKIP_REASONS.UNSUPPORTED, 'an older `$` without --resume degrades to the fresh-launch path');

const refused = makeRunner({ resume: { success: false, unsupported: false, error: 'Error: Execution is still running' } });
assert((await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: refused })).reason === IN_PLACE_SKIP_REASONS.REFUSED, 'an upstream refusal is distinguished from an unsupported verb');

const noSupport = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: { executeWithIsolation: async () => ({ success: true }), generateSessionId: () => 'x' } });
assert(noSupport.resumed === false && noSupport.reason === IN_PLACE_SKIP_REASONS.NO_RESUME_SUPPORT, 'a runner without the resume wrappers is reported, not thrown');

const relaunched = makeRunner({ resume: { success: true, unsupported: false, uuid: UUID, mode: RESUME_MODES.RELAUNCH, sessionName: SESSION, error: null } });
const relaunchResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: relaunched });
assert(relaunchResult.resumed === true && relaunchResult.sessionId === UUID, 'a resume that reuses the old session name is tracked by UUID so it cannot collide with the dying entry');

// ---------------------------------------------------------------------------
// 3. End to end through recoverKilledSession()
// ---------------------------------------------------------------------------
console.log('\n3. Recovery prefers the container it died in');

const readTool = () => TOOL_SESSION;
const trackedInPlace = [];
const e2eRunner = makeRunner();
const recovered = await recoverKilledSession({
  sessionName: SESSION,
  sessionInfo: killedSession(),
  killed: true,
  env: {},
  readLastSessionId: readTool,
  runner: e2eRunner,
  trackSession: (name, info) => trackedInPlace.push({ name, info }),
});
assert(recovered.resumed === true && recovered.inPlace === true, 'the killed session is recovered in place');
assert(e2eRunner.calls.launches.length === 0, 'no fresh isolated run is started when the container could be re-entered');
assert(recovered.sessionId === `${SESSION}-resume-1`, 'the reported recovery session is the resumed one');
assert(trackedInPlace[0]?.info.executionUuid === UUID, 'the tracked recovery session keeps the original execution UUID');
assert(trackedInPlace[0]?.info.killRecoveryInPlace === true && trackedInPlace[0]?.info.killRecoveryResumeMode === RESUME_MODES.DOCKER_SNAPSHOT, 'the durable record says how the session was recovered');
assert(trackedInPlace[0]?.info[KILL_RESUME_ATTEMPTS_FIELD] === 1 && trackedInPlace[0]?.info.killRecoveryOfSession === SESSION, 'the in-place recovery carries the attempt counter forward like any other');

const trackedFresh = [];
const fallbackRunner = makeRunner({ exists: false });
const fellBack = await recoverKilledSession({
  sessionName: SESSION,
  sessionInfo: killedSession(),
  killed: true,
  env: {},
  readLastSessionId: readTool,
  runner: fallbackRunner,
  trackSession: (name, info) => trackedFresh.push({ name, info }),
});
assert(fellBack.resumed === true && fellBack.inPlace === false && fellBack.reason === 'started', 'a session that cannot be re-entered is still recovered by a fresh run');
assert(fallbackRunner.calls.launches.length === 1, 'the fallback starts exactly one isolated run');
assert(trackedFresh[0]?.info.executionUuid === 'fresh-uuid', 'the fresh recovery session does not inherit the dead execution UUID');
assert(trackedFresh[0]?.info.containerFilesystemStartBytes === 1024, 'the fresh recovery session records its own filesystem baseline');

printSummary(78);
process.exit(getFailCount() > 0 ? 1 : 0);
