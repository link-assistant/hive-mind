#!/usr/bin/env node
// Issue #3469: compute the sourceDigest a given hive-mind src tree gives for the current PR feedback,
// once with nothing tracked (template process) and once per tracked comment ID set (guard process).
// Usage: node experiments/installed-guard-digest-3469.mjs <hive-mind/src> <issue.json> <pr-comments.json> [id,id...]...
import fs from 'node:fs';
import path from 'node:path';

const [src, issuePath, commentsPath, ...trackedSets] = process.argv.slice(2);
const { requirementFeedback, requirementSourceDigest } = await import(path.resolve(src, 'issue-requirements.lib.mjs'));
const { trackToolCommentId, resetTrackedToolCommentIds } = await import(path.resolve(src, 'tool-comments.lib.mjs'));
const issue = JSON.parse(fs.readFileSync(issuePath, 'utf8'));
const feedback = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));
const source = { title: issue.title, body: issue.body || '', comments: [], feedback };
for (const set of ['', ...trackedSets]) {
  resetTrackedToolCommentIds();
  for (const id of set.split(',').filter(Boolean)) trackToolCommentId(id);
  console.log(
    `tracked [${set}]:`,
    requirementSourceDigest(source),
    'feedback ids',
    requirementFeedback(feedback).map(c => c.id)
  );
}
