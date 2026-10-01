#!/usr/bin/env node
// Replays the PR #2336 description against main's and this branch's parser.
// Usage: node experiments/issue-2335-pr2336-self-misdetection.mjs <body.md> [<main-linking.mjs>]
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { extractLinkedIssueNumber, resolvePrimaryIssueNumber } from '../src/github-linking.lib.mjs';

const body = await readFile(process.argv[2], 'utf8');
if (process.argv[3]) {
  const main = await import(pathToFileURL(process.argv[3]).href);
  console.log('main extractLinkedIssueNumber:', main.extractLinkedIssueNumber(body));
}
console.log('branch extractLinkedIssueNumber:', extractLinkedIssueNumber(body, 'link-assistant', 'hive-mind'));
console.log('branch resolvePrimaryIssueNumber:', resolvePrimaryIssueNumber({ body, branch: 'issue-2335-d92d19d37a1b', owner: 'link-assistant', repo: 'hive-mind' }));
