#!/usr/bin/env node
/**
 * Issue #2239 — point the repair at the real broken pull request, read-only.
 *
 * `dryRun: true` plans every repair and performs no PATCH, so this can be run
 * against Godmy/frontend#2 (or any pull request) without editing anything. It
 * is the end-to-end check that the offline regression test in
 * `tests/test-pr-image-link-repair-2239.mjs` stands in for.
 *
 *   node experiments/issue-2239/dry-run-repair.mjs [owner] [repo] [prNumber]
 *
 * Requires an authenticated `gh`.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { repairPullRequestBodyLinks } from '../../src/pr-image-link-repair.lib.mjs';

const execFileAsync = promisify(execFile);

// A minimal command-stream-shaped `$`: this experiment only needs the tagged
// template form, and building it from execFile keeps the script dependency-free.
const $ = (strings, ...values) => {
  const command = strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');
  const args = command.trim().split(/\s+/).slice(1);
  return execFileAsync('gh', args)
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch(error => ({ code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? String(error) }));
};

const [owner = 'Godmy', repo = 'frontend', prNumber = '2'] = process.argv.slice(2);

const stats = await repairPullRequestBodyLinks({ $, owner, repo, prNumber, log: async line => console.log(line), verbose: true, dryRun: true });

console.log(`\n${owner}/${repo}#${prNumber}: ${stats.scanned} GitHub link(s) scanned.`);
for (const repair of stats.repairs) console.log(`  WOULD FIX  ${repair.from}\n         ->  ${repair.to}  (${repair.occurrences} occurrence(s))`);
for (const skip of stats.skipped) console.log(`  LEFT ALONE ${skip.url}  (${skip.reason})`);
console.log(`\nNothing was edited: dryRun is on.`);
