#!/usr/bin/env node

/**
 * Regression tests for issue #1791.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const { cleanupClaudeFile } = await import('../src/solve.results.lib.mjs');

const BRANCH_NAME = 'issue-1791-test';

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createGitFixture() {
  const root = mkdtempSync(join(tmpdir(), 'hive-issue-1791-'));
  const repo = join(root, 'repo');
  const origin = join(root, 'origin.git');

  mkdirSync(repo);
  git(root, ['init', '--bare', '-q', origin]);
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  git(repo, ['checkout', '-q', '-b', BRANCH_NAME]);
  git(repo, ['remote', 'add', 'origin', origin]);

  return { root, repo };
}

function commitAll(repo, message) {
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function pushBranch(repo) {
  git(repo, ['push', '-q', 'origin', `${BRANCH_NAME}:${BRANCH_NAME}`]);
}

test('cleanup does not re-add .gitkeep after a later PR commit deleted it', async () => {
  const { root, repo } = createGitFixture();

  try {
    const originalGitkeep = '# .gitkeep file auto-generated at old time\n';
    writeFileSync(join(repo, '.gitkeep'), originalGitkeep);
    writeFileSync(join(repo, 'README.md'), '# Test repository\n');
    commitAll(repo, 'Base commit with existing .gitkeep');

    writeFileSync(join(repo, '.gitkeep'), `${originalGitkeep}# Updated: initial session\n`);
    const initialCommitHash = commitAll(repo, 'Initial commit with task details');

    rmSync(join(repo, '.gitkeep'));
    writeFileSync(join(repo, 'README.md'), '# Test repository\n\nActual work.\n');
    commitAll(repo, 'Remove root .gitkeep as part of repository cleanup');
    pushBranch(repo);

    await cleanupClaudeFile(repo, BRANCH_NAME, initialCommitHash);

    assert.equal(existsSync(join(repo, '.gitkeep')), false);
    assert.equal(git(repo, ['status', '--short']), '');
    assert.doesNotMatch(git(repo, ['log', '--format=%s', '--', '.gitkeep']), /Revert: Remove \.gitkeep changes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup skips .gitkeep when a later PR commit touched it even if the final content matches the initial commit', async () => {
  const { root, repo } = createGitFixture();

  try {
    const originalGitkeep = '# pre-existing placeholder\n';
    writeFileSync(join(repo, '.gitkeep'), originalGitkeep);
    writeFileSync(join(repo, 'README.md'), '# Test repository\n');
    commitAll(repo, 'Base commit with existing .gitkeep');

    const initialGitkeep = `${originalGitkeep}# Updated: initial session\n`;
    writeFileSync(join(repo, '.gitkeep'), initialGitkeep);
    const initialCommitHash = commitAll(repo, 'Initial commit with task details');

    writeFileSync(join(repo, '.gitkeep'), `${initialGitkeep}# Work touched this file\n`);
    commitAll(repo, 'Touch .gitkeep during repository cleanup');

    writeFileSync(join(repo, '.gitkeep'), initialGitkeep);
    commitAll(repo, 'Restore .gitkeep content intentionally');
    pushBranch(repo);

    await cleanupClaudeFile(repo, BRANCH_NAME, initialCommitHash);

    assert.equal(readFileSync(join(repo, '.gitkeep'), 'utf8'), initialGitkeep);
    assert.equal(git(repo, ['status', '--short']), '');
    assert.doesNotMatch(git(repo, ['log', '-1', '--format=%s']), /Revert: Remove \.gitkeep changes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cleanup still restores a pre-existing .gitkeep when only the auto initial commit touched it', async () => {
  const { root, repo } = createGitFixture();

  try {
    const originalGitkeep = '# pre-existing placeholder\n';
    writeFileSync(join(repo, '.gitkeep'), originalGitkeep);
    writeFileSync(join(repo, 'README.md'), '# Test repository\n');
    commitAll(repo, 'Base commit with existing .gitkeep');

    writeFileSync(join(repo, '.gitkeep'), `${originalGitkeep}# Updated: initial session\n`);
    const initialCommitHash = commitAll(repo, 'Initial commit with task details');

    writeFileSync(join(repo, 'README.md'), '# Test repository\n\nActual work.\n');
    commitAll(repo, 'Add actual work');
    pushBranch(repo);

    await cleanupClaudeFile(repo, BRANCH_NAME, initialCommitHash);

    assert.equal(readFileSync(join(repo, '.gitkeep'), 'utf8'), originalGitkeep);
    assert.equal(git(repo, ['status', '--short']), '');
    assert.match(git(repo, ['log', '-1', '--format=%s']), /Revert/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
