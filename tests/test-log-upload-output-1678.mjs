#!/usr/bin/env node

/**
 * Regression coverage for issue #1678.
 *
 * The failure mode was:
 * 1. a large --attach-logs upload used gh-upload-log,
 * 2. gh-upload-log failed,
 * 3. Hive Mind posted a truncated GitHub comment anyway.
 *
 * These tests keep the parser compatible with gh-upload-log v0.8 shared
 * repository output and verify the truncated-comment fallback is gone.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGhUploadLogOutput } from '../src/log-upload.lib.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('parses gh-upload-log v0.8 shared repository output', () => {
  const output = `
✅ Repository created (🌐 public)
🔗 https://github.com/konard/public-logs/tree/main/log-tmp-solution-draft-log-pr-1777069676373-txt
📄 https://raw.githubusercontent.com/konard/public-logs/main/log-tmp-solution-draft-log-pr-1777069676373-txt/tmp-solution-draft-log-pr-1777069676373.txt

Details:
  Type: 📦 Repository
  Visibility: public
  File count: 1
  Repository: public-logs
  Path: log-tmp-solution-draft-log-pr-1777069676373-txt
`;

  assert.deepEqual(parseGhUploadLogOutput(output), {
    url: 'https://github.com/konard/public-logs/tree/main/log-tmp-solution-draft-log-pr-1777069676373-txt',
    rawUrl: 'https://raw.githubusercontent.com/konard/public-logs/main/log-tmp-solution-draft-log-pr-1777069676373-txt/tmp-solution-draft-log-pr-1777069676373.txt',
    type: 'repository',
    chunks: 1,
    repositoryName: 'public-logs',
    repositoryPath: 'log-tmp-solution-draft-log-pr-1777069676373-txt',
  });
});

test('parses multi-file repository uploads as multiple chunks', () => {
  const output = `
✅ Repository created (🔒 private)
🔗 https://github.com/konard/private-logs/tree/main/log-large

Details:
  Type: 📦 Repository
  Visibility: private
  File count: 3
  Repository: private-logs
  Path: log-large
`;

  assert.deepEqual(parseGhUploadLogOutput(output), {
    url: 'https://github.com/konard/private-logs/tree/main/log-large',
    rawUrl: null,
    type: 'repository',
    chunks: 3,
    repositoryName: 'private-logs',
    repositoryPath: 'log-large',
  });
});

test('keeps legacy dedicated repository output compatible', () => {
  const output = `
✅ Repository created (🔒 private)
🔗 https://github.com/konard/log-tmp-start-command-logs-isolation-screen-78003ab5
📄 https://raw.githubusercontent.com/konard/log-tmp-start-command-logs-isolation-screen-78003ab5/main/tmp-start-command-logs-isolation-screen-78003ab5.log?token=example
⚠️  Note: Raw URL token expires in ~10 minutes for private repositories
`;

  assert.deepEqual(parseGhUploadLogOutput(output), {
    url: 'https://github.com/konard/log-tmp-start-command-logs-isolation-screen-78003ab5',
    rawUrl: 'https://raw.githubusercontent.com/konard/log-tmp-start-command-logs-isolation-screen-78003ab5/main/tmp-start-command-logs-isolation-screen-78003ab5.log?token=example',
    type: 'repository',
    chunks: 1,
    repositoryName: null,
    repositoryPath: null,
  });
});

test('attachLogToGitHub no longer contains a truncated-log fallback', () => {
  const githubLibSource = readFileSync(new URL('../src/github.lib.mjs', import.meta.url), 'utf8');

  assert.equal(githubLibSource.includes('Falling back to truncated comment'), false);
  assert.equal(githubLibSource.includes('Log was truncated'), false);
  assert.equal(githubLibSource.includes('attachTruncatedLog'), false);
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

console.log(`\n${passed} issue #1678 log upload tests passed`);
