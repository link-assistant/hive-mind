#!/usr/bin/env node

/**
 * Regression tests for issue #1825: "Failed to add .gitkeep".
 *
 * When the target repository's .gitignore matches the auto-PR placeholder
 * (e.g. rumaster/tg-games ignores `.gitkeep`), the auto-PR creation step ran
 * `git add .gitkeep`, which exits non-zero with "The following paths are
 * ignored by one of your .gitignore files", and the solver aborted with the
 * generic "FATAL ERROR: PR creation failed".
 *
 * Follow-up behaviour (issue #1825 comment): instead of silently forcing the
 * placeholder through, the solver now explains the root cause and offers two
 * opt-in flags:
 *   - default                         → action 'blocked' (caller explains + stops)
 *   - --force-git-keep-commit         → action 'forced' (git add -f)
 *   - --remove-git-keep-from-git-ignore → action 'removed-from-gitignore'
 *
 * These tests verify each branch of addPlaceholderFileToGit /
 * removePlaceholderFromGitignore / stagePlaceholderFileOrExplain.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

// Use use-m to dynamically import command-stream (matches the rest of the suite).
const use = await ensureUseM();

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

const { addPlaceholderFileToGit, removePlaceholderFromGitignore, stagePlaceholderFileOrExplain } = await import('../src/solve.auto-pr-placeholder.lib.mjs');

async function createTestRepo({ gitignore } = {}) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-issue-1825-'));
  await $({ cwd: tempDir })`git init -q`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;
  if (gitignore) {
    await fs.writeFile(path.join(tempDir, '.gitignore'), gitignore);
    await $({ cwd: tempDir })`git add .gitignore`;
    await $({ cwd: tempDir })`git commit -q -m "Add .gitignore"`;
  }
  return tempDir;
}

async function statusShort(tempDir) {
  const result = await $({ cwd: tempDir })`git status --short`;
  return result.stdout ? result.stdout.toString().trim() : '';
}

test('plain git add .gitkeep fails when the repo gitignores it (reproduces the bug)', async () => {
  const tempDir = await createTestRepo({ gitignore: '.gitkeep\n' });
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const plain = await $({ cwd: tempDir })`git add .gitkeep`;
    assert.notEqual(plain.code, 0, 'plain `git add .gitkeep` should fail for an ignored path');
    assert.equal(await statusShort(tempDir), '', 'nothing should be staged by the failed add');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('default behaviour: addPlaceholderFileToGit blocks (does NOT force) a gitignored placeholder', async () => {
  const tempDir = await createTestRepo({ gitignore: '.gitkeep\n' });
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep' });

    assert.equal(result.action, 'blocked', 'the placeholder should be blocked by default');
    assert.notEqual(result.code, 0, 'the add should report failure so the caller stops');
    assert.equal(result.ignored, true, 'placeholder should be detected as gitignored');
    assert.equal(await statusShort(tempDir), '', 'nothing should be staged when blocked');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('--force-git-keep-commit: addPlaceholderFileToGit force-adds a gitignored .gitkeep', async () => {
  const tempDir = await createTestRepo({ gitignore: '.gitkeep\n' });
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep', forceGitKeepCommit: true });

    assert.equal(result.code, 0, 'force-add should succeed');
    assert.equal(result.action, 'forced', 'placeholder should be reported as force-added');
    assert.equal(result.ignored, true, 'placeholder should be detected as gitignored');
    assert.match(await statusShort(tempDir), /\.gitkeep/, '.gitkeep should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('--force-git-keep-commit: addPlaceholderFileToGit force-adds a gitignored CLAUDE.md', async () => {
  const tempDir = await createTestRepo({ gitignore: 'CLAUDE.md\n' });
  try {
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), '# task details\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: 'CLAUDE.md', forceGitKeepCommit: true });

    assert.equal(result.code, 0, 'force-add should succeed');
    assert.equal(result.action, 'forced', 'placeholder should be reported as force-added');
    assert.equal(result.ignored, true, 'placeholder should be detected as gitignored');
    assert.match(await statusShort(tempDir), /CLAUDE\.md/, 'CLAUDE.md should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('--remove-git-keep-from-git-ignore: strips the literal entry then adds normally', async () => {
  const tempDir = await createTestRepo({ gitignore: 'node_modules/\n.gitkeep\n*.log\n' });
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep', removeGitKeepFromGitIgnore: true });

    assert.equal(result.code, 0, 'add should succeed after removing the ignore entry');
    assert.equal(result.action, 'removed-from-gitignore', 'placeholder should be reported as removed-from-gitignore');
    assert.equal(result.removal.removed, true, 'removal should report success');
    assert.match(await statusShort(tempDir), /\.gitkeep/, '.gitkeep should be staged');

    const ignore = await fs.readFile(path.join(tempDir, '.gitignore'), 'utf8');
    assert.ok(!/^\.gitkeep$/m.test(ignore), '.gitkeep entry should be removed from .gitignore');
    assert.match(ignore, /node_modules\//, 'unrelated entries should be preserved');
    assert.match(ignore, /\*\.log/, 'unrelated entries should be preserved');
    assert.match(await statusShort(tempDir), /\.gitignore/, 'the edited .gitignore should also be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('--remove-git-keep-from-git-ignore: refuses to remove a glob rule (reports remove-failed)', async () => {
  // A repo that ignores all dotfiles via a glob would also catch .gitkeep, but
  // removing the glob could un-ignore unrelated files, so we refuse.
  const tempDir = await createTestRepo({ gitignore: '.git*\n!.gitignore\n' });
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep', removeGitKeepFromGitIgnore: true });

    assert.equal(result.action, 'remove-failed', 'a glob rule should not be auto-removed');
    assert.notEqual(result.code, 0, 'the add should still report failure');
    assert.equal(result.ignored, true, 'placeholder should still be detected as gitignored');
    assert.equal(result.removal.removed, false, 'removal should report failure for a glob rule');
    assert.equal(await statusShort(tempDir), '', 'nothing should be staged when removal is refused');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('addPlaceholderFileToGit adds normally (action "added") when the placeholder is not ignored', async () => {
  const tempDir = await createTestRepo();
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep' });

    assert.equal(result.code, 0, 'add should succeed');
    assert.equal(result.action, 'added', 'a non-ignored file should be added normally');
    assert.equal(result.ignored, false, 'placeholder should not be detected as gitignored');
    assert.match(await statusShort(tempDir), /\.gitkeep/, '.gitkeep should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('removePlaceholderFromGitignore removes the literal entry and stages the .gitignore', async () => {
  const tempDir = await createTestRepo({ gitignore: '.gitkeep\n' });
  try {
    const result = await removePlaceholderFromGitignore({ $, tempDir, fileName: '.gitkeep' });

    assert.equal(result.removed, true, 'literal entry should be removed');
    assert.deepEqual(result.modifiedFiles, ['.gitignore'], 'the .gitignore file should be reported as modified');
    assert.deepEqual(result.stagedFiles, ['.gitignore'], 'the .gitignore file should be staged');

    const stillIgnored = await $({ cwd: tempDir })`git check-ignore .gitkeep`;
    assert.notEqual(stillIgnored.code, 0, '.gitkeep should no longer be ignored');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('stagePlaceholderFileOrExplain throws a user-facing error when the placeholder is blocked', async () => {
  const tempDir = await createTestRepo({ gitignore: '.gitkeep\n' });
  const logs = [];
  const log = async msg => {
    logs.push(typeof msg === 'string' ? msg : String(msg));
  };
  const formatAligned = (icon, label, value) => `${icon} ${label} ${value ?? ''}`;
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    await assert.rejects(
      () =>
        stagePlaceholderFileOrExplain({
          $,
          tempDir,
          fileName: '.gitkeep',
          log,
          formatAligned,
          issueUrl: 'https://github.com/owner/repo/issues/1',
        }),
      err => {
        assert.equal(err.hiveMindUserFacingLogged, true, 'the error should be flagged as already logged');
        assert.match(err.message, /\.gitignore/, 'the error should mention .gitignore');
        return true;
      }
    );

    const joined = logs.join('\n');
    assert.match(joined, /Root cause/, 'the explanation should include a root-cause section');
    assert.match(joined, /--force-git-keep-commit/, 'the explanation should mention the force flag');
    assert.match(joined, /--remove-git-keep-from-git-ignore/, 'the explanation should mention the remove flag');
    // Environment-agnostic: both `solve` and `/solve` invocations are shown.
    assert.match(joined, /\bsolve https:\/\/github.com\/owner\/repo\/issues\/1/, 'should show the solve command');
    assert.match(joined, /\/solve https:\/\/github.com\/owner\/repo\/issues\/1/, 'should show the /solve command');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('stagePlaceholderFileOrExplain returns normally when the placeholder is not ignored', async () => {
  const tempDir = await createTestRepo();
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await stagePlaceholderFileOrExplain({ $, tempDir, fileName: '.gitkeep' });

    assert.equal(result.code, 0, 'add should succeed');
    assert.equal(result.action, 'added', 'a non-ignored file should be added normally');
    assert.match(await statusShort(tempDir), /\.gitkeep/, '.gitkeep should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
