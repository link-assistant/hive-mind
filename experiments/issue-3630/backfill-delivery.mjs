#!/usr/bin/env node
/**
 * Backfill delivery records for E2E evidence recorded before delivery.json
 * existed (run 39505806192). Read-only: it only GETs the task pull request,
 * its files and the comments, through `gh api`.
 *
 *   node experiments/issue-3630/backfill-delivery.mjs <run download dir> <out dir>
 *
 * The pull request's state and draft flag are taken from the recorded
 * "ready for review" assertion, because GitHub now reports the state after
 * cleanup; comments posted after the row finished are left out.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deliveryRecord } from '../../scripts/e2e-evidence.lib.mjs';

const [runDir, outDir] = process.argv.slice(2).map(path => resolve(path));
if (!runDir || !outDir) {
  console.error('usage: backfill-delivery.mjs <run download dir> <out dir>');
  process.exit(2);
}
const api = endpoint => JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', endpoint], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).flat();

mkdirSync(outDir, { recursive: true });
for (const entry of readdirSync(runDir, { withFileTypes: true })) {
  if (!entry.isDirectory() || !entry.name.startsWith('e2e-hello-world-')) continue;
  const result = JSON.parse(readFileSync(join(runDir, entry.name, 'result.json'), 'utf8'));
  const { repository, issueNumber, pullRequestNumber } = result.resources || {};
  if (!pullRequestNumber) {
    console.log(`${entry.name}: no pull request, nothing to backfill`);
    continue;
  }
  const [pull] = api(`repos/${repository}/pulls/${pullRequestNumber}`);
  const judged = result.evaluation?.results?.find(item => item.name === 'ready for review')?.reason?.match(/^state (\w+), (draft|ready)$/);
  const finishedAt = Date.parse(result.finishedAt);
  const comments = [pullRequestNumber, issueNumber].flatMap(number =>
    api(`repos/${repository}/issues/${number}/comments?per_page=100`)
      .filter(comment => Date.parse(comment.created_at) <= finishedAt)
      .map(comment => comment.body)
  );
  const delivery = deliveryRecord({
    issueUrl: result.issueUrl,
    pullRequest: { number: pull.number, url: pull.html_url, state: judged?.[1] ?? pull.state.toUpperCase(), isDraft: judged ? judged[2] === 'draft' : pull.draft, title: pull.title, body: pull.body, headRefName: pull.head.ref, headRefOid: pull.head.sha, baseRefName: pull.base.ref },
    files: result.files,
    changes: api(`repos/${repository}/pulls/${pullRequestNumber}/files?per_page=100`),
    checks: result.execution?.checks,
    comments,
    execution: result.execution,
  });
  delivery.backfilled = { from: 'GitHub REST API', at: new Date().toISOString(), state: judged ? 'recorded "ready for review" assertion' : 'GitHub now', comments: `created at or before ${result.finishedAt}` };
  writeFileSync(join(outDir, `${entry.name}.json`), `${JSON.stringify(delivery, null, 2)}\n`);
  console.log(`${entry.name}: PR #${pull.number}, ${delivery.changes.length} files, ${comments.length} comments`);
}
