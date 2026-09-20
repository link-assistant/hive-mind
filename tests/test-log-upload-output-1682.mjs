#!/usr/bin/env node

/**
 * Regression coverage for issue #1682.
 *
 * The failure mode was a large failure-log upload that completed in
 * gh-upload-log, but Hive Mind posted a PR comment with a `null` log link and
 * then printed a green success check for a failed Codex run.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGhUploadLogOutput } from '../src/log-upload.lib.mjs';
import { selectLogUploadUrl } from '../src/github.lib.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('resolves the issue #1682 public shared-repository upload to a raw URL', () => {
  const output = readFileSync(new URL('../docs/case-studies/issue-1682/logs/gh-upload-log-output-snippet.txt', import.meta.url), 'utf8');
  const uploadResult = {
    success: true,
    ...parseGhUploadLogOutput(output),
  };

  assert.equal(selectLogUploadUrl({ uploadResult, isPublicRepo: true }), 'https://raw.githubusercontent.com/konard/public-logs/main/log-tmp-solution-draft-log-pr-1777111005509.txt/tmp-solution-draft-log-pr-1777111005509.txt');
});

test('returns no URL when gh-upload-log success lacks a usable link', () => {
  assert.equal(
    selectLogUploadUrl({
      uploadResult: {
        success: true,
        url: null,
        rawUrl: null,
        type: 'repository',
        chunks: 1,
      },
      isPublicRepo: true,
    }),
    null
  );
});

test('keeps private repository uploads on a stable repository page URL', () => {
  assert.equal(
    selectLogUploadUrl({
      uploadResult: {
        success: true,
        url: 'https://github.com/konard/private-logs/tree/main/log-private',
        rawUrl: 'https://raw.githubusercontent.com/konard/private-logs/main/log-private/log.txt?token=expires',
        type: 'repository',
        chunks: 1,
      },
      isPublicRepo: false,
    }),
    'https://github.com/konard/private-logs/tree/main/log-private'
  );
});

test('failure-log terminal status is not rendered with a green check mark', () => {
  const solveSource = readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  const githubSource = readFileSync(new URL('../src/github.lib.mjs', import.meta.url), 'utf8');

  assert.equal(solveSource.includes('✅ Failure logs uploaded'), false);
  assert.equal(githubSource.includes('✅ Failure log'), false);
});

let passed = 0;
for (const { name, fn } of tests) {
  await fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

console.log(`\n${passed} issue #1682 log upload tests passed`);
