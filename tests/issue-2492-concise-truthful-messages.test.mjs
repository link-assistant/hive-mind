#!/usr/bin/env node

/**
 * Issue #2492: user-facing comments state only what is true when they are posted,
 * and stay short unless the user asked for detail.
 *
 * The reported "AI Work Session Started" comment said "Starting ..." after the
 * fact, claimed "The PR has been converted to draft mode" on a PR that already was
 * a draft, and carried a runtime line (solve version, tool, model, task image
 * digest) that the solution log already records.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2492
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildAutoMergeBlockedComment } from '../src/automation-stop-reporting.lib.mjs';
import { buildAutoRestartComment, buildAutoRestartLimitComment, buildUncommittedChangesRestartComment } from '../src/auto-restart-exhaustion.lib.mjs';
import { buildUsageLimitSummary } from '../src/github.lib.mjs';
import { buildSessionForceKilledComment } from '../src/session-force-killed-comment.lib.mjs';
import { buildManualMergeNotice } from '../src/solve.auto-merge-preflight.lib.mjs';
import { buildNoChangesProducedComment } from '../src/solve.session-comments.lib.mjs';
import { AUTO_MERGE_BLOCKED_MARKER, AUTO_RESTART_MARKER, READY_TO_MERGE_MARKER, SESSION_FORCE_KILLED_MARKER } from '../src/tool-comments.lib.mjs';

import { buildPrePullRequestFailureActionSection } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { getSessionCommentContent, postWorkSessionStartComment, SESSION_TYPES, shouldPublishSessionRuntime } from '../src/solve.session.lib.mjs';

const AT = new Date('2026-10-04T12:00:55.290Z');
const RUNTIME = '_Runtime: solve `v2.33.11` · tool `claude` · model `opus`_';

// ---------------------------------------------------------------------------
// 1. Session start comments: past tense, no unchecked draft claim, short.
// ---------------------------------------------------------------------------

for (const type of Object.values(SESSION_TYPES)) {
  const { description } = getSessionCommentContent(type, AT);
  assert.doesNotMatch(description, /converted to draft/i, `${type}: the draft change is shown by GitHub, and may not have happened`);
  assert.doesNotMatch(description, /^(Starting|Resuming|Auto-resuming|Auto-restarting)/, `${type}: the comment is posted after the session started`);
  assert.doesNotMatch(description, /Runtime:/, `${type}: no runtime line by default`);
  assert.match(description, /2026-10-04T12:00:55\.290Z/, `${type}: the start time is stated`);
  assert.ok(description.length <= 160, `${type}: concise (${description.length} chars): ${description}`);
}

assert.equal(getSessionCommentContent(SESSION_TYPES.NEW, AT).description, 'Started at 2026-10-04T12:00:55.290Z. Please wait for it to finish before giving feedback.');
assert.match(getSessionCommentContent(SESSION_TYPES.AUTO_RESUME, AT).description, /previous context kept/);
assert.match(getSessionCommentContent(SESSION_TYPES.AUTO_RESTART, AT).description, /fresh context/);
assert.match(getSessionCommentContent(SESSION_TYPES.NEW, AT, RUNTIME).description, /\n\n_Runtime: solve/, 'an explicitly passed runtime line is appended');

// ---------------------------------------------------------------------------
// 2. The runtime line reaches GitHub only with --verbose; it is always logged.
// ---------------------------------------------------------------------------

assert.equal(shouldPublishSessionRuntime(null), false);
assert.equal(shouldPublishSessionRuntime({}), false);
assert.equal(shouldPublishSessionRuntime({ attachLogs: true }), false, 'the attached log already contains it');
assert.equal(shouldPublishSessionRuntime({ verbose: true }), true);

const postStart = async argv => {
  let body = null;
  const logLines = [];
  const $ = options => () => {
    body = JSON.parse(options.stdin).body;
    return Promise.resolve({ code: 0, stdout: Buffer.from('{"id":1}'), stderr: Buffer.from('') });
  };
  await postWorkSessionStartComment({
    owner: 'o',
    repo: 'r',
    prNumber: 1,
    $,
    log: async line => logLines.push(line),
    formatAligned: (...parts) => parts.join(' '),
    sessionType: SESSION_TYPES.NEW,
    timestamp: AT,
    argv,
    resolveRuntime: async () => ({ line: RUNTIME }),
  });
  return { body, logLines };
};

const quiet = await postStart({ tool: 'claude', model: 'opus' });
assert.equal(quiet.body, '🤖 **AI Work Session Started**\n\nStarted at 2026-10-04T12:00:55.290Z. Please wait for it to finish before giving feedback.');
assert.ok(
  quiet.logLines.some(line => line.includes('Runtime:') && line.includes('solve `v2.33.11`')),
  'the runtime still goes to the log'
);

const verbose = await postStart({ tool: 'claude', model: 'opus', verbose: true });
assert.match(verbose.body, /_Runtime: solve `v2\.33\.11`/);

// ---------------------------------------------------------------------------
// 3. An unclassified failure does not get a guessed cause.
// ---------------------------------------------------------------------------

const limitGuidance = buildPrePullRequestFailureActionSection('Auto-restart limit reached');
assert.doesNotMatch(limitGuidance, /account|permissions/i, 'a restart limit is not an account or permissions problem');
assert.equal(limitGuidance, '### What you can do\n- Check the reason above and the log, then rerun the solver.');

// ---------------------------------------------------------------------------
// 4. Auto-restart comments: no footer that repeats the budget or the marker.
// ---------------------------------------------------------------------------

const restart = buildAutoRestartComment({ label: '2/5', reason: 'CI failed' });
assert.equal(restart, `## 🔄 ${AUTO_RESTART_MARKER} 2/5\n\n**Reason:** CI failed\n\nStarting a new session to address it.`);

const uncommitted = buildUncommittedChangesRestartComment({ label: '1/5', uncommittedFilesList: '\n\n- `a.txt`' });
assert.ok(uncommitted.startsWith(`## 🔄 ${AUTO_RESTART_MARKER} 1/5\n\n`), 'the marker heading is kept for detection');
assert.doesNotMatch(uncommitted, /more iterations|---/, 'the label already shows the budget');
assert.match(uncommitted, /`a\.txt`$/);

const limit = buildAutoRestartLimitComment({ label: '5/5', blocker: 'CI failed', preservedText: 'Nothing to preserve.' });
assert.ok(limit.startsWith(`## ❌ ${AUTO_RESTART_MARKER} 5/5 - limit reached`));
assert.doesNotMatch(limit, /Configured limit|---|reported as failed/, 'the heading already says the limit was reached');
assert.match(limit, /--auto-restart-max-iterations/);

// ---------------------------------------------------------------------------
// 5. A blocked auto-merge is not announced as "Ready to merge".
// ---------------------------------------------------------------------------

const manualMerge = buildManualMergeNotice('the token cannot merge.');
assert.ok(manualMerge.startsWith(`## ⚠️ ${AUTO_MERGE_BLOCKED_MARKER}`));
assert.ok(!manualMerge.includes(READY_TO_MERGE_MARKER), 'CI and mergeability were not checked when this is posted');
assert.doesNotMatch(manualMerge, /ready to be merged|---/i);

const heldBack = buildAutoMergeBlockedComment({ blockers: [{ reason: 'issue_closed', message: 'Issue is closed' }], issueNumber: 1 });
assert.ok(!heldBack.includes('Auto-merge (`--auto-merge`) cannot merge'), 'the pre-flight dedup signature does not match the held-back comment');
assert.ok(!manualMerge.includes(`${AUTO_MERGE_BLOCKED_MARKER}: this pull request is ready`), 'the held-back dedup signature does not match the pre-flight notice');

const preflightSource = readFileSync(new URL('../src/solve.auto-merge-preflight.lib.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(preflightSource, /READY_TO_MERGE_MARKER/, 'the notice must not suppress the real "Ready to merge" comment');

for (const file of ['../src/solve.auto-merge.lib.mjs', '../src/solve.auto-merge-attempt.lib.mjs']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\*Auto-merged by hive-mind|\*Monitored by hive-mind with --auto-restart-until-mergeable/, `${file}: no footer that repeats the heading`);
}

// ---------------------------------------------------------------------------
// 6. "Logs have been attached" is not claimed by the auto-close message.
// ---------------------------------------------------------------------------

for (const file of ['../src/solve.execution.lib.mjs', '../src/solve.error-handlers.lib.mjs', '../src/solve.results.lib.mjs']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Logs have been attached for debugging/, `${file}: the close message is posted before, and independently of, the log upload`);
}

// ---------------------------------------------------------------------------
// 7. Usage limit: one statement of what happened and what happens next.
// ---------------------------------------------------------------------------

const autoResume = buildUsageLimitSummary({ toolName: 'Claude', limitResetTime: null, sessionId: 's-1', isAutoResumeEnabled: true, autoResumeMode: 'resume' });
assert.equal(autoResume, '## ⏳ Usage Limit Reached\n\nThe Claude usage limit was reached, so this session stopped.\n\n- **Session ID**: s-1\n\n### 🔄 How to Continue\n**Auto-resume is enabled.** The session will resume (previous context kept) when the limit resets.');
assert.match(buildUsageLimitSummary({ toolName: 'Claude', isAutoResumeEnabled: true, autoResumeMode: 'restart' }), /restart \(fresh context\)/);
assert.match(buildUsageLimitSummary({ toolName: 'Claude', sessionId: 's-1', resumeCommand: 'solve --resume s-1' }), /```bash\nsolve --resume s-1\n```$/);
for (const body of [autoResume, buildUsageLimitSummary({ toolName: 'Claude' })]) {
  assert.doesNotMatch(body, /Limit Type|\n\*[^*]/, 'no restated limit type and no italic footer');
}

const solveSource = readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
assert.match(solveSource, /limitReached && \(argv\.autoResumeOnLimitReset \|\| argv\.autoRestartOnLimitReset\)/, '--auto-restart-on-limit-reset does what the comment promises instead of failing the run');
assert.doesNotMatch(solveSource, /auto-resume is enabled\. \${/i);

// ---------------------------------------------------------------------------
// 8. Empty diff: say what was measured, not what supposedly happened.
// ---------------------------------------------------------------------------

const noChanges = buildNoChangesProducedComment({ placeholderOnly: true });
assert.match(noChanges, /empty diff against its base branch \(only the solver placeholder file is present\)/);
assert.doesNotMatch(noChanges, /stays a draft|Nothing was implemented|above/, 'draft state and session history were not checked');
assert.doesNotMatch(buildNoChangesProducedComment(), /placeholder/);

const resultsSource = readFileSync(new URL('../src/solve.results.lib.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(resultsSource, /This pull request implements a solution/, 'completion does not invent a solution description');

// ---------------------------------------------------------------------------
// 9. Force-killed session: promise a resume only when there is one.
// ---------------------------------------------------------------------------

const resumed = buildSessionForceKilledComment({ timeoutType: 'activity', silentSeconds: 600, attempt: '1/3', delayLabel: '30s', resumeSessionId: 'abc' });
assert.equal(resumed, `## :warning: ${SESSION_FORCE_KILLED_MARKER} (activity timeout)\n\nNo output for 600s, so the session was stopped. Retry 1/3 in 30s, resuming session \`abc\` (previous context kept).`);
const fresh = buildSessionForceKilledComment({ timeoutType: 'startup', silentSeconds: 120, attempt: '1/3', delayLabel: '30s' });
assert.match(fresh, /starting fresh \(no session to resume\)\.$/);
assert.doesNotMatch(fresh, /--resume|context preserved/);

console.log('PASS: issue #2492 session comments are short and claim only checked facts');
