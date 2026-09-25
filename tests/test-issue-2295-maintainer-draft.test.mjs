#!/usr/bin/env node

/**
 * Regression test for issue #2295 (root cause H): a maintainer's draft must stay a draft.
 *
 * Timeline on paranjko/external-test-lab#177:
 * - 2026-09-24T05:51:01Z the maintainer (@ilyar) converted the PR to draft.
 * - The next hive-mind session found it "Already in draft mode", took over the draft
 *   as its own working-session draft, and the AI tool ran `gh pr ready 177` at
 *   18:45:13Z because the prompt says "When you finish implementation, use gh pr ready".
 * - 2026-09-25T09:50:23Z the maintainer had to convert it to draft again.
 *
 * Fix: ensurePullRequestIsDraft() detects that the latest draft transition was made by
 * someone other than the authenticated gh user and records a deliberate
 * `maintainer_draft`; ensurePullRequestIsReady() then keeps (and, if needed, restores)
 * the draft, and the watch loop's #2182 draft self-heal stops instead of flipping it.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2295
 */

import { ensurePullRequestIsDraft, ensurePullRequestIsReady, findMaintainerDraftConversion, getOutstandingWorkingSessionDrafts, getPullRequestLeftInDraft, resetWorkingSessionDrafts } from '../src/pr-draft-state.lib.mjs';
import { readFileSync } from 'fs';
import { resolveDraftBlocker } from '../src/solve.auto-merge-guards.lib.mjs';
import { postWorkSessionStartComment, SESSION_TYPES } from '../src/solve.session.lib.mjs';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  resetWorkingSessionDrafts();
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

/**
 * Fake command-stream `$`: answers `gh pr view`, `gh pr ready`, the timeline and `gh api user`.
 * `state.timeline` is a list of [event, actor, createdAt] draft/ready transitions.
 */
const makeFakeDollar = state => {
  const commands = [];
  const runner = (strings, ...values) => {
    const command = strings.reduce((acc, part, i) => acc + part + (i < values.length ? String(values[i]) : ''), '');
    commands.push(command);
    if (command.includes('gh pr view')) {
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ isDraft: state.isDraft, state: 'OPEN' }), stderr: '' });
    }
    if (command.includes('gh pr ready')) {
      state.isDraft = command.includes('--undo');
      state.timeline.push([state.isDraft ? 'convert_to_draft' : 'ready_for_review', state.self, new Date().toISOString()]);
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    if (command.includes('/timeline')) {
      if (state.timelineFails) return Promise.resolve({ code: 1, stdout: '', stderr: 'HTTP 502' });
      return Promise.resolve({ code: 0, stdout: state.timeline.map(fields => fields.join('\t')).join('\n'), stderr: '' });
    }
    if (command.includes('gh api user')) {
      return Promise.resolve({ code: 0, stdout: `${state.self}\n`, stderr: '' });
    }
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  };
  runner.commands = commands;
  return runner;
};

const silentLog = async () => {};
const fmt = (icon, key, value) => `${icon} ${key} ${value}`;
const pr = { owner: 'paranjko', repo: 'external-test-lab', prNumber: 177 };

// State of PR #177 when session 2 started (2026-09-24T18:05Z).
const session2State = () => ({
  isDraft: true,
  self: 'konard',
  timeline: [
    ['ready_for_review', 'konard', '2026-09-23T22:31:30Z'],
    ['convert_to_draft', 'ilyar', '2026-09-24T05:51:01Z'],
  ],
});

console.log('Regression: a maintainer draft stays a draft (Issue #2295)\n');

await test('detects the maintainer conversion from the timeline', async () => {
  const $ = makeFakeDollar(session2State());
  const conversion = await findMaintainerDraftConversion({ ...pr, $ });
  assert(conversion && conversion.actor === 'ilyar' && conversion.createdAt === '2026-09-24T05:51:01Z', `got ${JSON.stringify(conversion)}`);
});

await test('session start records a maintainer_draft instead of a working-session draft', async () => {
  const $ = makeFakeDollar(session2State());
  const result = await ensurePullRequestIsDraft({ ...pr, $, log: silentLog, formatAligned: fmt, reason: 'session start' });
  assert(result.maintainerDraft?.actor === 'ilyar', 'result reports the maintainer draft');
  assert(getPullRequestLeftInDraft(pr)?.kind === 'maintainer_draft', 'deliberate record kind is maintainer_draft');
  assert(getOutstandingWorkingSessionDrafts().length === 0, 'no working-session obligation to convert it back');
});

await test('session end keeps the draft and restores it if the AI ran `gh pr ready`', async () => {
  const state = session2State();
  const $ = makeFakeDollar(state);
  await ensurePullRequestIsDraft({ ...pr, $, log: silentLog, formatAligned: fmt });
  // The AI tool marks the PR ready itself (session 2, 18:45:13Z).
  state.isDraft = false;
  state.timeline.push(['ready_for_review', 'konard', '2026-09-24T18:45:13Z']);
  assert(state.isDraft === false, 'precondition: AI flipped the PR to ready');
  const result = await ensurePullRequestIsReady({ ...pr, $, log: silentLog, formatAligned: fmt, reason: 'solution draft verified', requireChanges: true, changeStats: { measured: true, hasChanges: true } });
  assert(result.reason === 'left_in_draft_on_purpose', `ready transition refused, got ${result.reason}`);
  assert(state.isDraft === true, 'the maintainer draft was restored');
  assert(getOutstandingWorkingSessionDrafts().length === 0, 'restoring does not create a working-session obligation');
});

await test('watch loop draft self-heal stops instead of overriding the maintainer', async () => {
  const state = session2State();
  const $ = makeFakeDollar(state);
  const decision = await resolveDraftBlocker({ ...pr, $, log: silentLog, formatAligned: fmt, reportError: () => {}, reportAutomationStop: async () => assert(false, 'must not post an automation-stop comment'), verbose: false, state: { draftSelfHealCount: 0 } });
  assert(decision.action === 'stop' && decision.reason === 'maintainer_draft', `got ${JSON.stringify(decision)}`);
  assert(state.isDraft === true && !$.commands.some(c => c.includes('gh pr ready')), 'no ready conversion attempted');
});

await test('the next session still sees the maintainer draft after an AI `gh pr ready` and our restore', async () => {
  // With the fix, session 2 ends with hive-mind restoring the draft, so the latest transition is ours.
  const state = session2State();
  state.timeline.push(['ready_for_review', 'konard', '2026-09-24T18:45:13Z'], ['convert_to_draft', 'konard', '2026-09-24T18:48:00Z']);
  const $ = makeFakeDollar(state);
  const conversion = await findMaintainerDraftConversion({ ...pr, $ });
  assert(conversion?.actor === 'ilyar', `got ${JSON.stringify(conversion)}`);
});

await test('session 3 (PR left ready by the session 2 AI) re-drafts it as the maintainer draft', async () => {
  const state = session2State();
  state.isDraft = false;
  state.timeline.push(['ready_for_review', 'konard', '2026-09-24T18:45:13Z']);
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsDraft({ ...pr, $, log: silentLog, formatAligned: fmt });
  assert(result.changed && state.isDraft, 'converted to draft at session start');
  assert(result.maintainerDraft?.actor === 'ilyar', 'recognised as the maintainer draft');
  const ready = await ensurePullRequestIsReady({ ...pr, $, log: silentLog, formatAligned: fmt });
  assert(ready.reason === 'left_in_draft_on_purpose' && state.isDraft, 'stays a draft at session end');
  assert(getOutstandingWorkingSessionDrafts().length === 0, 'no working-session obligation');
});

await test('the maintainer marking it ready again ends the maintainer draft', async () => {
  const state = session2State();
  state.timeline.push(['ready_for_review', 'ilyar', '2026-09-24T20:00:00Z']);
  const $ = makeFakeDollar(state);
  assert((await findMaintainerDraftConversion({ ...pr, $ })) === null, 'maintainer readied it');
});

await test('a draft made by hive-mind itself is still converted back (issue #2182 unchanged)', async () => {
  const state = {
    isDraft: true,
    self: 'konard',
    timeline: [
      ['ready_for_review', 'konard', '2026-09-23T22:26:18Z'],
      ['convert_to_draft', 'konard', '2026-09-25T03:29:11Z'],
    ],
  };
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsDraft({ ...pr, $, log: silentLog, formatAligned: fmt });
  assert(!result.maintainerDraft && getPullRequestLeftInDraft(pr) === null, 'not a maintainer draft');
  const ready = await ensurePullRequestIsReady({ ...pr, $, log: silentLog, formatAligned: fmt });
  assert(ready.changed === true && state.isDraft === false, 'converted back to ready');
});

await test('a timeline lookup failure never blocks the session', async () => {
  const state = { ...session2State(), timelineFails: true };
  const $ = makeFakeDollar(state);
  const result = await ensurePullRequestIsDraft({ ...pr, $, log: silentLog, formatAligned: fmt });
  assert(result.ok && !result.maintainerDraft, 'falls back to the #2182 behaviour');
  assert(getOutstandingWorkingSessionDrafts().length === 1, 'tracked as a working-session draft');
});

await test('a PR opened as draft (no transition events) is not a maintainer draft', async () => {
  const $ = makeFakeDollar({ isDraft: true, self: 'konard', timeline: [] });
  assert((await findMaintainerDraftConversion({ ...pr, $ })) === null, 'no conversion');
});

await test('the session start comment does not promise to mark a maintainer draft ready', async () => {
  const postedBodies = async () => {
    const bodies = [];
    const $ = options => (options && options.stdin ? () => (bodies.push(JSON.parse(options.stdin).body), Promise.resolve({ code: 0, stdout: '{"id":1}', stderr: '' })) : Promise.resolve({ code: 0, stdout: '', stderr: '' }));
    await postWorkSessionStartComment({ ...pr, $, log: silentLog, formatAligned: fmt, sessionType: SESSION_TYPES.NEW, resolveRuntime: async () => null });
    return bodies.join('\n');
  };
  assert((await postedBodies()).includes('converted to draft mode while work is in progress'), 'default wording unchanged');
  await ensurePullRequestIsDraft({ ...pr, $: makeFakeDollar(session2State()), log: silentLog, formatAligned: fmt });
  const body = await postedBodies();
  assert(body.includes('The PR stays a draft: @ilyar converted it to draft'), `got: ${body}`);
});

await test('every system prompt tells the AI not to override a maintainer draft and to use "Part of #N"', async () => {
  const files = ['claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini'].map(tool => `src/${tool}.prompts.lib.mjs`).concat(['src/locales/en.lino']);
  for (const file of files) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert(source.includes('unless a maintainer converted the pull request to draft or requested changes'), `${file}: maintainer draft guidance`);
    assert(source.includes('"Part of #N" instead of a closing keyword'), `${file}: partial-scope guidance`);
  }
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
