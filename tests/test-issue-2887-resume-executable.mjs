#!/usr/bin/env node

/**
 * Issue #2887: kill recovery ran the Telegram alias as the program.
 *
 * A task started with `/codex` was OOM-killed. The in-place recovery handed
 * `$ --resume <uuid> -- /codex <url> … --resume <id>` to start-command, which
 * runs it through `sh -c`; after a 10–35 minute `docker commit` the resumed
 * container printed `sh: 1: /codex: not found` and exited 127. The work then
 * stopped: an ordinary exit 127 is not a kill, so nothing recovered it.
 *
 * Locked in here:
 *
 *   1. `buildResumeCommand` keeps two spellings apart: `display` (the Telegram
 *      alias, issue #2109) and `binary`/`args`/`shell` (what is executed). The
 *      executable form never starts with `/`, for every alias.
 *   2. `shell` survives a real `sh -c` byte for byte, including `$`, quotes,
 *      backticks and spaces.
 *   3. The in-place resume hands `$ --resume` the shell form, and refuses —
 *      before snapshotting — a plan that has no runnable form.
 *   4. The pull-request "To continue manually" `bash` block gets the shell form.
 *   5. Exit 126/127 is described as "command not executable"/"command not
 *      found", is never classified as a kill, and a sticky container
 *      `oomKilled` flag cannot turn it into `oom-killed`.
 *   6. An in-place recovery that exits 126/127 is followed by a fresh-launch
 *      recovery (not dropped), without spending another attempt, and a fresh
 *      recovery that exits 127 is not retried again (no loop).
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2887
 * @see https://github.com/link-assistant/hive-mind/issues/2630
 * @see https://github.com/link-assistant/hive-mind/issues/2109
 */

import { execFileSync } from 'node:child_process';
import { buildResumeCommand, isRunnableShellCommand, shellQuoteArg, formatResumeSection } from '../src/session-resume.lib.mjs';
import { resumeKilledSessionInPlace, IN_PLACE_SKIP_REASONS } from '../src/session-kill-resume.in-place.lib.mjs';
import { recoverKilledSession, detectFailedRecoveryStart, KILL_RESUME_ATTEMPTS_FIELD } from '../src/session-kill-resume.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { describeCommandStartFailure, classifyExitStatus } from '../src/session-status.lib.mjs';
import { classifySessionOutcome, formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { resolveOomKilledState } from '../src/session-monitor.oom.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2887: kill recovery runs the real command, not the Telegram alias');
console.log('='.repeat(78));

// Identifiers from the incident report.
const SESSION = 'eec34a2b-a1f9-4380-bdc1-3ea1e0bdd33c';
const UUID = 'b7c3a0b5-79b5-4b52-9a0a-b4c9e1c1d001';
const TOOL_SESSION = '01a1200a-276e-76b2-9674-c219f0f54121';
const URL = 'https://github.com/link-assistant/router/issues/728';
const ENV = { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' };

const codexSession = (overrides = {}) => ({
  isolationBackend: 'docker',
  sessionId: SESSION,
  executionUuid: UUID,
  command: 'solve',
  commandAlias: 'codex',
  tool: 'codex',
  url: URL,
  containerResourceLimits: null,
  args: [URL, '--tool', 'codex', '--think', 'xhigh', '--language', 'en'],
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. Two spellings, kept apart
// ---------------------------------------------------------------------------
console.log('\n1. buildResumeCommand: display is for people, shell/binary are for sh');

for (const alias of ['codex', 'claude', 'solve', 'agent', 'opencode', null]) {
  const command = buildResumeCommand({ sessionInfo: codexSession({ commandAlias: alias }), lastSessionId: TOOL_SESSION });
  const label = alias ? `/${alias}` : 'no alias';
  assert(command.binary === 'solve', `${label}: the executed binary is the real command, \`solve\``);
  assert(!command.binary.startsWith('/') && !command.shell.startsWith('/'), `${label}: the executable form never starts with "/"`);
  assert(isRunnableShellCommand(command.shell), `${label}: the shell form is runnable`);
  assert(command.shell.startsWith(`solve ${URL} `) && command.shell.endsWith(`--resume ${TOOL_SESSION}`), `${label}: the shell form is \`solve <url> … --resume <id>\``);
  assert(command.display.startsWith(alias ? `/${alias} ${URL}` : `solve ${URL}`), `${label}: display keeps the Telegram spelling (issue #2109)`);
}
const codex = buildResumeCommand({ sessionInfo: codexSession(), lastSessionId: TOOL_SESSION });
assert(!isRunnableShellCommand(codex.display), 'the Telegram display form (`/codex …`) is recognised as not runnable');
assert(isRunnableShellCommand('/usr/local/bin/solve url'), 'a real absolute path is still runnable');
assert(!isRunnableShellCommand('') && !isRunnableShellCommand(null), 'an empty command is not runnable');
assert(codex.args.includes('--tool') && codex.args[codex.args.indexOf('--tool') + 1] === 'codex', 'dropping the alias loses nothing: the persisted `--tool codex` is kept');
assert(formatResumeSection({ lastSessionId: TOOL_SESSION, command: codex }).includes(`/codex ${URL}`), 'the Telegram resume section still offers the pasteable `/codex …` form');

// ---------------------------------------------------------------------------
// 2. The shell form is safe for sh -c
// ---------------------------------------------------------------------------
console.log('\n2. shell quoting round-trips through a real `sh -c`');

const nasty = ["it's", '$HOME', '`id`', 'a b', '"q"', 'back\\slash', '', '--x=$(y)'];
assert(shellQuoteArg('') === "''", 'an empty argument is kept as an explicit empty word');
assert(shellQuoteArg(URL) === URL, 'safe tokens stay unquoted and readable');
const tricky = buildResumeCommand({ sessionInfo: codexSession({ args: [URL, '--prompt', ...nasty] }), lastSessionId: TOOL_SESSION });
// A `solve` shell function stands in for the binary, so the exact string `$`
// would hand to `sh -c` is what gets parsed.
const argvPrinter = 'solve() { for a in "$@"; do printf \'%s\\0\' "$a"; done; }; ';
const echoed = execFileSync('sh', ['-c', argvPrinter + tricky.shell], { encoding: 'utf8' })
  .split('\0')
  .slice(0, -1);
assert(JSON.stringify(echoed) === JSON.stringify(tricky.args), 'sh receives exactly the persisted argv — no expansion, no word splitting');

// ---------------------------------------------------------------------------
// 3. The in-place resume runs the shell form
// ---------------------------------------------------------------------------
console.log('\n3. In-place resume hands `$ --resume` the runnable command');

const makeRunner = (overrides = {}) => {
  const calls = { resume: [], launches: [] };
  return {
    calls,
    generateSessionId: () => 'fresh-2887-0000-0000-000000000000',
    executeWithIsolation: async (command, args, opts) => {
      calls.launches.push({ command, args, opts });
      return { success: true, executionUuid: 'fresh-uuid', logPath: '/tmp/fresh.log' };
    },
    checkDockerContainerExists: async () => true,
    resumeIsolatedSession: async (identifier, options) => {
      calls.resume.push({ identifier, options });
      return { success: true, unsupported: false, uuid: UUID, mode: RESUME_MODES.DOCKER_SNAPSHOT, backend: 'docker', sessionName: `${SESSION}-resume-1`, error: null };
    },
    ...overrides,
  };
};

const tracked = [];
const runner = makeRunner();
const recovered = await recoverKilledSession({ sessionName: SESSION, sessionInfo: codexSession(), killed: true, env: ENV, readLastSessionId: () => TOOL_SESSION, runner, trackSession: (name, info) => tracked.push({ name, info }) });
const resumedCommand = runner.calls.resume[0]?.options.command || '';
assert(recovered.resumed === true && recovered.inPlace === true, 'the /codex session is resumed in place');
assert(!resumedCommand.startsWith('/'), `the in-place resume command never starts with "/" (got: ${resumedCommand})`);
assert(resumedCommand === codex.shell, 'the in-place resume runs exactly the shell form');
assert(tracked[0]?.info.killRecoveryCommand === codex.shell, 'the tracked recovery records the command it actually executed');
assert(recovered.display === codex.display, 'the recovery result still carries the display form for Telegram');

const noShellRunner = makeRunner();
const noShell = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: codexSession(), plan: { command: { args: codex.args, display: codex.display } }, runner: noShellRunner });
assert(noShell.resumed === false && noShell.reason === IN_PLACE_SKIP_REASONS.NO_RUNNABLE_COMMAND, 'a plan without a shell form is refused, not run as its display text');
assert(noShellRunner.calls.resume.length === 0, 'no `docker commit` is spent on a command that cannot run');
const aliasShell = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: codexSession(), plan: { command: { args: codex.args, display: codex.display, shell: codex.display } }, runner: makeRunner() });
assert(aliasShell.reason === IN_PLACE_SKIP_REASONS.NO_RUNNABLE_COMMAND, 'a shell form that is really the Telegram alias is refused too');

// ---------------------------------------------------------------------------
// 4. The pull-request notice
// ---------------------------------------------------------------------------
console.log('\n4. "To continue manually" shows a command a shell can run');

const notice = buildKillRecoveryNotice({ exitCode: 137, sessionName: SESSION, resumeCommand: codex });
assert(notice.includes(`\`\`\`bash\n${codex.shell}\n\`\`\``), 'the bash block holds the shell form');
assert(!notice.includes('/codex '), 'the bash block does not offer `/codex …` to a shell');

// ---------------------------------------------------------------------------
// 5. Exit 126/127 is "the command never started", never a kill
// ---------------------------------------------------------------------------
console.log('\n5. Exit 127 is classified from its own exit');

assert(describeCommandStartFailure(127)?.description === 'command not found', '127 → command not found');
assert(describeCommandStartFailure('126')?.description === 'command not executable', '126 → command not executable');
assert(describeCommandStartFailure(137) === null && describeCommandStartFailure(1) === null && describeCommandStartFailure(null) === null, 'other exits are not start failures');
assert(classifyExitStatus(127) === 'failed', '127 is an ordinary failure');
const outcome127 = classifySessionOutcome({ exitCode: 127, status: 'failed' });
assert(outcome127.failed === true && outcome127.killed === false, '127 is failed, not killed');
const message127 = formatSessionCompletionMessage({ sessionName: `${SESSION}-resume-1`, sessionInfo: codexSession(), exitCode: 127, statusResult: { status: 'failed', exitCode: 127 } });
assert(message127.includes('exit code: 127') && message127.includes('command not found'), 'the completion message names the cause of exit 127');
assert(!/oom|out of memory|killed/i.test(message127), 'exit 127 is never reported as an OOM kill');

const sticky = await resolveOomKilledState(`${SESSION}-resume-1`, codexSession({ killRecoveryResumed: true, killRecoveryInPlace: true }), { exists: true, status: 'failed', exitCode: 127, oomKilled: true }, { exitFromLog: () => null, backendAlive: async () => false });
assert(sticky.status === 'failed' && sticky.exitCode === 127, 'a sticky container `oomKilled` flag cannot turn the resumed exit 127 into `oom-killed`');

// ---------------------------------------------------------------------------
// 6. A recovery that could not start is followed by another recovery
// ---------------------------------------------------------------------------
console.log('\n6. A failed in-place start keeps the work recovering');

const resumed1 = { ...tracked[0].info };
const failure = detectFailedRecoveryStart({ sessionInfo: resumed1, exitCode: 127 });
assert(failure?.reason === 'command-not-found' && failure.recoveredSession === SESSION, 'an in-place recovery that exited 127 is detected as a failed start of the recovery of the killed session');
assert(detectFailedRecoveryStart({ sessionInfo: resumed1, exitCode: 1 }) === null, 'an ordinary failure after the command ran is not a failed start');
assert(detectFailedRecoveryStart({ sessionInfo: codexSession(), exitCode: 127 }) === null, 'an original (non-recovery) session that exits 127 is not restarted');
assert(detectFailedRecoveryStart({ sessionInfo: { ...resumed1, stopRequestedByUser: true }, exitCode: 127 }) === null, 'a /stop still wins');

const retryTracked = [];
const retryRunner = makeRunner();
const retry = await recoverKilledSession({ sessionName: `${SESSION}-resume-1`, sessionInfo: resumed1, killed: true, env: ENV, readLastSessionId: () => null, runner: retryRunner, trackSession: (name, info) => retryTracked.push({ name, info }), recoveryStartFailure: failure });
assert(retry.resumed === true && retry.inPlace === false, 'a fresh recovery is started instead of dropping the session');
assert(retryRunner.calls.resume.length === 0, 'the in-place path that just failed is not retried');
assert(retryRunner.calls.launches[0]?.command === 'solve', 'the fresh launch runs the real binary');
const launchedArgs = retryRunner.calls.launches[0]?.args || [];
assert(launchedArgs.filter(a => a === '--resume').length === 1 && launchedArgs[launchedArgs.indexOf('--resume') + 1] === TOOL_SESSION, 'it resumes the same tool session (taken from the failed attempt when the log has none)');
assert(retry.attempt === 1 && retryTracked[0]?.info[KILL_RESUME_ATTEMPTS_FIELD] === 1, 'an attempt that never ran its command does not use up the recovery budget');
assert(retryTracked[0]?.info.killRecoveryStartFailure?.exitCode === 127 && retryTracked[0]?.info.killRecoveryStartFailure?.session === `${SESSION}-resume-1`, 'the durable record says why the previous recovery was replaced');
assert(retryTracked[0]?.info.rootSessionName === SESSION, 'the Telegram message keeps naming the original session');
assert(detectFailedRecoveryStart({ sessionInfo: retryTracked[0].info, exitCode: 127 }) === null, 'a fresh recovery that also exits 127 is reported, not retried — no loop');

printSummary(78);
process.exit(getFailCount() > 0 ? 1 : 0);
