#!/usr/bin/env node
/**
 * Reproduction for issue #1825: "Failed to add .gitkeep".
 *
 * When the target repository's .gitignore matches `.gitkeep`, the auto-PR
 * creation step runs `git add .gitkeep`, which exits non-zero with
 * "The following paths are ignored by one of your .gitignore files", and the
 * solver aborts with FATAL ERROR: PR creation failed.
 *
 * This script demonstrates:
 *   1. Plain `git add .gitkeep` fails (exit code 1) when .gitkeep is ignored.
 *   2. `git check-ignore .gitkeep` confirms the file is ignored (exit code 0).
 *   3. `git add -f .gitkeep` succeeds and stages the file (the fix).
 */

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;
const os = (await use('os')).default;

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-1825-'));
await $({ cwd: tempDir })`git init -q`;
await $({ cwd: tempDir })`git config user.email "test@example.com"`;
await $({ cwd: tempDir })`git config user.name "Test User"`;

// Simulate rumaster/tg-games: .gitignore matches .gitkeep
await fs.writeFile(path.join(tempDir, '.gitignore'), '.gitkeep\n');
await $({ cwd: tempDir })`git add .gitignore`;
await $({ cwd: tempDir })`git commit -q -m "Add gitignore that ignores .gitkeep"`;

// Solver writes the placeholder .gitkeep
await fs.writeFile(path.join(tempDir, '.gitkeep'), '# placeholder for PR creation\n');

console.log('=== Step 1: plain `git add .gitkeep` (current code) ===');
const plain = await $({ cwd: tempDir })`git add .gitkeep`;
console.log(`exit code: ${plain.code}`);
console.log(`stderr: ${(plain.stderr ? plain.stderr.toString() : '').trim()}`);
console.log(`-> reproduces bug: ${plain.code !== 0 ? 'YES (add failed)' : 'NO'}`);

console.log('\n=== Step 2: `git check-ignore .gitkeep` ===');
const checkIgnore = await $({ cwd: tempDir, silent: true })`git check-ignore .gitkeep`;
console.log(`exit code: ${checkIgnore.code} (0 means ignored)`);

console.log('\n=== Step 3: `git add -f .gitkeep` (the fix) ===');
const forced = await $({ cwd: tempDir })`git add -f .gitkeep`;
console.log(`exit code: ${forced.code}`);
const status = await $({ cwd: tempDir })`git status --short`;
console.log(`git status --short: ${status.stdout.toString().trim() || '(empty)'}`);
console.log(`-> fix works: ${forced.code === 0 && status.stdout.toString().includes('.gitkeep') ? 'YES (staged)' : 'NO'}`);

await fs.rm(tempDir, { recursive: true, force: true });
