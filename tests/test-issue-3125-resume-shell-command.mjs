#!/usr/bin/env node

/**
 * Issue #3125 (and #2887): the in-place resume of an OOM-killed `/claude`
 * session ran `sh: 1: /claude: not found` and exited 127.
 *
 * `buildResumeCommand()` keeps the Telegram spelling (`/claude …`) in
 * `display`, so a person can paste it back into the chat. The in-place resume
 * handed that same string to `$ --resume <id> -- <command>`, which runs it with
 * `sh -c` inside the snapshot container, where no `/claude` binary exists.
 *
 * The fix adds a `shell` form that names the real CLI (`solve`) and uses POSIX
 * single quotes, and the in-place resume runs that. This test checks:
 *
 *   1. `shell` names `solve`, not the alias, and `display` is unchanged.
 *   2. Running `display` with `sh -c` reproduces exit 127. Running `shell`
 *      reaches a stub `solve` with every argument unchanged, including `$`,
 *      quotes and spaces.
 *   3. `resumeKilledSessionInPlace()` passes `shell` to `$ --resume`.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3125
 * @see https://github.com/link-assistant/hive-mind/issues/2887
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildResumeCommand, planKilledSessionResume } from '../src/session-resume.lib.mjs';
import { resumeKilledSessionInPlace } from '../src/session-kill-resume.in-place.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #3125: in-place resume runs the real CLI, not the Telegram alias');
console.log('='.repeat(78));

const SESSION = 'a200bdc6-0f93-4ba8-b583-12ca64f28bc9';
const UUID = '6931575d-380b-481f-acb4-2095e05ba8c6';
const TOOL_SESSION = '8d7d799b-d7e6-400e-9b68-6210c0e7c813';
const URL = 'https://github.com/link-foundation/links-notation/issues/340';

// The session the incident recorded: launched from Telegram as `/claude`.
const sessionInfo = {
  isolationBackend: 'docker',
  sessionId: SESSION,
  executionUuid: UUID,
  command: 'solve',
  commandAlias: 'claude',
  tool: 'claude',
  containerResourceLimits: null,
  args: [URL, '--think', 'high', '--tool', 'claude', '--attach-logs', '--verbose'],
};

// ---------------------------------------------------------------------------
console.log('\n1. Display form and shell form');

const command = buildResumeCommand({ sessionInfo, lastSessionId: TOOL_SESSION });
assert(command.display.startsWith('/claude '), 'display keeps the Telegram alias so it can be pasted into the chat');
assert(command.shell?.startsWith('solve ') === true, 'shell names the real CLI that exists in the container');
assert(command.shell?.endsWith(`--resume ${TOOL_SESSION}`) === true, 'shell resumes the last tool session');
assert(command.shell?.includes('/claude') === false, 'shell never contains the alias');

const plain = buildResumeCommand({ sessionInfo: { ...sessionInfo, commandAlias: null }, lastSessionId: TOOL_SESSION });
assert(plain.shell === plain.display, 'without an alias, shell and display are the same for plain arguments');

const custom = buildResumeCommand({ sessionInfo, lastSessionId: TOOL_SESSION, binary: '/usr/local/bin/solve' });
assert(custom.shell?.startsWith('/usr/local/bin/solve ') === true, 'an explicit binary override is used by the shell form too');

// ---------------------------------------------------------------------------
console.log('\n2. What `sh -c` does with each form');

const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-3125-'));
try {
  const argsFile = path.join(stubDir, 'args.json');
  fs.writeFileSync(path.join(stubDir, 'solve'), `#!/usr/bin/env node\nrequire('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${stubDir}${path.delimiter}${process.env.PATH}` };

  const before = spawnSync('sh', ['-c', command.display], { env, encoding: 'utf8' });
  assert(before.status === 127 && /\/claude: not found/.test(before.stderr), `running display reproduces the incident: exit ${before.status}, ${before.stderr.trim()}`);

  // Before the fix the in-place resume ran `display`; fall back to it so the
  // failure shows up as the incident's exit code rather than a TypeError.
  const after = spawnSync('sh', ['-c', command.shell ?? command.display], { env, encoding: 'utf8' });
  assert(after.status === 0, `running shell reaches the solve CLI (exit ${after.status})`);
  const received = fs.existsSync(argsFile) ? JSON.parse(fs.readFileSync(argsFile, 'utf8')) : null;
  assert(JSON.stringify(received) === JSON.stringify(command.args), 'solve receives every argument unchanged');

  const tricky = buildResumeCommand({ sessionInfo: { ...sessionInfo, args: [URL, '--prompt', `it's $HOME and "quoted" \`x\``] }, lastSessionId: TOOL_SESSION });
  fs.rmSync(argsFile, { force: true });
  spawnSync('sh', ['-c', tricky.shell ?? tricky.display], { env, encoding: 'utf8' });
  const trickyReceived = fs.existsSync(argsFile) ? JSON.parse(fs.readFileSync(argsFile, 'utf8')) : [];
  assert(trickyReceived[2] === `it's $HOME and "quoted" \`x\``, 'quotes, $ and backticks are not expanded by sh');
} finally {
  fs.rmSync(stubDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('\n3. The in-place resume passes the shell form to `$ --resume`');

const plan = planKilledSessionResume({ sessionInfo, lastSessionId: TOOL_SESSION, attempts: 0, maxAttempts: 3 });
const calls = [];
const runner = {
  checkDockerContainerExists: async () => true,
  resumeIsolatedSession: async (identifier, options) => {
    calls.push({ identifier, options });
    return { success: true, unsupported: false, uuid: UUID, mode: RESUME_MODES.DOCKER_SNAPSHOT, backend: 'docker', sessionName: `${SESSION}-resume-1`, previousSessionName: SESSION, snapshotImage: null, error: null };
  },
};
const result = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo, plan, runner });
assert(result.resumed === true, 'the session is resumed in place');
assert(calls[0]?.options.command === command.shell && command.shell !== undefined, `the command given to $ --resume is ${calls[0]?.options.command}`);

printSummary(78);
process.exit(getFailCount() > 0 ? 1 : 0);
