#!/usr/bin/env node
/**
 * Reproduction for issue #1722.
 *
 * The /merge command swallowed a `stdout maxBuffer length exceeded` error in
 * getActiveBranchRuns() and treated it as "branch is idle", merging on top of
 * a still-running CI run on main.
 *
 * Run with: node experiments/issue-1722-buffer-overflow.mjs
 *
 * On a repo whose `main` branch has accumulated >1 MB of workflow run JSON
 * (typical for any moderately active repo) the unfiltered query overflows the
 * default 1 MB exec maxBuffer.
 *
 * The status-filtered query stays small regardless of history because it only
 * returns currently active runs.
 */

import { promisify } from 'util';
import { exec as execCb } from 'child_process';

const exec = promisify(execCb);

const owner = process.env.OWNER || 'link-assistant';
const repo = process.env.REPO || 'hive-mind';
const branch = process.env.BRANCH || 'main';

console.log(`Target: ${owner}/${repo} branch=${branch}\n`);

// --- 1. Reproduce the bug: unfiltered query, default maxBuffer ---
console.log('1) Unfiltered query with default maxBuffer (1 MB)…');
try {
  const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=100" --paginate --slurp`);
  console.log(`   OK — ${stdout.length} bytes (no overflow this time)`);
} catch (error) {
  console.log(`   REPRODUCED: ${error.message}`);
}

// --- 2. Same query, raised maxBuffer ---
console.log('\n2) Unfiltered query with 50 MB maxBuffer…');
try {
  const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=100" --paginate --slurp`, { maxBuffer: 50 * 1024 * 1024 });
  console.log(`   OK — ${stdout.length} bytes`);
} catch (error) {
  console.log(`   FAILED: ${error.message}`);
}

// --- 3. Server-side status filter (the recommended fix) ---
console.log('\n3) Server-side status filters (recommended fix)…');
const statuses = ['in_progress', 'queued', 'waiting', 'requested', 'pending'];
let totalActive = 0;
for (const status of statuses) {
  try {
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&status=${status}&per_page=100" --paginate --slurp`);
    const pages = JSON.parse(stdout.trim() || '[]');
    const count = pages.flatMap(p => p.workflow_runs || []).length;
    totalActive += count;
    console.log(`   status=${status.padEnd(11)} → ${count} run(s), ${stdout.length} bytes`);
  } catch (error) {
    console.log(`   status=${status.padEnd(11)} → ERROR: ${error.message}`);
  }
}
console.log(`\n   Total active runs: ${totalActive}`);
