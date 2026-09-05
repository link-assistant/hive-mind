#!/usr/bin/env node

/**
 * Issue #2211 — reproduction 1: an updated pre-existing `.gitkeep` is not
 * recognised as the solver's placeholder.
 *
 * The diff below is the real, unmodified diff of
 * https://github.com/konard/audio-decomposer/pull/3 (archived in
 * docs/case-studies/issue-2211/data/audio-decomposer/pr-3.diff).
 *
 * That pull request contained nothing but the solver's own placeholder touch,
 * yet `getPullRequestChangeStats()` reported one changed file, so
 * `watchUntilMergeable()` never saw an empty pull request, never started the
 * auto-restart/resume sequence, and auto-merged it.
 *
 * Run: node experiments/issue-2211/reproduce-placeholder-not-detected.mjs
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { __measureDiffForTests as measureDiff } from '../../src/pull-request-changes.lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', '..', 'docs', 'case-studies', 'issue-2211', 'data', 'audio-decomposer');

for (const prNumber of [2, 3]) {
  const diff = await readFile(join(dataDir, `pr-${prNumber}.diff`), 'utf8');
  const stats = measureDiff(diff);
  console.log(`konard/audio-decomposer#${prNumber}:`, JSON.stringify(stats));
  console.log(`  hasChanges     : ${stats.filesChanged > 0}  (expected false — the diff is only the placeholder)`);
  console.log(`  placeholderOnly: ${stats.filesChanged === 0 && stats.placeholderSections > 0}  (expected true)`);
  console.log('');
}
