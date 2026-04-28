/**
 * Regression test for issue #1708.
 *
 * --auto-input-until-mergeable is a new experimental flag introduced in
 * stage 1 of issue #1708. In this stage the flag is intentionally inert
 * for the auto-merge loop (the bigger streaming-aware watchUntilMergeable
 * replacement is staged in subsequent PRs — see
 * docs/case-studies/issue-1708/README.md). The only behavior wired up in
 * this PR is composition: enabling --auto-input-until-mergeable also
 * enables --bidirectional-interactive-mode for --tool claude, which in
 * turn cascades into the three existing experimental sub-flags from
 * issue #817.
 *
 * This test asserts:
 *   1. The flag exists in the yargs config with default `false`.
 *   2. validateBidirectionalModeConfig auto-enables
 *      --bidirectional-interactive-mode + the three sub-flags when only
 *      --auto-input-until-mergeable is passed (claude tool).
 *   3. For non-Claude tools, the streaming pipe is disabled exactly the
 *      same way --bidirectional-interactive-mode is disabled today —
 *      i.e. the flag composes cleanly with the existing tool-support
 *      validator and does not introduce a new failure mode.
 *   4. The flag does NOT change any default that watchUntilMergeable
 *      reads (autoRestartUntilMergeable still defaults to true,
 *      autoMerge still defaults to false).
 *
 * Together these assertions form the safety contract called out in R4
 * of the issue: "should not break any existing features".
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/1708
 * @see https://github.com/link-assistant/hive-mind/issues/817
 */

import { SOLVE_OPTION_DEFINITIONS as yargsOptions } from '../src/solve.config.lib.mjs';
import { validateBidirectionalModeConfig } from '../src/bidirectional-interactive.lib.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (actual === expected) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     expected: ${JSON.stringify(expected)}`);
    console.log(`     actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}
function assertTrue(actual, label) {
  assertEqual(!!actual, true, label);
}
function assertFalse(actual, label) {
  assertEqual(!!actual, false, label);
}

console.log('\n--- yargsOptions registers --auto-input-until-mergeable ---');

const opt = yargsOptions['auto-input-until-mergeable'];
assertTrue(!!opt, 'flag is present in yargsOptions');
assertEqual(opt?.type, 'boolean', 'flag is boolean (no value required)');
assertEqual(opt?.default, false, 'flag defaults to false (opt-in only — R4)');
assertTrue(typeof opt?.description === 'string' && opt.description.length > 0, 'flag has a description for --help');
assertTrue(opt?.description?.includes('[EXPERIMENTAL]'), 'description marks the flag as experimental');

console.log('\n--- defaults for the existing auto-merge loop are unchanged ---');

const autoRestartOpt = yargsOptions['auto-restart-until-mergeable'];
assertEqual(autoRestartOpt?.default, true, 'auto-restart-until-mergeable still defaults to true');
const autoMergeOpt = yargsOptions['auto-merge'];
assertEqual(autoMergeOpt?.default, false, 'auto-merge still defaults to false');

console.log('\n--- validateBidirectionalModeConfig: --auto-input-until-mergeable on claude composes ---');

const noLog = async () => {};

const claudeArgv = {
  autoInputUntilMergeable: true,
  tool: 'claude',
  bidirectionalInteractiveMode: false,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
};
const claudeResult = await validateBidirectionalModeConfig(claudeArgv, noLog);
assertEqual(claudeResult, true, 'validator returns true for claude + auto-input-until-mergeable');
assertTrue(claudeArgv.bidirectionalInteractiveMode, 'auto-input-until-mergeable enables bidirectional-interactive-mode');
assertTrue(claudeArgv.interactiveMode, 'cascades to interactive-mode (issue #817)');
assertTrue(claudeArgv.acceptIncommingCommentsAsInput, 'cascades to accept-incomming-comments-as-input (issue #817)');
assertTrue(claudeArgv.excludeAllOwnIncommingCommentsFromInput, 'cascades to exclude-all-own-incomming-comments-from-input (issue #817)');

console.log('\n--- validator preserves the explicit user toggle ---');

const claudeOptOutArgv = {
  autoInputUntilMergeable: true,
  // User explicitly opted into --bidirectional-interactive-mode separately;
  // validator must not regress that.
  bidirectionalInteractiveMode: true,
  tool: 'claude',
  acceptIncommingCommentsAsInput: false,
  interactiveMode: false,
  excludeAllOwnIncommingCommentsFromInput: false,
};
await validateBidirectionalModeConfig(claudeOptOutArgv, noLog);
assertTrue(claudeOptOutArgv.bidirectionalInteractiveMode, 'explicit bidirectional-interactive-mode stays on');
assertTrue(claudeOptOutArgv.acceptIncommingCommentsAsInput, 'cascades unchanged when both flags are set');

console.log('\n--- non-Claude tool: streaming pipe is disabled with a warning, just like today ---');

const codexLogs = [];
const codexLog = async msg => {
  codexLogs.push(String(msg));
};
const codexArgv = {
  autoInputUntilMergeable: true,
  tool: 'codex',
  bidirectionalInteractiveMode: false,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
};
const codexResult = await validateBidirectionalModeConfig(codexArgv, codexLog);
assertEqual(codexResult, false, 'non-claude tool: validator returns false (existing tool-support behavior preserved)');
assertFalse(codexArgv.acceptIncommingCommentsAsInput, 'streaming-input is disabled for codex (no NDJSON channel upstream)');
assertFalse(codexArgv.excludeAllOwnIncommingCommentsFromInput, 'self-talk filter is disabled along with streaming-input');
assertTrue(
  codexLogs.some(l => l.includes('only supported for --tool claude')),
  'validator logs the standard "claude only" warning so users see why streaming is off'
);

console.log('\n--- without the flag, the validator is a strict no-op (R4) ---');

const noFlagArgv = {
  tool: 'claude',
  // None of the issue #817 / #1708 flags set
};
const noFlagResult = await validateBidirectionalModeConfig(noFlagArgv, noLog);
assertEqual(noFlagResult, true, 'validator returns true when no streaming flag is requested');
assertFalse(noFlagArgv.bidirectionalInteractiveMode, 'no flag means bidirectional stays off');
assertFalse(noFlagArgv.acceptIncommingCommentsAsInput, 'no flag means streaming-input stays off');
assertFalse(noFlagArgv.interactiveMode, 'no flag means interactive-mode stays off');

console.log(`\n================================================================================`);
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log(`================================================================================`);

if (failed > 0) process.exit(1);
