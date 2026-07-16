#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Tests for issue #401: --auto-delete-branch-on-merge option in --watch mode.
 *
 * Verifies that:
 *   1. The option is registered in SOLVE_OPTION_DEFINITIONS as a boolean default-false flag.
 *   2. The option is documented in docs/CONFIGURATION.md (and the localized variants).
 *   3. The branch-deletion code path is gated on both `argv.autoDeleteBranchOnMerge` and the
 *      run NOT being in temporary-watch (auto-restart) mode, and uses the GitHub REST API
 *      via `gh api .../git/refs/heads/<branch> -X DELETE`.
 *   4. Auto-merge mode passes the same option through to `gh pr merge --delete-branch`.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const extractOptionRow = (md, option) => md.split('\n').find(line => line.includes(`\`${option}\``)) || '';

const run = async (name, fn) => {
  process.stdout.write(`Testing ${name}... `);
  try {
    await fn();
    console.log('PASSED');
    passed++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
    failed++;
  }
};

await run('--auto-delete-branch-on-merge option is registered as boolean defaulting to false', async () => {
  const def = SOLVE_OPTION_DEFINITIONS['auto-delete-branch-on-merge'];
  assert(def, 'auto-delete-branch-on-merge should exist in SOLVE_OPTION_DEFINITIONS');
  assert(def.type === 'boolean', `expected type=boolean, got ${def.type}`);
  assert(def.default === false, `expected default=false, got ${def.default}`);
  assert(typeof def.description === 'string' && def.description.length > 0, 'description should be set');
  assert(/watch/i.test(def.description), 'description should mention watch mode');
  assert(/auto-merge/i.test(def.description), 'description should mention auto-merge mode');
});

await run('option is documented in docs/CONFIGURATION.md (English)', async () => {
  const md = readFileSync(join(repoRoot, 'docs', 'CONFIGURATION.md'), 'utf8');
  const row = extractOptionRow(md, '--auto-delete-branch-on-merge');
  assert(row, 'CONFIGURATION.md should mention the option');
  assert(row.includes('--auto-merge'), 'CONFIGURATION.md should document auto-merge support');
});

await run('option is documented in localized CONFIGURATION docs', async () => {
  for (const file of ['docs/CONFIGURATION.ru.md', 'docs/CONFIGURATION.zh.md', 'docs/CONFIGURATION.hi.md']) {
    const md = readFileSync(join(repoRoot, file), 'utf8');
    const row = extractOptionRow(md, '--auto-delete-branch-on-merge');
    assert(row, `${file} should mention the option`);
    assert(row.includes('--auto-merge'), `${file} should document auto-merge support`);
  }
});

await run('solve.watch.lib.mjs guards branch deletion on watch mode and the option flag', async () => {
  const src = readFileSync(join(repoRoot, 'src', 'solve.watch.lib.mjs'), 'utf8');
  assert(src.includes('argv.autoDeleteBranchOnMerge'), 'should reference argv.autoDeleteBranchOnMerge');
  assert(src.includes('!isTemporaryWatch'), 'should exclude temporary-watch (auto-restart) mode');
  assert(/gh api repos\/\$\{owner\}\/\$\{repo\}\/git\/refs\/heads\/\$\{branchName\} -X DELETE/.test(src), 'should call GitHub refs DELETE endpoint');
  assert(src.includes("context: 'delete_branch_on_merge'"), 'should report deletion failures to Sentry');
});

await run('deletion gracefully handles "Reference does not exist" / 404 / 422 (already deleted)', async () => {
  const src = readFileSync(join(repoRoot, 'src', 'solve.watch.lib.mjs'), 'utf8');
  assert(/Reference does not exist|Not Found|422|404/.test(src), 'should treat "branch already gone" responses as success');
  assert(src.includes('Branch already removed'), 'should log a friendly message when the branch was already deleted');
});

await run('auto-merge mode passes --auto-delete-branch-on-merge to mergePullRequest', async () => {
  const src = readFileSync(join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
  assert(src.includes('argv.autoDeleteBranchOnMerge'), 'auto-merge code should read argv.autoDeleteBranchOnMerge');
  assert(src.includes('shouldDeleteBranchAfterMerge(argv)'), 'auto-merge code should normalize the branch cleanup flag');
  assert((src.match(/deleteAfter: deleteAfterMerge/g) || []).length >= 2, 'both auto-merge call paths should pass deleteAfter from the normalized flag');
  assert(src.includes('Branch cleanup:'), 'auto-merge code should log when branch cleanup is enabled');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
