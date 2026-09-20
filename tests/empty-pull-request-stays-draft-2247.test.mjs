#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2247 (H2): a pull request that changed nothing
 * must not be converted to "ready for review".
 *
 * All three `--model formal-ai` Hello World runs of 2026-09-13 ended this way.
 * The Rust one is the clearest: the Codex session echoed the issue JSON as its
 * final answer, zero commits landed on the branch, and Hive Mind still ran
 *
 *     gh pr ready <n>   # reason: "solution draft verified"
 *
 * publishing a verification claim that the diff contradicts. The check existed
 * (`getPullRequestChangeStats`) but lived inside the placeholder-description
 * branch of verifyResults(), so a run that never hit that branch never measured
 * anything.
 *
 * The fix has to survive the *rest* of the shutdown sequence, which is why the
 * decision is recorded in pr-draft-state.lib.mjs rather than at the call site:
 * solve.mjs calls endWorkSession() after verifyResults(), and endWorkSession()
 * converts to ready unconditionally (issue #2182's invariant). A gate that only
 * lived in verifyResults() would be undone a few hundred lines later.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { clearPullRequestLeftInDraft, ensurePullRequestIsDraft, ensurePullRequestIsReady, getOutstandingWorkingSessionDrafts, getPullRequestLeftInDraft, resetWorkingSessionDrafts, restorePullRequestsLeftInDraft } from '../src/pr-draft-state.lib.mjs';
import { NO_CHANGES_PRODUCED_MARKER, TOOL_GENERATED_COMMENT_MARKERS } from '../src/tool-comments.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

/** Fake command-stream `$` that answers `gh pr view` and applies `gh pr ready`. */
const makeFakeDollar = state => {
  const commands = [];
  const runner = (strings, ...values) => {
    const command = strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');
    commands.push(command);
    if (command.includes('gh pr view')) return Promise.resolve({ code: 0, stdout: JSON.stringify({ isDraft: state.isDraft, state: state.state || 'OPEN' }), stderr: '' });
    if (command.includes('gh pr ready')) {
      state.isDraft = command.includes('--undo');
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  };
  runner.commands = commands;
  return runner;
};

const silentLog = async () => {};
const emptyDiff = { measured: true, hasChanges: false, filesChanged: 0, additions: 0, deletions: 0, placeholderOnly: false, placeholderSections: 0 };
const realDiff = { measured: true, hasChanges: true, filesChanged: 2, additions: 30, deletions: 1, placeholderOnly: false, placeholderSections: 0 };
const unreadableDiff = { measured: false, hasChanges: false, filesChanged: 0, additions: 0, deletions: 0, placeholderOnly: false, placeholderSections: 0 };
const base = ($, overrides = {}) => ({ owner: 'konard', repo: 'test-hello-world-rust', prNumber: 1, $, log: silentLog, ...overrides });
const readyCalls = $ => $.commands.filter(command => command.includes('gh pr ready') && !command.includes('--undo'));

// --- An empty diff keeps the draft ---------------------------------------

{
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(base($, { reason: 'session start: new' }));

  const result = await ensurePullRequestIsReady(base($, { reason: 'solution draft verified', requireChanges: true, getChangeStats: async () => emptyDiff }));
  assert.equal(result.reason, 'no_changes', 'an empty measured diff must be reported as the reason, not silently ignored');
  assert.equal(result.changed, false);
  assert.equal(state.isDraft, true, 'the pull request must still be a draft');
  assert.equal(readyCalls($).length, 0, 'no `gh pr ready` may be issued for an empty pull request');

  // The reproduction bug: solve.mjs calls endWorkSession() *after* verifyResults(),
  // and endWorkSession() converts to ready with no idea what the diff contained.
  const sessionEnd = await ensurePullRequestIsReady(base($, { reason: 'session end' }));
  assert.equal(sessionEnd.reason, 'left_in_draft_on_purpose', 'a later unconditional ready conversion must not override the decision');
  assert.equal(state.isDraft, true, 'session end must not flip an empty pull request to ready');
  assert.equal(readyCalls($).length, 0);

  // …and neither may the #2182 safety nets, which drain the outstanding registry.
  assert.deepEqual(getOutstandingWorkingSessionDrafts(), [], 'a deliberate draft is not an outstanding obligation');
  const restored = await restorePullRequestsLeftInDraft({ $, log: silentLog, reason: 'session interrupted (CTRL+C)' });
  assert.deepEqual(restored, [], 'the safety net has nothing to restore');
  assert.equal(state.isDraft, true);

  const record = getPullRequestLeftInDraft({ owner: 'konard', repo: 'test-hello-world-rust', prNumber: 1 });
  assert.equal(record.reason, 'no changes were produced by this session', 'the issue asks for this exact wording to be published');
  assert.equal(record.changeStats, emptyDiff, 'the measured stats are kept so the comment can quote them');
}

// --- A real diff still converts, exactly as before ------------------------

{
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(base($));
  const result = await ensurePullRequestIsReady(base($, { reason: 'solution draft verified', requireChanges: true, getChangeStats: async () => realDiff }));
  assert.equal(result.changed, true, 'a pull request with changes is still marked ready for review');
  assert.equal(state.isDraft, false);
  assert.deepEqual(getOutstandingWorkingSessionDrafts(), [], 'the ready conversion drains the registry');
}

// --- An unreadable diff is not an empty diff ------------------------------

{
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft(base($));
  // `measured: false` means `gh pr diff` failed. Treating that as "no changes"
  // would strand finished work in draft because of a transient API error.
  const result = await ensurePullRequestIsReady(base($, { requireChanges: true, getChangeStats: async () => unreadableDiff }));
  assert.equal(result.changed, true, 'an unmeasured diff must not be read as an empty one');
  assert.equal(state.isDraft, false);
}

// --- The next session gets a clean slate ----------------------------------

{
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsReady(base($, { requireChanges: true, getChangeStats: async () => emptyDiff }));
  assert.ok(getPullRequestLeftInDraft(base($)), 'precondition: the decision is recorded');

  await ensurePullRequestIsDraft(base($, { reason: 'session start: auto-restart' }));
  assert.equal(getPullRequestLeftInDraft(base($)), null, 'a new working session is about to try again, so the previous verdict is stale');

  const result = await ensurePullRequestIsReady(base($, { requireChanges: true, getChangeStats: async () => realDiff }));
  assert.equal(result.changed, true, 'the session that finally produced a diff must be able to publish it');
}

// --- `force` remains available for callers that mean it -------------------

{
  resetWorkingSessionDrafts();
  const state = { isDraft: true, state: 'OPEN' };
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsReady(base($, { requireChanges: true, getChangeStats: async () => emptyDiff }));
  const forced = await ensurePullRequestIsReady(base($, { force: true }));
  assert.equal(forced.changed, true, 'an explicit force still converts');
  assert.equal(state.isDraft, false);
  clearPullRequestLeftInDraft(base($));
}

// --- The call site the reproduction runs went through ---------------------

{
  const results = readSrc('solve.results.lib.mjs');
  assert.match(results, /reason: 'solution draft verified', requireChanges: true/, 'verifyResults() must measure the diff before claiming the draft is verified');
  assert.match(results, /readyResult\.reason === 'no_changes'/, 'the empty-diff branch must publish the reason');
  assert.ok(results.includes('postNoChangesProducedComment'), 'a draft with no explanation reads like a crashed run');

  // The comment is tool-generated: --auto-attach-solution-summary must not
  // mistake it for AI-authored feedback (issue #1625).
  assert.ok(TOOL_GENERATED_COMMENT_MARKERS.includes(NO_CHANGES_PRODUCED_MARKER), 'the notice must be recognised as a tool comment');
}

resetWorkingSessionDrafts();
console.log('PASS: issue #2247 (H2) an empty pull request stays a draft and says so');
