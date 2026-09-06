#!/usr/bin/env node

/**
 * Issue #2212 — preview what `solve <repository-url>` (repository mode) would do.
 *
 * Run: node examples/solve-repository-mode-preview.mjs https://github.com/owner/repo
 *
 * Repository mode collects every open issue of a repository, creates one
 * combined issue that lists them as GitHub native sub-issues, and solves that
 * issue — so a single pull request can close all of them at once.
 *
 * This example runs the exact same collection step with `dryRun: true`, so it
 * reads the repository through `gh api` but creates nothing. Use it to see
 * which issues would be attached (and which would be left out, since GitHub
 * allows at most 100 sub-issues per parent issue) before starting a real run.
 *
 * Requires an authenticated `gh` (`gh auth status`).
 */

import { resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';

const url = process.argv[2];

if (!url) {
  console.error('Usage: node examples/solve-repository-mode-preview.mjs <repository-url>');
  console.error('Example: node examples/solve-repository-mode-preview.mjs https://github.com/link-assistant/hive-mind');
  process.exit(1);
}

const result = await resolveRepositoryModeTarget({
  url,
  dryRun: true,
  log: async message => console.log(message),
});

if (!result.handled) {
  console.error(`Not a repository URL: ${url}`);
  console.error('Repository mode only triggers on URLs like https://github.com/owner/repo.');
  console.error('An issue or pull request URL is solved the normal way.');
  process.exit(1);
}

if (result.error) {
  console.error(`Error: ${result.error}`);
  process.exit(1);
}

const { prepared } = result;

console.log('');
console.log('--- combined issue that would be created ---');
console.log('');
console.log(`Title: ${prepared.title}`);
console.log('');
console.log(prepared.body);

console.log('');
console.log('--- what a real run would do next ---');
console.log('');
console.log(`1. Create that issue in ${prepared.repository.fullName}.`);
console.log(`2. Attach ${prepared.selected.length} issue(s) to it as GitHub native sub-issues (one request per second).`);
if (prepared.skipped > 0) {
  console.log(`   ${prepared.skipped} newer issue(s) would be left out: GitHub allows at most ${prepared.limit} sub-issues per parent.`);
}
console.log('3. Solve that issue with --deep-analysis and --ensure-all-sub-issues-addressed,');
console.log('   which restarts the AI tool until the pull request description closes every sub-issue.');
console.log('');
console.log('Nothing was created by this preview.');
