#!/usr/bin/env node
/**
 * Reproduction + behaviour demo for issue #1825: "Failed to add .gitkeep".
 *
 * When the target repository's .gitignore matches `.gitkeep`, the auto-PR
 * creation step runs `git add .gitkeep`, which exits non-zero with
 * "The following paths are ignored by one of your .gitignore files", and the
 * solver used to abort with FATAL ERROR: PR creation failed.
 *
 * This script demonstrates the follow-up behaviour (issue #1825 comment):
 *   1. Plain `git add .gitkeep` fails (exit code 1) when .gitkeep is ignored.
 *   2. Default: addPlaceholderFileToGit returns action 'blocked' (no force) so
 *      the caller can explain the root cause and stop cleanly.
 *   3. --force-git-keep-commit: returns action 'forced' (git add -f) and stages.
 *   4. --remove-git-keep-from-git-ignore: strips the literal .gitkeep entry from
 *      .gitignore, then stages normally (action 'removed-from-gitignore').
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

const { addPlaceholderFileToGit } = await import('../src/solve.auto-pr-placeholder.lib.mjs');

async function freshRepo(gitignore) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-1825-'));
  await $({ cwd: tempDir })`git init -q`;
  await $({ cwd: tempDir })`git config user.email "test@example.com"`;
  await $({ cwd: tempDir })`git config user.name "Test User"`;
  await fs.writeFile(path.join(tempDir, '.gitignore'), gitignore);
  await $({ cwd: tempDir })`git add .gitignore`;
  await $({ cwd: tempDir })`git commit -q -m "Add gitignore"`;
  await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder for PR creation\n');
  return tempDir;
}

async function status(tempDir) {
  const s = await $({ cwd: tempDir })`git status --short`;
  return (s.stdout ? s.stdout.toString() : '').trim() || '(empty)';
}

// Simulate rumaster/tg-games: .gitignore matches .gitkeep
const repo1 = await freshRepo('.gitkeep\n');

console.log('=== Step 1: plain `git add .gitkeep` (the original bug) ===');
const plain = await $({ cwd: repo1 })`git add .gitkeep`;
console.log(`exit code: ${plain.code}`);
console.log(`-> reproduces bug: ${plain.code !== 0 ? 'YES (add failed)' : 'NO'}`);

console.log('\n=== Step 2: default behaviour (no flags) ===');
const blocked = await addPlaceholderFileToGit({ $, tempDir: repo1, fileName: '.gitkeep' });
console.log(`action: ${blocked.action} | code: ${blocked.code} | ignored: ${blocked.ignored}`);
console.log(`git status: ${await status(repo1)}`);
console.log(`-> blocked (no force): ${blocked.action === 'blocked' ? 'YES' : 'NO'}`);
await fs.rm(repo1, { recursive: true, force: true });

console.log('\n=== Step 3: --force-git-keep-commit ===');
const repo2 = await freshRepo('.gitkeep\n');
const forced = await addPlaceholderFileToGit({ $, tempDir: repo2, fileName: '.gitkeep', forceGitKeepCommit: true });
console.log(`action: ${forced.action} | code: ${forced.code}`);
console.log(`git status: ${await status(repo2)}`);
console.log(`-> force works: ${forced.action === 'forced' && forced.code === 0 ? 'YES (staged)' : 'NO'}`);
await fs.rm(repo2, { recursive: true, force: true });

console.log('\n=== Step 4: --remove-git-keep-from-git-ignore ===');
const repo3 = await freshRepo('node_modules/\n.gitkeep\n*.log\n');
const removed = await addPlaceholderFileToGit({ $, tempDir: repo3, fileName: '.gitkeep', removeGitKeepFromGitIgnore: true });
console.log(`action: ${removed.action} | code: ${removed.code} | removed: ${removed.removal?.removed}`);
console.log(`git status: ${await status(repo3)}`);
console.log(`.gitignore now:\n${(await fs.readFile(path.join(repo3, '.gitignore'), 'utf8')).trim()}`);
console.log(`-> remove works: ${removed.action === 'removed-from-gitignore' && removed.code === 0 ? 'YES (staged)' : 'NO'}`);
await fs.rm(repo3, { recursive: true, force: true });
