#!/usr/bin/env node
// Issue #3469: the merge guard and the report template must compute the same sourceDigest.
// The template runs as a fresh process (issue-requirements-snapshot.mjs); the guard runs inside
// solve, which remembers the IDs of comments it posted itself. Usage:
//   node experiments/requirements-digest-process-dependence-3469.mjs [comments.json] [tracked-id]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commentsPath = process.argv[2] || path.join(root, 'docs/case-studies/issue-3469/data/pr-3470-comments.json');
const trackedId = process.argv[3] || '6233039365'; // "🤖 AI Work Session Started", posted by the solve that ran the guard
const { requirementFeedback, requirementSourceDigest } = await import(path.join(root, 'src/issue-requirements.lib.mjs'));
const { trackToolCommentId, resetTrackedToolCommentIds } = await import(path.join(root, 'src/tool-comments.lib.mjs'));
const issue = JSON.parse(fs.readFileSync(path.join(root, 'docs/case-studies/issue-3469/data/issue-3469.json'), 'utf8'));
const feedback = JSON.parse(fs.readFileSync(commentsPath, 'utf8'));
const source = { title: issue.title, body: issue.body || '', comments: [], feedback };

resetTrackedToolCommentIds();
const fresh = requirementSourceDigest(source);
console.log(
  'template process (nothing tracked):',
  fresh,
  'feedback ids',
  requirementFeedback(feedback).map(c => c.id)
);
trackToolCommentId(trackedId);
const guard = requirementSourceDigest(source);
console.log(
  `guard process (tracked ${trackedId}):`,
  guard,
  'feedback ids',
  requirementFeedback(feedback).map(c => c.id)
);
console.log(fresh === guard ? 'OK: same digest in both processes' : 'MISMATCH: the guard reports "issue description or review feedback changed after verification"');
process.exitCode = fresh === guard ? 0 : 1;
