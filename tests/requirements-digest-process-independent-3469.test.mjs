#!/usr/bin/env node
/**
 * Issue #3469: konard.github.io#4 and hive-mind#3470 stayed blocked with "issue description or review
 * feedback changed after verification" although nothing changed. The report template
 * (issue-requirements-snapshot.mjs, a fresh process) kept solve's own "🤖 **AI Work Session Started**"
 * comment as feedback; the merge guard, inside the solve that posted it, dropped it by its tracked ID.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { requirementFeedback, requirementSourceDigest } from '../src/issue-requirements.lib.mjs';
import { isToolStatusComment, resetTrackedToolCommentIds, trackToolCommentId } from '../src/tool-comments.lib.mjs';
import { getSessionCommentContent, SESSION_TYPES } from '../src/solve.session.lib.mjs';
import { buildFinishedWithoutChangesComment, buildSessionEffectUnverifiedComment } from '../src/session-changes.lib.mjs';
import { buildNoChangesProducedComment } from '../src/solve.session-comments.lib.mjs';
import { buildWorkflowPushRejectedComment } from '../src/workflow-push-rejection.lib.mjs';

const data = name => JSON.parse(readFileSync(fileURLToPath(new URL(`../docs/case-studies/issue-3469/data/${name}`, import.meta.url)), 'utf8'));

test('the template and the guard compute the same digest for PR #3470', () => {
  const issue = data('issue-3469.json');
  const source = { title: issue.title, body: issue.body, feedback: data('pr-3470-comments.json') };
  resetTrackedToolCommentIds();
  const template = requirementSourceDigest(source);
  trackToolCommentId(6233039365); // the start comment the guard's own solve posted
  const guard = requirementSourceDigest(source);
  resetTrackedToolCommentIds();
  assert.equal(guard, template);
  assert.deepEqual(requirementFeedback(source.feedback), [], 'every comment on PR #3470 is hive-mind bookkeeping');
});

test('session and outcome notices are recognized by their content', () => {
  const at = new Date('2026-10-17T10:52:27.736Z');
  const sessions = Object.values(SESSION_TYPES).map(type => {
    const { emoji, header, description } = getSessionCommentContent(type, at);
    return `${emoji} **${header}**\n\n${description}`;
  });
  const notices = [...sessions, '🤖 **AI Work Session Completed**\n\nEnded at 2026-10-17T13:48:44Z.', buildFinishedWithoutChangesComment({ reason: 'x' }), buildSessionEffectUnverifiedComment({ reason: 'x' }), buildNoChangesProducedComment(), buildWorkflowPushRejectedComment({ workflow: '.github/workflows/ci.yml', credential: 'token' }), '⏳ **Usage Limit Reached - Waiting to Continue**\n\n**Reset time:** 5pm', '<!-- hive-mind:closing-references-left-out a/b#1 -->\n⚠️ **Closing references left out**'];
  for (const body of notices) assert.ok(isToolStatusComment(body), body);
});

test('a person quoting a notice is still feedback', () => {
  for (const body of ['The **AI Work Session Started** comment came twice.', '**AI Work Session Started** but nothing happened', '🤖 **AI Work Session Started?** Please fix the docs first.']) assert.equal(isToolStatusComment(body), false, body);
});
