#!/usr/bin/env node

/**
 * Issue #2187, item B — the image's node symlink must point at the NEWEST
 * installed Node.js, not the first one `ls` happens to print.
 *
 * Every Dockerfile creates `/home/box/.node-bin` -> `<nvm version>/bin` and puts
 * it first on PATH. The original selection was:
 *
 *     NODE_VERSION_DIR=$(ls -d /home/box/.nvm/versions/node/v* | head -1)
 *
 * `ls` sorts lexicographically ascending, so with `v20.20.2` and `v22.23.2`
 * installed it picks v20 — exactly backwards, and silently pins the image to the
 * oldest node the moment a second version appears.
 *
 * This test does not read the Dockerfile for a magic string: it EXTRACTS the
 * selection command from each Dockerfile, points it at a fixture directory
 * holding several versions, and runs it in bash. That way it fails for the real
 * reason (wrong version chosen) rather than for a formatting change.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2187
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert as check, printSummary, getFailCount } from './test-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const DOCKERFILES = ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile'];
const NVM_NODE_ROOT = '/home/box/.nvm/versions/node';

/** The `NODE_VERSION_DIR=$(...)` assignment as written in the Dockerfile. */
const extractNodeSelection = dockerfile => {
  const source = fs.readFileSync(path.join(repoRoot, dockerfile), 'utf8');
  const match = source.match(/NODE_VERSION_DIR=\$\((.+?)\)\s*&&/);
  return match ? match[1] : null;
};

/**
 * Run the extracted selection against a throwaway nvm root containing
 * `versions`, and return the directory it chose.
 */
const runSelection = (selection, versions) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2187-node-'));
  try {
    for (const version of versions) fs.mkdirSync(path.join(root, version, 'bin'), { recursive: true });
    const command = selection.split(NVM_NODE_ROOT).join(root);
    const stdout = execFileSync('bash', ['-c', `echo $(${command})`], { encoding: 'utf8' });
    return path.basename(stdout.trim());
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

for (const dockerfile of DOCKERFILES) {
  const selection = extractNodeSelection(dockerfile);
  check(Boolean(selection), `${dockerfile}: has a NODE_VERSION_DIR selection command`);
  if (!selection) continue;

  // The reported case: two versions installed, `head -1` picks v20.
  check(runSelection(selection, ['v20.20.2', 'v22.23.2']) === 'v22.23.2', `${dockerfile}: picks v22.23.2 over v20.20.2`);

  // Lexicographic sorting also breaks on single-digit majors: "v9" > "v22" as
  // text, so a plain `sort | tail -1` would be just as wrong as `head -1`.
  check(runSelection(selection, ['v9.11.2', 'v20.20.2', 'v22.23.2']) === 'v22.23.2', `${dockerfile}: version-sorts rather than text-sorts (v22 beats v9)`);

  // Patch-level ordering must be numeric too: v22.9.0 is older than v22.23.2.
  check(runSelection(selection, ['v22.9.0', 'v22.23.2']) === 'v22.23.2', `${dockerfile}: compares patch levels numerically (v22.23.2 beats v22.9.0)`);

  // A single installed version is still selected (no regression for the image
  // as it is built today).
  check(runSelection(selection, ['v24.14.0']) === 'v24.14.0', `${dockerfile}: selects the only installed version`);
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
