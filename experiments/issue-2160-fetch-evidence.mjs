#!/usr/bin/env node

/**
 * Rebuild the public evidence bundle for the issue 2160 case study.
 *
 * Issue 2160 reports one `/hive` run against link-assistant/router that ended with
 * `❌ 4 task(s) failed (completed: 6)`. The evidence therefore has three parts:
 *
 *  1. the run's own log, attached to the issue as a Gist (23 MB raw, stored gzipped);
 *  2. the Hive Mind issue/PR metadata (what was reported and how it was fixed);
 *  3. the target repository's issues and pull requests, which is the only way to tell a
 *     genuine failure from a false negative — six issues were reported as "(no PR found)"
 *     while their pull requests had already been merged.
 *
 * Gist contents are fetched through `gh gist view` so authenticated access keeps working.
 * The committed log copy is sanitized; the pre-sanitization byte count and SHA-256 are
 * recorded so an authorized investigator can compare with the original.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUTPUT_ROOT = new URL('../docs/case-studies/issue-2160/data/', import.meta.url);

const HIVE_MIND = 'link-assistant/hive-mind';
const TARGET = 'link-assistant/router';

/** The reported run and the fix for it. */
const hiveMindIssues = [2160];
const hiveMindPullRequests = [2162];

/** Every issue the run picked up, in the order hive queued them. */
const targetIssues = [186, 187, 188, 189, 190, 191, 192, 193, 194, 195];

/**
 * #196-#201 are the solution drafts `--auto-merge` merged during the run (the ones the final
 * summary claimed did not exist); #202 is the follow-up run that solved the four issues this
 * run could not attempt.
 */
const targetPullRequests = [196, 197, 198, 199, 200, 201, 202];

/** The run log attached to issue 2160. */
const runLog = {
  gistId: 'b2ecad7f7eb5bf43ac726254943afc8c',
  gistRevision: 'e9a04a390eef2b10f379a3a49316f3cbd3487554',
  gistFile: 'tmp-start-command-logs-isolation-docker-4c1dedd8-a645-479c-84ce-72a0f8d7d179.log.txt',
  executionId: '4c1dedd8-a645-479c-84ce-72a0f8d7d179',
  startedAt: '2026-08-16T17:27:00Z',
  finishedAt: '2026-08-16T21:17:42Z',
};

function runGh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: options.binary ? null : 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runGhJson(args) {
  return JSON.parse(runGh(args));
}

function writeJson(relativePath, value) {
  const destination = join(OUTPUT_ROOT.pathname, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

function apiJson(path) {
  return runGhJson(['api', path, '--paginate']);
}

function snapshotIssue(repository, number, stem) {
  writeJson(`github/${stem}.json`, runGhJson(['issue', 'view', String(number), '--repo', repository, '--json', 'number,title,body,state,author,labels,assignees,createdAt,updatedAt,closedAt,url']));
  const comments = apiJson(`repos/${repository}/issues/${number}/comments`);
  writeJson(`github/${stem}-comments.json`, comments);
  writeJson(`github/${stem}-events.json`, apiJson(`repos/${repository}/issues/${number}/events`));
  return comments;
}

function snapshotPullRequest(repository, number, stem) {
  writeJson(`github/${stem}.json`, runGhJson(['pr', 'view', String(number), '--repo', repository, '--json', 'number,title,body,state,isDraft,author,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,createdAt,updatedAt,closedAt,mergedAt,commits,files,statusCheckRollup,url']));
  writeJson(`github/${stem}-conversation-comments.json`, apiJson(`repos/${repository}/issues/${number}/comments`));
  writeJson(`github/${stem}-review-comments.json`, apiJson(`repos/${repository}/pulls/${number}/comments`));
  writeJson(`github/${stem}-reviews.json`, apiJson(`repos/${repository}/pulls/${number}/reviews`));
}

/**
 * Redact account identifiers, credential-shaped strings, and volatile host paths. Workspace
 * paths keep their solver id (`<workspace:NNN>`) because the case study needs to distinguish
 * one worker's workspace from another's while reconstructing the disk-exhaustion timeline.
 */
function sanitizeLog(source) {
  const sanitized = source
    .toString('utf8')
    .replace(/\buser\.account_id="[^"]*"/gu, 'user.account_id="[REDACTED]"')
    .replace(/\buser\.email="[^"]*"/gu, 'user.email="[REDACTED]"')
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/gu, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{20,}\b/gu, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/gu, '[REDACTED]')
    .replace(/\/tmp\/gh-issue-solver-(\d+)/gu, '<workspace:$1>');
  return Buffer.from(sanitized, 'utf8');
}

function downloadRunLog() {
  const sourceRaw = runGh(['gist', 'view', runLog.gistId, '--raw'], { binary: true });
  const raw = sanitizeLog(sourceRaw);
  const compressed = gzipSync(raw, { level: 9, mtime: 0 });
  const relativePath = `run-logs/hive-run-${runLog.executionId}.log.gz`;
  writeFileSync(join(OUTPUT_ROOT.pathname, relativePath), compressed);
  return {
    description: 'Full `/hive` run log attached to issue 2160 (verbose mode, 2 workers, 10 issues)',
    issueUrl: `https://github.com/${HIVE_MIND}/issues/2160`,
    sourceUrl: `https://gist.githubusercontent.com/konard/${runLog.gistId}/raw/${runLog.gistRevision}/${runLog.gistFile}`,
    ...runLog,
    path: relativePath,
    lines: raw.toString('utf8').split('\n').length,
    sourceRawBytes: sourceRaw.length,
    sourceRawSha256: createHash('sha256').update(sourceRaw).digest('hex'),
    rawBytes: raw.length,
    rawSha256: createHash('sha256').update(raw).digest('hex'),
    gzipBytes: compressed.length,
    gzipSha256: createHash('sha256').update(compressed).digest('hex'),
  };
}

mkdirSync(new URL('run-logs/', OUTPUT_ROOT), { recursive: true });

for (const issue of hiveMindIssues) snapshotIssue(HIVE_MIND, issue, `hive-mind-issue-${issue}`);
for (const pullRequest of hiveMindPullRequests) snapshotPullRequest(HIVE_MIND, pullRequest, `hive-mind-pr-${pullRequest}`);
for (const issue of targetIssues) snapshotIssue(TARGET, issue, `router-issue-${issue}`);
for (const pullRequest of targetPullRequests) snapshotPullRequest(TARGET, pullRequest, `router-pr-${pullRequest}`);

const log = downloadRunLog();
writeJson('run-logs/index.json', {
  generatedAt: new Date().toISOString(),
  count: 1,
  logs: [log],
});

process.stdout.write(`Stored ${log.path} (${log.lines} lines, ${log.rawBytes} raw bytes -> ${log.gzipBytes} gzip bytes).\n`);
