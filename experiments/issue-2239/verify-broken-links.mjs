#!/usr/bin/env node
/**
 * Issue #2239 — live evidence that the links published on Godmy/frontend#2 are
 * broken, and that the same files resolve in the fork the branch lives in.
 *
 * Run: node experiments/issue-2239/verify-broken-links.mjs
 * Requires an authenticated `gh`. Read-only; nothing is modified.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const BASE_REPO = 'Godmy/frontend';
const HEAD_REPO = 'konard/Godmy-frontend'; // the log names it konard/frontend; that is a rename alias GitHub still redirects
const BRANCH = 'issue-1-46ba053c';
const SHOTS = ['graph-force.png', 'graph-sankey.png', 'graph-network.png'];

const probe = async (repo, path) => {
  try {
    const { stdout } = await run('gh', ['api', `repos/${repo}/contents/${path}?ref=${BRANCH}`, '--jq', '.sha']);
    return { ok: true, detail: stdout.trim().slice(0, 12) };
  } catch (error) {
    const stderr = `${error.stderr ?? error.message}`.trim().split('\n')[0];
    return { ok: false, detail: stderr };
  }
};

console.log(`Branch under test: ${BRANCH}`);
console.log(`Pull request lives in: ${BASE_REPO} (the URLs that were published)`);
console.log(`Branch actually lives in: ${HEAD_REPO}\n`);

let brokenAsPublished = 0;
let presentInFork = 0;

for (const shot of SHOTS) {
  const path = `docs/screenshots/${shot}`;
  const asPublished = await probe(BASE_REPO, path);
  const inFork = await probe(HEAD_REPO, path);
  if (!asPublished.ok) brokenAsPublished++;
  if (inFork.ok) presentInFork++;
  console.log(`${path}`);
  console.log(`  ${BASE_REPO.padEnd(18)} ${asPublished.ok ? '200' : '404'}  ${asPublished.detail}`);
  console.log(`  ${HEAD_REPO.padEnd(18)} ${inFork.ok ? '200' : '404'}  ${inFork.detail}`);
}

console.log(`\n${brokenAsPublished}/${SHOTS.length} published links are broken; ${presentInFork}/${SHOTS.length} resolve in the fork.`);
console.log(brokenAsPublished === SHOTS.length && presentInFork === SHOTS.length ? '→ Reproduces issue #2239: every link points at the repository that does not hold the branch.' : '→ Did not reproduce (the upstream branch may since have been created, or the fork deleted).');
