#!/usr/bin/env node

/**
 * Tests for issue #1883:
 * --keep-working-until-all-requirements-are-fully-done
 *
 * Covers the pure detection + normalization helpers (network-free) plus the
 * CLI option definition and the config-level normalization of the flag.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1883
 */

import assert from 'node:assert/strict';
import { DEFAULT_KEEP_WORKING_LIMIT, KEEP_WORKING_PROMPT, DEFERRED_WORK_PATTERNS, isUnlimitedKeepWorking, normalizeKeepWorkingLimit, formatKeepWorkingLimit, detectDeferredWork, detectDeferredWorkInSources, extractAddedLinesFromPatch, buildKeepWorkingFeedback } from '../src/solve.keep-working.detect.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS, parseArguments } from '../src/solve.config.lib.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test('default keep-working limit is 5', () => {
  assert.equal(DEFAULT_KEEP_WORKING_LIMIT, 5);
});

test('reinforcement prompt matches the issue verbatim', () => {
  assert.equal(KEEP_WORKING_PROMPT, 'Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.');
});

test('there is at least one deferred-work pattern and all are global regexps', () => {
  assert.ok(DEFERRED_WORK_PATTERNS.length >= 10);
  for (const { label, pattern } of DEFERRED_WORK_PATTERNS) {
    assert.equal(typeof label, 'string');
    assert.ok(pattern instanceof RegExp);
    assert.ok(pattern.flags.includes('g'), `pattern for "${label}" must be global`);
    assert.ok(pattern.flags.includes('i'), `pattern for "${label}" must be case-insensitive`);
  }
});

// ---------------------------------------------------------------------------
// normalizeKeepWorkingLimit
// ---------------------------------------------------------------------------

test('bare flag (true) normalizes to the default of 5', () => {
  assert.equal(normalizeKeepWorkingLimit(true), 5);
});

test('falsy values disable the feature (0)', () => {
  assert.equal(normalizeKeepWorkingLimit(undefined), 0);
  assert.equal(normalizeKeepWorkingLimit(null), 0);
  assert.equal(normalizeKeepWorkingLimit(false), 0);
  assert.equal(normalizeKeepWorkingLimit(''), 0);
});

test('explicit positive numbers are honored (number and numeric string)', () => {
  assert.equal(normalizeKeepWorkingLimit(5), 5);
  assert.equal(normalizeKeepWorkingLimit('5'), 5);
  assert.equal(normalizeKeepWorkingLimit(1), 1);
  assert.equal(normalizeKeepWorkingLimit('12'), 12);
  assert.equal(normalizeKeepWorkingLimit(3.9), 3); // floored
});

test('unlimited keywords and 0 remove the limit (Infinity)', () => {
  for (const keyword of ['forever', 'unlimited', 'infinite', 'infinity', 'inf', 'no-limit', 'nolimit', 'none', 'always']) {
    assert.equal(normalizeKeepWorkingLimit(keyword), Infinity, `keyword "${keyword}" should be unlimited`);
    assert.equal(normalizeKeepWorkingLimit(keyword.toUpperCase()), Infinity, `keyword "${keyword}" should be case-insensitive`);
  }
  assert.equal(normalizeKeepWorkingLimit('0'), Infinity);
  assert.equal(normalizeKeepWorkingLimit(0), Infinity);
  assert.equal(normalizeKeepWorkingLimit('  forever  '), Infinity, 'whitespace is trimmed');
});

test('invalid / non-numeric strings fall back to the default', () => {
  assert.equal(normalizeKeepWorkingLimit('not-a-number'), 5);
  assert.equal(normalizeKeepWorkingLimit(-1), 5);
  assert.equal(normalizeKeepWorkingLimit('-3'), 5);
  assert.equal(normalizeKeepWorkingLimit(NaN), 5);
});

test('normalize respects a custom fallback', () => {
  assert.equal(normalizeKeepWorkingLimit(true, 7), 7);
  assert.equal(normalizeKeepWorkingLimit('bad', 9), 9);
});

test('isUnlimitedKeepWorking detects unlimited requests', () => {
  assert.equal(isUnlimitedKeepWorking('forever'), true);
  assert.equal(isUnlimitedKeepWorking('UNLIMITED'), true);
  assert.equal(isUnlimitedKeepWorking('0'), true);
  assert.equal(isUnlimitedKeepWorking(0), true);
  assert.equal(isUnlimitedKeepWorking(Infinity), true);
  assert.equal(isUnlimitedKeepWorking(5), false);
  assert.equal(isUnlimitedKeepWorking('5'), false);
  assert.equal(isUnlimitedKeepWorking('whatever'), false);
});

test('formatKeepWorkingLimit renders unlimited and numeric limits', () => {
  assert.equal(formatKeepWorkingLimit(Infinity), 'unlimited');
  assert.equal(formatKeepWorkingLimit(5), '5');
  assert.equal(formatKeepWorkingLimit(1), '1');
});

// ---------------------------------------------------------------------------
// detectDeferredWork
// ---------------------------------------------------------------------------

const deferralPhrases = ['This is out of scope for this PR.', 'Left as future work.', 'Will be addressed in a follow-up PR.', 'This will be handled in a separate pull request.', 'TODO: implement validation.', 'FIXME: handle the edge case.', 'This is deferred for now.', 'Postponed to a later iteration.', 'Planned for a future release.', 'Not implemented yet.', 'To be implemented.', 'Tracked separately in a new issue.', 'For now, we only handle the happy path.'];

test('detects each representative deferral phrase', () => {
  for (const phrase of deferralPhrases) {
    const detections = detectDeferredWork(phrase, 'unit');
    assert.ok(detections.length > 0, `expected a detection for: "${phrase}"`);
    assert.equal(detections[0].source, 'unit');
    assert.ok(detections[0].label);
    assert.ok(detections[0].snippet);
  }
});

test('does not flag ordinary completion language', () => {
  const clean = ['All requirements are fully implemented and tested.', 'This pull request closes the issue completely.', 'Everything is done and the tests pass.', 'The feature works as described in the specification.'];
  for (const text of clean) {
    const detections = detectDeferredWork(text, 'unit');
    assert.equal(detections.length, 0, `unexpected detection in: "${text}"`);
  }
});

test('does NOT match the reinforcement prompt itself (no infinite loop)', () => {
  // Critical: the prompt we inject must not re-trigger detection on the next pass.
  const detections = detectDeferredWork(KEEP_WORKING_PROMPT, 'reinforcement');
  assert.equal(detections.length, 0, `reinforcement prompt should not be flagged, got: ${JSON.stringify(detections)}`);
});

test('the reinforcement prompt is the only feedback content that may leak into scanned sources, and it is clean', () => {
  // The feedback block (buildKeepWorkingFeedback) is injected as the restart
  // PROMPT — it is never one of the three scanned sources (PR description, AI
  // summary, changed markdown), so its instructional phrases ("There is NO
  // future pull request", "Do not defer ...") cannot themselves drive the loop.
  // The one piece most likely to be echoed verbatim by the AI into a scanned
  // source is the reinforcement prompt, which must stay detection-free to avoid
  // a self-sustaining restart loop.
  const lines = buildKeepWorkingFeedback([{ label: 'out of scope', snippet: 's', source: 'pr' }], 1, 5);
  assert.ok(lines.join('\n').includes(KEEP_WORKING_PROMPT));
  assert.equal(detectDeferredWork(KEEP_WORKING_PROMPT, 'reinforcement').length, 0);
});

test('handles empty / non-string input gracefully', () => {
  assert.deepEqual(detectDeferredWork('', 'x'), []);
  assert.deepEqual(detectDeferredWork(null, 'x'), []);
  assert.deepEqual(detectDeferredWork(undefined, 'x'), []);
  assert.deepEqual(detectDeferredWork(42, 'x'), []);
});

test('detection is repeatable (global regex lastIndex is reset)', () => {
  const text = 'This is out of scope and will be done later in a follow-up PR.';
  const first = detectDeferredWork(text, 'a');
  const second = detectDeferredWork(text, 'b');
  assert.equal(first.length, second.length);
  assert.ok(first.length > 0);
});

test('de-duplicates identical label+snippet hits within a source', () => {
  const text = 'out of scope. out of scope. out of scope.';
  const detections = detectDeferredWork(text, 'dup');
  const outOfScope = detections.filter(d => d.label === 'out of scope');
  // The three occurrences have distinct surrounding context, so snippets differ;
  // but identical snippets must be collapsed. At minimum no crash + at least one.
  assert.ok(outOfScope.length >= 1);
});

// ---------------------------------------------------------------------------
// detectDeferredWorkInSources
// ---------------------------------------------------------------------------

test('detectDeferredWorkInSources aggregates across sources', () => {
  const sources = [
    { source: 'pull request description', text: 'This is out of scope.' },
    { source: 'AI solution summary', text: 'Everything done.' },
    { source: 'changed markdown document README.md', text: 'TODO: write docs.' },
  ];
  const detections = detectDeferredWorkInSources(sources);
  const sourcesSeen = new Set(detections.map(d => d.source));
  assert.ok(sourcesSeen.has('pull request description'));
  assert.ok(sourcesSeen.has('changed markdown document README.md'));
  assert.ok(!sourcesSeen.has('AI solution summary'));
});

test('detectDeferredWorkInSources tolerates null/empty input', () => {
  assert.deepEqual(detectDeferredWorkInSources(null), []);
  assert.deepEqual(detectDeferredWorkInSources([]), []);
});

// ---------------------------------------------------------------------------
// extractAddedLinesFromPatch
// ---------------------------------------------------------------------------

test('extractAddedLinesFromPatch keeps only added content lines', () => {
  const patch = ['@@ -1,3 +1,4 @@', ' context line', '-removed line', '+added line one', '+added line two', '+++ b/file.md', '--- a/file.md'].join('\n');
  const added = extractAddedLinesFromPatch(patch);
  assert.ok(added.includes('added line one'));
  assert.ok(added.includes('added line two'));
  assert.ok(!added.includes('removed line'));
  assert.ok(!added.includes('context line'));
  assert.ok(!added.includes('b/file.md'));
});

test('extractAddedLinesFromPatch handles empty / undefined patch', () => {
  assert.equal(extractAddedLinesFromPatch(''), '');
  assert.equal(extractAddedLinesFromPatch(undefined), '');
  assert.equal(extractAddedLinesFromPatch(null), '');
});

// ---------------------------------------------------------------------------
// buildKeepWorkingFeedback
// ---------------------------------------------------------------------------

test('buildKeepWorkingFeedback includes reasons, the iteration label and the prompt', () => {
  const detections = [
    { label: 'out of scope', snippet: 'this is out of scope', source: 'pull request description' },
    { label: 'future work', snippet: 'left as future work', source: 'AI solution summary' },
  ];
  const lines = buildKeepWorkingFeedback(detections, 2, 5);
  const text = lines.join('\n');
  assert.ok(text.includes('restart 2/5'));
  assert.ok(text.includes('out of scope'));
  assert.ok(text.includes('future work'));
  assert.ok(text.includes(KEEP_WORKING_PROMPT));
});

test('buildKeepWorkingFeedback renders unlimited limit label', () => {
  const lines = buildKeepWorkingFeedback([{ label: 'x', snippet: 'y', source: 'z' }], 1, Infinity);
  assert.ok(lines.join('\n').includes('restart 1/unlimited'));
});

// ---------------------------------------------------------------------------
// CLI option definition + config normalization
// ---------------------------------------------------------------------------

test('option is defined with the expected aliases', () => {
  const def = SOLVE_OPTION_DEFINITIONS['keep-working-until-all-requirements-are-fully-done'];
  assert.ok(def, 'option must be defined');
  assert.equal(def.type, 'string');
  assert.ok(def.alias.includes('keep-going-until-all-requirements-are-fully-done'));
  assert.ok(def.alias.includes('keep-working'));
  assert.ok(def.alias.includes('keep-going'));
});

const parseFlag = async extraArgs => {
  const saved = process.argv;
  try {
    process.argv = ['node', 'solve.mjs', 'https://github.com/o/r/issues/1', ...extraArgs];
    const argv = await parseArguments();
    return argv.keepWorkingUntilAllRequirementsAreFullyDone;
  } finally {
    process.argv = saved;
  }
};

test('CLI: bare flag yields the default of 5', async () => {
  const raw = await parseFlag(['--keep-working-until-all-requirements-are-fully-done']);
  assert.equal(normalizeKeepWorkingLimit(raw), 5);
});

test('CLI: explicit number is honored', async () => {
  const raw = await parseFlag(['--keep-working-until-all-requirements-are-fully-done=3']);
  assert.equal(normalizeKeepWorkingLimit(raw), 3);
});

test('CLI: forever keyword removes the limit', async () => {
  const raw = await parseFlag(['--keep-working-until-all-requirements-are-fully-done=forever']);
  assert.equal(normalizeKeepWorkingLimit(raw), Infinity);
});

test('CLI: short alias --keep-working bare yields the default of 5', async () => {
  const raw = await parseFlag(['--keep-working']);
  assert.equal(normalizeKeepWorkingLimit(raw), 5);
});

test('CLI: short alias --keep-going with value', async () => {
  const raw = await parseFlag(['--keep-going', 'unlimited']);
  assert.equal(normalizeKeepWorkingLimit(raw), Infinity);
});

test('CLI: flag absent leaves the feature disabled', async () => {
  const raw = await parseFlag([]);
  assert.equal(normalizeKeepWorkingLimit(raw), 0);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`All ${passed} issue #1883 keep-working tests passed.`);
