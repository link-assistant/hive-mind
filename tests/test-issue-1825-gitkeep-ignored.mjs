#!/usr/bin/env node

/**
 * Regression tests for issue #1825: "Failed to add .gitkeep".
 *
 * When the target repository's .gitignore matches the auto-PR placeholder
 * (e.g. rumaster/tg-games ignores `.gitkeep`), the auto-PR creation step ran
 * `git add .gitkeep`, which exits non-zero with "The following paths are
 * ignored by one of your .gitignore files", and the solver aborted with
 * "FATAL ERROR: PR creation failed".
 *
 * The fix routes placeholder staging through addPlaceholderFileToGit, which
 * confirms the path is git-ignored via `git check-ignore` and retries with
 * `git add -f`. The placeholder is created by the solver to seed the initial
 * commit and is removed when the task completes, so force-adding is safe.
 *
 * @hive-mind-test-suite default
 */

// Use use-m to dynamically import command-stream (matches the rest of the suite).
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

import assert from 'node:assert/strict';
import test from 'node:test';

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

const { addPlaceholderFileToGit } = await import('../src/solve.auto-pr-placeholder.lib.mjs');

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

test('addPlaceholderFileToGit force-adds .gitkeep when it is gitignored', async () => {
  const tempDir = await createTestRepo({ gitignore: '.gitkeep\n' });
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep' });

    assert.equal(result.code, 0, 'force-add should succeed');
    assert.equal(result.forced, true, 'placeholder should be reported as force-added');
    assert.equal(result.ignored, true, 'placeholder should be detected as gitignored');
    assert.match(await statusShort(tempDir), /\.gitkeep/, '.gitkeep should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('addPlaceholderFileToGit force-adds CLAUDE.md when it is gitignored', async () => {
  const tempDir = await createTestRepo({ gitignore: 'CLAUDE.md\n' });
  try {
    await fs.writeFile(path.join(tempDir, 'CLAUDE.md'), '# task details\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: 'CLAUDE.md' });

    assert.equal(result.code, 0, 'force-add should succeed');
    assert.equal(result.forced, true, 'placeholder should be reported as force-added');
    assert.equal(result.ignored, true, 'placeholder should be detected as gitignored');
    assert.match(await statusShort(tempDir), /CLAUDE\.md/, 'CLAUDE.md should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('addPlaceholderFileToGit handles gitignore patterns that match .gitkeep indirectly', async () => {
  // A repo that ignores all dotfiles via a glob would also catch .gitkeep.
  const tempDir = await createTestRepo({ gitignore: '.git*\n!.gitignore\n' });
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep' });

    assert.equal(result.code, 0, 'force-add should succeed for glob-matched ignore');
    assert.equal(result.forced, true, 'placeholder should be reported as force-added');
    assert.match(await statusShort(tempDir), /\.gitkeep/, '.gitkeep should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('addPlaceholderFileToGit adds normally (no force) when the placeholder is not ignored', async () => {
  const tempDir = await createTestRepo();
  try {
    await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder\n');
    const result = await addPlaceholderFileToGit({ $, tempDir, fileName: '.gitkeep' });

    assert.equal(result.code, 0, 'add should succeed');
    assert.equal(result.forced, false, 'no force-add should be needed for a non-ignored file');
    assert.equal(result.ignored, false, 'placeholder should not be detected as gitignored');
    assert.match(await statusShort(tempDir), /\.gitkeep/, '.gitkeep should be staged');
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
