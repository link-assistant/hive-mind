#!/usr/bin/env node
// Regression test for issue #3190: `--auto-merge` (and `--think high`,
// `--language en`, `--disable-report-issue`, `--no-tool-check`, ...) were
// silently dropped when solve relaunched itself after a usage-limit reset.
//
// The auto-resume relaunch rebuilt its argv from a hand-written allowlist
// (--tool/--model/--fallback-model/--verbose/--fork/--attach-logs), so the
// resumed session ran with thinking OFF and never auto-merged the PR. The fix
// replays every original option through one definition-driven mechanism
// (src/cli-option-forwarding.lib.mjs + src/solve.forwarded-args.lib.mjs).
//
// See: https://github.com/link-assistant/hive-mind/issues/3190

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOptionTokenIndex, partitionRawCliArgs, forwardRawCliArgs, buildArgsFromParsedArgv, kebabToCamel } from '../src/cli-option-forwarding.lib.mjs';
import { getManualResumeSolveCliArgs, getPreservedSolveCliArgs, SOLVE_CLI_OPTION_DEFINITIONS, SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS, SOLVE_MANUAL_RESUME_CONTROLLED_OPTIONS, SOLVE_RELAUNCH_STATE_OPTIONS } from '../src/solve.forwarded-args.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS, parseArguments } from '../src/solve.config.lib.mjs';
import { getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { buildSolveResumeCommand } from '../src/solve.resume-command.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'src');

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.message}`);
    failed++;
  }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const assertEqual = (actual, expected, message) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message}\n   expected: ${e}\n   actual:   ${a}`);
};

// `--worker-model` is also a yargs alias of `--model`, so it resolves to `model`.
const TOKEN_INDEX = buildOptionTokenIndex(SOLVE_CLI_OPTION_DEFINITIONS);
const canonicalName = name => TOKEN_INDEX.get(`--${name}`).name;
const ISSUE_URL = 'https://github.com/link-foundation/browser-commander/issues/176';
// Exact solve argv of the incident (docs/case-studies/issue-3190/telegram-bot.log.txt).
const INCIDENT_ARGS = ['https://github.com/link-foundation/browser-commander', '--think', 'high', '--auto-merge', '--tool', 'claude', '--attach-logs', '--verbose', '--no-tool-check', '--disable-report-issue', '--language', 'en'];

/**
 * Mirror of what solve.auto-continue.lib.mjs spawns: the state options it sets
 * itself followed by the preserved original options.
 */
const buildRelaunchArgs = (rawArgs, { model = 'opus', iteration = 1 } = {}) => [ISSUE_URL, '--resume', 'session-1', '--auto-continue', '--auto-resume-on-limit-reset', '--auto-resume-iteration', String(iteration), '--auto-resume-max-iterations', '5', '--session-type', 'auto-resume', '--model', model, '--verbose', '--attach-logs', '--working-directory', '/tmp/gh-issue-solver-1', ...getPreservedSolveCliArgs({ rawArgs })];

const parseSolve = async args => {
  const savedExit = process.exit;
  process.exit = code => {
    throw new Error(`solve parseArguments called process.exit(${code}) for: ${args.join(' ')}`);
  };
  try {
    return await parseArguments(undefined, () => args);
  } finally {
    process.exit = savedExit;
  }
};

// ---------------------------------------------------------------------------
// 1. The incident: options the relaunch used to drop.
// ---------------------------------------------------------------------------
await test('incident: relaunch keeps --think high, --auto-merge, --no-tool-check, --disable-report-issue, --language en', () => {
  const preserved = getPreservedSolveCliArgs({ rawArgs: INCIDENT_ARGS });
  assertEqual(preserved, ['--think', 'high', '--auto-merge', '--no-tool-check', '--disable-report-issue', '--language', 'en'], 'preserved options');
});

await test('incident: relaunch re-parses to the same think/autoMerge/toolCheck/disableReportIssue/language', async () => {
  const relaunched = await parseSolve(buildRelaunchArgs(INCIDENT_ARGS));
  assertEqual(relaunched.think, 'high', '--think');
  assertEqual(relaunched.autoMerge, true, '--auto-merge');
  assertEqual(relaunched.toolCheck, false, '--no-tool-check');
  assertEqual(relaunched.disableReportIssue, true, '--disable-report-issue');
  assertEqual(relaunched.language, 'en', '--language');
  assert(relaunched.thinkingBudget !== 0, `--think high must not degrade to --thinking-budget 0 (got ${relaunched.thinkingBudget})`);
});

await test('incident: every original option survives a chain of relaunches with identical parsed values', async () => {
  const original = await parseSolve([ISSUE_URL, ...INCIDENT_ARGS.slice(1)]);
  let args = buildRelaunchArgs(INCIDENT_ARGS, { iteration: 1 });
  // The second hop replays the FIRST relaunch's argv — state options must not pile up.
  args = buildRelaunchArgs(args, { iteration: 2 });
  for (const option of ['resume', 'auto-resume-iteration', 'session-type', 'working-directory', 'model']) {
    assertEqual(args.filter(token => token === `--${option}`).length, 1, `--${option} occurrences after two hops`);
  }
  const relaunched = await parseSolve(args);
  const ignored = new Set(SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS);
  for (const name of Object.keys(SOLVE_OPTION_DEFINITIONS)) {
    if (ignored.has(canonicalName(name))) continue;
    const key = kebabToCamel(name);
    assertEqual(relaunched[key], original[key], `parsed --${name} after relaunch`);
  }
});

// ---------------------------------------------------------------------------
// 2. Caller-controlled options are removed in EVERY spelling, with their value.
// ---------------------------------------------------------------------------
await test('state/controlled options are excluded in every spelling (aliases, camelCase, =value, --no-*)', () => {
  const raw = [ISSUE_URL, '--resume=abc', '-r', 'def', '--workingDirectory', '/tmp/x', '-d', '/tmp/y', '--session-type', 'resume', '--auto-resume-iteration', '3', '--previous-anthropic-cost', '1.5', '--no-auto-continue', '--autoResumeOnLimitReset', '-m', 'opus', '--worker-model=sonnet', '--model', 'haiku', '--fallback-model', 'opus', '--tool=codex', '-v', '--fork', '--attach-logs', 'true', '--auto-merge'];
  assertEqual(getPreservedSolveCliArgs({ rawArgs: raw }), ['--auto-merge'], 'only --auto-merge must survive');
});

await test('manual resume keeps --verbose/--fork/--attach-logs/--auto-continue but drops state options', () => {
  const raw = [ISSUE_URL, '--resume', 'abc', '--verbose', '--fork', '--attach-logs', '--no-auto-continue', '--model', 'opus', '--auto-merge'];
  assertEqual(getManualResumeSolveCliArgs(raw), ['--verbose', '--fork', '--attach-logs', '--no-auto-continue', '--auto-merge'], 'manual resume options');
});

await test('positionals are dropped, unknown options are kept verbatim, `--` ends option parsing', () => {
  const definitions = { think: { type: 'string' }, 'auto-merge': { type: 'boolean' }, prefix: { type: 'array' } };
  const { positionals, options } = partitionRawCliArgs(['url', '--think', 'high', '--mystery', '--prefix', 'a', 'b', '--auto-merge', 'false', '--', '--think', 'low'], definitions);
  assertEqual(positionals, ['url', '--think', 'low'], 'positionals');
  assertEqual(
    options.map(group => group.tokens),
    [['--think', 'high'], ['--mystery'], ['--prefix', 'a', 'b'], ['--auto-merge', 'false']],
    'option groups'
  );
  assertEqual(forwardRawCliArgs({ rawArgs: ['url', '--mystery', '--think=low'], definitions, exclude: ['think'] }), ['--mystery'], 'forwarded');
});

// ---------------------------------------------------------------------------
// 3. Universality: every solve option is recognized and forwarded, so a new
//    option can never be silently dropped again.
// ---------------------------------------------------------------------------
await test('every solve option (all spellings) is forwarded unless it is caller-controlled', () => {
  const excluded = new Set(SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS);
  const sample = def => (def.type === 'number' ? '7' : 'sample-value');
  for (const [name, def] of Object.entries(SOLVE_CLI_OPTION_DEFINITIONS)) {
    const tokens = def.type === 'boolean' ? [`--${name}`] : [`--${name}`, sample(def)];
    const preserved = getPreservedSolveCliArgs({ rawArgs: [ISSUE_URL, ...tokens] });
    assertEqual(preserved, excluded.has(canonicalName(name)) ? [] : tokens, `--${name}`);
  }
});

await test('state options are a subset of both exclusion lists and exist in solve definitions', () => {
  for (const name of SOLVE_RELAUNCH_STATE_OPTIONS) {
    assert(SOLVE_CLI_OPTION_DEFINITIONS[name], `${name} is not a solve option`);
    assert(SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS.includes(name), `${name} missing from auto-relaunch exclusions`);
    assert(SOLVE_MANUAL_RESUME_CONTROLLED_OPTIONS.includes(name), `${name} missing from manual-resume exclusions`);
  }
  for (const name of [...SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS, ...SOLVE_MANUAL_RESUME_CONTROLLED_OPTIONS]) {
    assert(SOLVE_CLI_OPTION_DEFINITIONS[name], `${name} is not a solve option`);
  }
});

// ---------------------------------------------------------------------------
// 4. The printed manual-resume command carries the same options.
// ---------------------------------------------------------------------------
await test('buildSolveResumeCommand appends preserved options, quoting only when needed', () => {
  const cmd = buildSolveResumeCommand({ issueUrl: ISSUE_URL, sessionId: 'abc', tempDir: '/tmp/x', extraArgs: ['--auto-merge', '--think', 'high', '--prompt-suffix', 'say "hi" $HOME'], nodePath: 'node', scriptPath: '/bin/solve' });
  assert(cmd.endsWith('--working-directory "/tmp/x" --auto-merge --think high --prompt-suffix "say \\"hi\\" \\$HOME"'), `unexpected command: ${cmd}`);
});

await test('buildSolveResumeCommand without extraArgs is unchanged', () => {
  const cmd = buildSolveResumeCommand({ issueUrl: ISSUE_URL, sessionId: 'abc', nodePath: 'node', scriptPath: '/bin/solve' });
  assertEqual(cmd, `"node" "/bin/solve" "${ISSUE_URL}" --resume "abc"`, 'command');
});

// ---------------------------------------------------------------------------
// 5. hive → solve uses the same shared serializer, without internal state.
// ---------------------------------------------------------------------------
await test('hive does not register or forward the internal --previous-anthropic-cost', () => {
  assert(!getSolvePassthroughOptionNames().includes('previous-anthropic-cost'), 'previous-anthropic-cost must be solve-only');
  const args = buildArgsFromParsedArgv({ argv: { previousAnthropicCost: 0, autoMerge: true, think: 'high' }, definitions: SOLVE_OPTION_DEFINITIONS, optionNames: getSolvePassthroughOptionNames() });
  assert(!args.includes('--previous-anthropic-cost'), `forwarded: ${args.join(' ')}`);
  assert(args.includes('--auto-merge'), 'hive must forward --auto-merge');
  assertEqual(args.slice(args.indexOf('--think'), args.indexOf('--think') + 2), ['--think', 'high'], 'hive must forward --think high');
});

// ---------------------------------------------------------------------------
// 6. Wiring: every relaunch / resume-command site uses the shared mechanism.
// ---------------------------------------------------------------------------
await test('auto-resume relaunch replays preserved options and no longer drops --model sonnet', () => {
  const source = fs.readFileSync(path.join(SRC, 'solve.auto-continue.lib.mjs'), 'utf8');
  assert(/resumeArgs\.push\(\.\.\.preservedArgs\)/.test(source), 'solve.auto-continue.lib.mjs must push the preserved original options');
  assert(/getPreservedSolveCliArgs\(\{ exclude: SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS \}\)/.test(source), 'solve.auto-continue.lib.mjs must exclude SOLVE_AUTO_RELAUNCH_CONTROLLED_OPTIONS');
  assert(!/argv\.model !== 'sonnet'/.test(source), 'solve.auto-continue.lib.mjs must not drop an explicit --model sonnet');
  assert(/argv\._fallbackModelExplicit\) resumeArgs\.push\('--fallback-model'/.test(source), 'an implicit fallback model must not become an explicit pin (issue #2037)');
});

await test('every buildSolveResumeCommand call passes the preserved options', () => {
  for (const file of ['solve.mjs', 'gemini.lib.mjs']) {
    const source = fs.readFileSync(path.join(SRC, file), 'utf8');
    const calls = source.match(/buildSolveResumeCommand\(\{[^}]*\}\)/g) || [];
    assert(calls.length > 0, `${file}: no buildSolveResumeCommand calls found`);
    for (const call of calls) assert(call.includes('extraArgs: argv._solveResumeExtraArgs'), `${file}: ${call}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
