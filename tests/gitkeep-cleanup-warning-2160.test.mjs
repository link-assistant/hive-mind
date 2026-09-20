#!/usr/bin/env node

/**
 * Regression test for issue #2160: final cleanup must not warn about a file that legitimately
 * existed before the session.
 *
 * Reported symptom (hive run 4c1dedd8-a645-479c-84ce-72a0f8d7d179, 2 occurrences):
 *   ⚠️  WARNING: .gitkeep still exists after cleanup — attempting direct removal...
 *   ℹ️  .gitkeep existed before this session — keeping pre-existing file
 * The warning and the "this is fine" explanation were emitted back to back — a false positive.
 *
 * Root cause: in src/solve.results.lib.mjs the post-cleanup verification logged the WARNING as
 * soon as `git ls-files <file>` still listed the file, and only afterwards ran the
 * `git cat-file -e <commit>~1:<file>` pre-existence test that decides whether anything is wrong.
 *
 * Fix: run the pre-existence check first; warn only for a real leftover created in this session.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.stack || e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Build a repository that reproduces the reported situation:
 *   - `.gitkeep` is a normal, pre-existing repository file (commit on the base branch)
 *   - the session's initial auto-commit modified it on the work branch
 * so that after the cleanup revert `.gitkeep` is still tracked, but legitimately so.
 */
const buildRepo = ({ preExisting }) => {
  const root = mkdtempSync(join(tmpdir(), 'hm-2160-gitkeep-'));
  const originDir = join(root, 'origin.git');
  const workDir = join(root, 'work');
  mkdirSync(originDir);
  git(originDir, 'init', '--bare', '--initial-branch=main', '.');
  git(root, 'clone', originDir, 'work');

  writeFileSync(join(workDir, 'README.md'), 'base\n');
  if (preExisting) writeFileSync(join(workDir, '.gitkeep'), 'pre-existing\n');
  git(workDir, 'add', '-A');
  git(workDir, 'commit', '-m', 'base commit');
  git(workDir, 'push', 'origin', 'main');

  const branchName = 'issue-2160-test';
  git(workDir, 'checkout', '-b', branchName);
  writeFileSync(join(workDir, '.gitkeep'), 'touched by session\n');
  git(workDir, 'add', '-A');
  git(workDir, 'commit', '-m', 'Initial commit with .gitkeep for PR creation');
  git(workDir, 'push', '-u', 'origin', branchName);
  const claudeCommitHash = git(workDir, 'rev-parse', 'HEAD').trim();

  return { workDir, branchName, claudeCommitHash };
};

/** Run cleanupClaudeFile() while capturing everything it logs. */
const runCleanup = async ({ workDir, branchName, claudeCommitHash }) => {
  const { cleanupClaudeFile } = await import('../src/solve.results.lib.mjs');
  global.verboseMode = true;
  const output = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = chunk => {
    output.push(String(chunk));
    return true;
  };
  try {
    await cleanupClaudeFile(workDir, branchName, claudeCommitHash);
  } finally {
    process.stdout.write = originalWrite;
  }
  return output.join('');
};

console.log('================================================================================');
console.log('Regression: no false "still exists after cleanup" warning (Issue #2160)');
console.log('================================================================================\n');

await test('a pre-existing .gitkeep is kept without a WARNING', async () => {
  const repo = buildRepo({ preExisting: true });
  const output = await runCleanup(repo);
  assert(output.includes('existed before this session'), `cleanup should recognize the pre-existing file, got:\n${output}`);
  assert(!output.includes('still exists after cleanup'), `a pre-existing file must not be reported as a cleanup failure, got:\n${output}`);
  // The file must survive: it belongs to the repository, not to the session.
  const tracked = git(repo.workDir, 'ls-files', '.gitkeep').trim();
  assert(tracked === '.gitkeep', 'the pre-existing .gitkeep must remain tracked');
});

await test('a .gitkeep created by the session is still reported and removed', async () => {
  const repo = buildRepo({ preExisting: false });
  const output = await runCleanup(repo);
  assert(!output.includes('existed before this session'), `the file did not pre-exist, got:\n${output}`);
  const tracked = git(repo.workDir, 'ls-files', '.gitkeep').trim();
  // Either the standard revert already removed it, or the fallback did — but if the fallback
  // path ran, it must have said so.
  if (tracked) {
    assert(output.includes('still exists after cleanup'), `a real leftover must be warned about, got:\n${output}`);
  }
  assert(tracked === '', `a session-created .gitkeep must not survive cleanup, still tracked: ${tracked}`);
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
