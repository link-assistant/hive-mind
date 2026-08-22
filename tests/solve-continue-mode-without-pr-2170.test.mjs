#!/usr/bin/env node
/**
 * Regression coverage for issue #2170.
 *
 * `--auto-continue` has two distinct outcomes: it can resume an existing pull
 * request, and it can resume a leftover `issue-<n>-<hash>` branch that never
 * got a pull request. Both return `isContinueMode: true`, but the second one
 * returns `prNumber: null`.
 *
 * The #2158 fix started building the "Your prepared Pull Request" URL from
 * `owner/repo/prNumber` as soon as continue mode was active. In the second
 * outcome that call threw
 *   TypeError: A GitHub pull request URL requires owner, repo, and a positive integer number
 * right after branch checkout, so the run died before `handleAutoPrCreation`
 * had the chance to create the missing pull request.
 *
 * Run with: node tests/solve-continue-mode-without-pr-2170.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2170
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildGitHubPullRequestUrl, buildGitHubPullRequestUrlOrNull } from '../src/github-url-parser.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('buildGitHubPullRequestUrlOrNull returns null instead of throwing when the PR does not exist yet', () => {
  assert.equal(buildGitHubPullRequestUrlOrNull({ owner: 'konard', repo: 'hive-mind', number: 2171 }), 'https://github.com/konard/hive-mind/pull/2171');
  assert.equal(buildGitHubPullRequestUrlOrNull({ owner: 'konard', repo: 'hive-mind', number: '2171' }), 'https://github.com/konard/hive-mind/pull/2171');

  // The exact shape auto-continue returns for a reused branch without a PR.
  assert.equal(buildGitHubPullRequestUrlOrNull({ owner: 'Payel-git-ol', repo: 'Octra', number: null }), null);
  assert.equal(buildGitHubPullRequestUrlOrNull({ owner: 'Payel-git-ol', repo: 'Octra', number: undefined }), null);
  assert.equal(buildGitHubPullRequestUrlOrNull({ owner: 'Payel-git-ol', repo: 'Octra', number: 0 }), null);
  assert.equal(buildGitHubPullRequestUrlOrNull(), null);
});

test('buildGitHubPullRequestUrl names the missing part so a stack trace is actionable', () => {
  assert.throws(
    () => buildGitHubPullRequestUrl({ owner: 'Payel-git-ol', repo: 'Octra', number: null }),
    error => {
      assert.ok(error instanceof TypeError);
      assert.match(error.message, /owner="Payel-git-ol"/);
      assert.match(error.message, /repo="Octra"/);
      assert.match(error.message, /number=null/);
      return true;
    }
  );

  assert.throws(() => buildGitHubPullRequestUrl({ repo: 'Octra', number: 3 }), /owner=undefined/);
});

test('solve.mjs builds the continue-mode PR URL through the non-throwing helper', () => {
  const source = readFileSync(join(repoRoot, 'src', 'solve.mjs'), 'utf8');
  assert.match(source, /prUrl = githubLib\.buildGitHubPullRequestUrlOrNull\(\{ owner, repo, number: prNumber \}\)/, 'the continue-mode branch must not use the throwing builder');
  assert.ok(!/prUrl = githubLib\.buildGitHubPullRequestUrl\(/.test(source), 'no continue-mode assignment may use the throwing builder');
});

/**
 * Reproduce the auto-continue result that triggered the crash, using a fake
 * `gh` on PATH: one matching branch exists in the main repo, and no pull
 * request exists for the issue or for that branch.
 */
test('auto-continue resumes a branch with no pull request and the solve.mjs guard survives it', async () => {
  const binDir = mkdtempSync(join(tmpdir(), 'hive-mind-2170-gh-'));
  const ghPath = join(binDir, 'gh');
  writeFileSync(ghPath, ['#!/bin/sh', 'case "$*" in', '  *branches*) echo "master"; echo "issue-179-a1e31889c902"; exit 0 ;;', '  *) echo "[]"; exit 0 ;;', 'esac', ''].join('\n'));
  chmodSync(ghPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${binDir}:${previousPath}`;
  try {
    const { processAutoContinueForIssue } = await import('../src/solve.auto-continue.lib.mjs');
    const result = await processAutoContinueForIssue({ autoContinue: true, fork: false, verbose: false }, true, 179, 'Payel-git-ol', 'Octra');

    assert.equal(result.isContinueMode, true, 'the leftover branch must be reused');
    assert.equal(result.prBranch, 'issue-179-a1e31889c902');
    assert.equal(result.prNumber, null, 'this is the state that used to crash solve.mjs');

    // solve.mjs continue-mode block, applied to that exact state.
    const prUrl = buildGitHubPullRequestUrlOrNull({ owner: 'Payel-git-ol', repo: 'Octra', number: result.prNumber });
    assert.equal(prUrl, null, 'the run must continue with prUrl unset until handleAutoPrCreation creates the PR');
  } finally {
    process.env.PATH = previousPath;
  }
});
