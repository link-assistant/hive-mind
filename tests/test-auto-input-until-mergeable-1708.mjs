/**
 * Regression test for issue #1708.
 *
 * --auto-input-until-mergeable is a new experimental flag introduced in
 * stage 1 of issue #1708. In this stage the flag is intentionally inert
 * for the auto-merge loop (the bigger streaming-aware watchUntilMergeable
 * replacement is staged in subsequent PRs — see
 * docs/case-studies/issue-1708/README.md). The only behavior wired up in
 * this PR is composition:
 *   - --auto-input-until-mergeable enables --accept-incomming-comments-as-input
 *     for --tool claude (input-only side of bidirectional mode).
 *   - --auto-input-until-mergeable defaults the delivery mode to
 *     --queue-comments-to-input (defer until the AI is idle).
 *   - It does NOT enable --interactive-mode or --bidirectional-interactive-mode
 *     (those would also push tool output back as PR comments, which is a
 *     separate feature).
 *
 * Two new flags govern delivery mode:
 *   - --stream-comments-to-input (default for --accept-incomming-comments-as-input
 *     on its own; matches existing #817 behavior).
 *   - --queue-comments-to-input (default for --auto-input-until-mergeable;
 *     hold comments until the AI signals it is idle).
 *
 * This test asserts:
 *   1. The flag exists in the yargs config with default `false`.
 *   2. The two new delivery-mode flags exist with default `false`.
 *   3. validateBidirectionalModeConfig auto-enables
 *      --accept-incomming-comments-as-input + --queue-comments-to-input
 *      when only --auto-input-until-mergeable is passed (claude tool),
 *      WITHOUT enabling --interactive-mode or
 *      --bidirectional-interactive-mode.
 *   4. --accept-incomming-comments-as-input on its own defaults to
 *      --stream-comments-to-input (preserves #817 behavior).
 *   5. queue mode wins when both delivery flags are set.
 *   6. For non-Claude tools, the streaming pipe is disabled with a
 *      warning, and both delivery-mode flags are reset.
 *   7. The flag does NOT change any default that watchUntilMergeable
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

console.log('\n--- yargsOptions registers --stream-comments-to-input and --queue-comments-to-input ---');

const streamOpt = yargsOptions['stream-comments-to-input'];
assertTrue(!!streamOpt, '--stream-comments-to-input is present in yargsOptions');
assertEqual(streamOpt?.type, 'boolean', '--stream-comments-to-input is boolean');
assertEqual(streamOpt?.default, false, '--stream-comments-to-input defaults to false (opt-in only)');
assertTrue(streamOpt?.description?.includes('[EXPERIMENTAL]'), '--stream-comments-to-input is marked experimental');

const queueOpt = yargsOptions['queue-comments-to-input'];
assertTrue(!!queueOpt, '--queue-comments-to-input is present in yargsOptions');
assertEqual(queueOpt?.type, 'boolean', '--queue-comments-to-input is boolean');
assertEqual(queueOpt?.default, false, '--queue-comments-to-input defaults to false (opt-in only)');
assertTrue(queueOpt?.description?.includes('[EXPERIMENTAL]'), '--queue-comments-to-input is marked experimental');

console.log('\n--- defaults for the existing auto-merge loop are unchanged ---');

const autoRestartOpt = yargsOptions['auto-restart-until-mergeable'];
assertEqual(autoRestartOpt?.default, true, 'auto-restart-until-mergeable still defaults to true');
const autoMergeOpt = yargsOptions['auto-merge'];
assertEqual(autoMergeOpt?.default, false, 'auto-merge still defaults to false');

console.log('\n--- validateBidirectionalModeConfig: --auto-input-until-mergeable on claude composes correctly ---');

const noLog = async () => {};

const claudeArgv = {
  autoInputUntilMergeable: true,
  tool: 'claude',
  bidirectionalInteractiveMode: false,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
  streamCommentsToInput: false,
  queueCommentsToInput: false,
};
const claudeResult = await validateBidirectionalModeConfig(claudeArgv, noLog);
assertEqual(claudeResult, true, 'validator returns true for claude + auto-input-until-mergeable');
assertTrue(claudeArgv.acceptIncommingCommentsAsInput, 'auto-input-until-mergeable enables accept-incomming-comments-as-input');
assertTrue(claudeArgv.queueCommentsToInput, 'auto-input-until-mergeable defaults delivery to queue mode');
assertFalse(claudeArgv.streamCommentsToInput, 'queue mode is the default; stream is NOT enabled');
assertFalse(claudeArgv.interactiveMode, 'auto-input-until-mergeable does NOT enable --interactive-mode (output stays out of PR)');
assertFalse(claudeArgv.bidirectionalInteractiveMode, 'auto-input-until-mergeable does NOT imply --bidirectional-interactive-mode');
assertFalse(claudeArgv.excludeAllOwnIncommingCommentsFromInput, 'auto-input-until-mergeable does NOT toggle the self-talk filter');

console.log('\n--- --accept-incomming-comments-as-input on its own defaults to stream mode (#817 backwards-compat) ---');

const acceptOnlyArgv = {
  tool: 'claude',
  acceptIncommingCommentsAsInput: true,
  streamCommentsToInput: false,
  queueCommentsToInput: false,
};
await validateBidirectionalModeConfig(acceptOnlyArgv, noLog);
assertTrue(acceptOnlyArgv.streamCommentsToInput, 'standalone accept flag defaults to stream-comments-to-input');
assertFalse(acceptOnlyArgv.queueCommentsToInput, 'standalone accept flag does NOT default to queue mode');

console.log('\n--- explicit --queue-comments-to-input wins over --stream-comments-to-input when both are set ---');

const bothModesArgv = {
  tool: 'claude',
  acceptIncommingCommentsAsInput: true,
  streamCommentsToInput: true,
  queueCommentsToInput: true,
};
await validateBidirectionalModeConfig(bothModesArgv, noLog);
assertTrue(bothModesArgv.queueCommentsToInput, 'queue mode stays on when both flags are set');
assertFalse(bothModesArgv.streamCommentsToInput, 'queue mode wins; stream is reset to false');

console.log('\n--- --bidirectional-interactive-mode still cascades to the three #817 flags (no regression) ---');

const bidirArgv = {
  tool: 'claude',
  bidirectionalInteractiveMode: true,
  interactiveMode: false,
  acceptIncommingCommentsAsInput: false,
  excludeAllOwnIncommingCommentsFromInput: false,
};
await validateBidirectionalModeConfig(bidirArgv, noLog);
assertTrue(bidirArgv.interactiveMode, 'bidirectional cascades to interactive-mode');
assertTrue(bidirArgv.acceptIncommingCommentsAsInput, 'bidirectional cascades to accept-incomming-comments-as-input');
assertTrue(bidirArgv.excludeAllOwnIncommingCommentsFromInput, 'bidirectional cascades to exclude-all-own-incomming-comments-from-input');
assertTrue(bidirArgv.streamCommentsToInput, 'bidirectional defaults to stream mode (matches #817 behavior)');

console.log('\n--- explicit user toggles are preserved ---');

const explicitArgv = {
  autoInputUntilMergeable: true,
  tool: 'claude',
  acceptIncommingCommentsAsInput: true,
  // User explicitly opted into stream mode; queue should NOT override it.
  streamCommentsToInput: true,
  queueCommentsToInput: false,
};
await validateBidirectionalModeConfig(explicitArgv, noLog);
assertTrue(explicitArgv.streamCommentsToInput, 'explicit stream-comments-to-input stays on');
assertFalse(explicitArgv.queueCommentsToInput, 'explicit stream choice is not overridden to queue');

console.log('\n--- non-Claude tool: streaming pipe is disabled with a warning ---');

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
  streamCommentsToInput: false,
  queueCommentsToInput: false,
};
const codexResult = await validateBidirectionalModeConfig(codexArgv, codexLog);
assertEqual(codexResult, false, 'non-claude tool: validator returns false (existing tool-support behavior preserved)');
assertFalse(codexArgv.acceptIncommingCommentsAsInput, 'streaming-input is disabled for codex (no NDJSON channel upstream)');
assertFalse(codexArgv.excludeAllOwnIncommingCommentsFromInput, 'self-talk filter is disabled along with streaming-input');
assertFalse(codexArgv.streamCommentsToInput, 'stream-comments-to-input is reset for non-claude tools');
assertFalse(codexArgv.queueCommentsToInput, 'queue-comments-to-input is reset for non-claude tools');
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
assertFalse(noFlagArgv.streamCommentsToInput, 'no flag means stream-comments-to-input stays off');
assertFalse(noFlagArgv.queueCommentsToInput, 'no flag means queue-comments-to-input stays off');

console.log(`\n================================================================================`);
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log(`================================================================================`);

if (failed > 0) process.exit(1);
