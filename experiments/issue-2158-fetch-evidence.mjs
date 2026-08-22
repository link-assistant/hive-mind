#!/usr/bin/env node

/**
 * Rebuild the public evidence bundle for the issue 2158 case study.
 *
 * Gist contents are fetched through `gh gist view` so authenticated/private
 * GitHub access keeps working. Only comments created after PR 2155 merged are
 * treated as new reproductions; older runs already live in the issue 2130 and
 * issue 2146 case studies.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const OUTPUT_ROOT = new URL('../docs/case-studies/issue-2158/data/', import.meta.url);
const NEW_REPRODUCTION_CUTOFF = '2026-08-13T07:51:00Z';

const hiveMindIssues = [2158, 2154, 2146, 2119, 2130, 2059];
const hiveMindPullRequests = [2159, 2155, 2147, 2131, 2120, 2108];
const formalAiIssues = [1001, 904, 905, 907, 848];
const externalRepositories = ['test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b', 'test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c', 'test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a'];

function runGh(args, options = {}) {
  return execFileSync('gh', args, {
    encoding: options.binary ? null : 'utf8',
    maxBuffer: 128 * 1024 * 1024,
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
  writeJson(`github/${stem}-comments.json`, apiJson(`repos/${repository}/issues/${number}/comments`));
  writeJson(`github/${stem}-events.json`, apiJson(`repos/${repository}/issues/${number}/events`));
}

function snapshotPullRequest(repository, number, stem) {
  writeJson(`github/${stem}.json`, runGhJson(['pr', 'view', String(number), '--repo', repository, '--json', 'number,title,body,state,isDraft,author,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,createdAt,updatedAt,closedAt,mergedAt,commits,files,statusCheckRollup,url']));
  const conversationComments = apiJson(`repos/${repository}/issues/${number}/comments`);
  writeJson(`github/${stem}-conversation-comments.json`, conversationComments);
  writeJson(`github/${stem}-review-comments.json`, apiJson(`repos/${repository}/pulls/${number}/comments`));
  writeJson(`github/${stem}-reviews.json`, apiJson(`repos/${repository}/pulls/${number}/reviews`));
  return conversationComments;
}

function gistReference(comment) {
  const match = comment.body?.match(/https:\/\/gist\.githubusercontent\.com\/[^/]+\/(?<id>[0-9a-f]+)\/raw\/(?<revision>[0-9a-f]+)\/(?<file>[^)\s]+)/u);
  if (!match?.groups) return null;
  return { ...match.groups, url: match[0] };
}

function sanitizeLog(source) {
  const sanitized = source
    .toString('utf8')
    .replace(/\buser\.account_id="[^"]*"/gu, 'user.account_id="[REDACTED]"')
    .replace(/\buser\.email="[^"]*"/gu, 'user.email="[REDACTED]"')
    .replace(/\/tmp\/gh-issue-solver-\d+/gu, '<workspace>')
    .replace(/\/tmp\/(?:codex_prompt|codex_last_message)_\d+_\d+\.txt/gu, '<codex-temp-file>')
    .replace(/\/home\/box\/\.cache\/hive-mind\/formal-ai\/[^\s"',)]+/gu, '<formal-ai-config>')
    .replace(/\b(?:github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}\b/gu, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{20,}\b/gu, 'Bearer [REDACTED]');
  return Buffer.from(sanitized, 'utf8');
}

function downloadNewLogs(repository, comments) {
  const shortName = repository.split('/').at(-1);
  const outputDirectory = join(OUTPUT_ROOT.pathname, 'tool-logs', shortName);
  mkdirSync(outputDirectory, { recursive: true });

  const index = [];
  for (const comment of comments) {
    if (comment.created_at <= NEW_REPRODUCTION_CUTOFF) continue;
    const gist = gistReference(comment);
    if (!gist) continue;

    const sourceRaw = runGh(['gist', 'view', gist.id, '--raw'], { binary: true });
    const raw = sanitizeLog(sourceRaw);
    const compressed = gzipSync(raw, { level: 9 });
    const timestamp = comment.created_at.replaceAll(':', '').replace('.000Z', 'Z');
    const relativePath = `tool-logs/${shortName}/${timestamp}-${gist.id}.log.gz`;
    const destination = join(OUTPUT_ROOT.pathname, relativePath);
    writeFileSync(destination, compressed);

    index.push({
      repository,
      pullRequest: 2,
      commentUrl: comment.html_url,
      createdAt: comment.created_at,
      heading: comment.body.split('\n')[0],
      gistId: gist.id,
      gistRevision: gist.revision,
      gistFile: gist.file,
      sourceUrl: gist.url,
      path: relativePath,
      sourceRawBytes: sourceRaw.length,
      sourceRawSha256: createHash('sha256').update(sourceRaw).digest('hex'),
      rawBytes: raw.length,
      gzipBytes: compressed.length,
      rawSha256: createHash('sha256').update(raw).digest('hex'),
      gzipSha256: createHash('sha256').update(compressed).digest('hex'),
    });
  }
  return index;
}

mkdirSync(OUTPUT_ROOT, { recursive: true });

for (const issue of hiveMindIssues) {
  snapshotIssue('link-assistant/hive-mind', issue, `hive-mind-issue-${issue}`);
}
for (const pullRequest of hiveMindPullRequests) {
  snapshotPullRequest('link-assistant/hive-mind', pullRequest, `hive-mind-pr-${pullRequest}`);
}
for (const issue of formalAiIssues) {
  snapshotIssue('link-assistant/formal-ai', issue, `formal-ai-issue-${issue}`);
}

const logIndex = [];
for (const repositoryName of externalRepositories) {
  const repository = `konard/${repositoryName}`;
  const stem = `${repositoryName}`;
  snapshotIssue(repository, 1, `${stem}-issue-1`);
  const comments = snapshotPullRequest(repository, 2, `${stem}-pr-2`);
  logIndex.push(...downloadNewLogs(repository, comments));
}

writeJson('tool-logs/index.json', {
  generatedAt: new Date().toISOString(),
  cutoff: NEW_REPRODUCTION_CUTOFF,
  reason: 'PR 2155 merged at the cutoff; earlier reproductions are preserved by the issue 2130 and 2146 case studies.',
  count: logIndex.length,
  logs: logIndex,
});

process.stdout.write(`Downloaded ${logIndex.length} post-PR-2155 sanitized logs.\n`);
