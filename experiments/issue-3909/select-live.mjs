#!/usr/bin/env node
/**
 * Issue #3909, reproduced against live GitHub data, without Docker.
 *
 * Shows the drift the issue is about — the Formal AI version baked into the
 * Hive Mind image (Dockerfile's FORMAL_AI_VERSION) against Formal AI's main
 * head now — and what admission selects for each mode with the real lookups
 * (`gh api`). Nothing is built, pulled or written.
 *
 *   node experiments/issue-3909/select-live.mjs [issue-number]
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ATTEMPT_MODES, AttemptIdentityError, describeAttempt } from '../../scripts/formal-ai-draft-identity.lib.mjs';
import { createGitHubSelectDeps, readHiveSource, selectAttempt } from '../../scripts/formal-ai-draft-select.lib.mjs';
import { gh } from '../../scripts/github-actions.lib.mjs';

const run = async (file, args) => (await promisify(execFile)(file, args, { encoding: 'utf8' })).stdout;
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const issue = Number(process.argv[2] || 3909);

const baked = /^ARG FORMAL_AI_VERSION=(\S+)$/m.exec(readFileSync(`${root}/Dockerfile`, 'utf8'))?.[1];
const hive = await readHiveSource({ root, repository: 'link-assistant/hive-mind', git: args => run('git', args), readFile: path => readFileSync(path, 'utf8') });
const deps = createGitHubSelectDeps({ gh, hashFile: async () => null, binaryVersion: async () => '' });
console.log(`Hive Mind ${hive.version} at ${hive.sourceSha}; its image ${hive.image} bakes Formal AI ${baked}`);

for (const mode of [ATTEMPT_MODES.liveCurrent, ATTEMPT_MODES.publishedRelease, ATTEMPT_MODES.historicalReplay]) {
  try {
    const identity = await selectAttempt({ mode, repository: 'link-assistant/hive-mind', issue, hive, selected: { at: new Date().toISOString() }, deps });
    console.log(`\n${mode}: ${describeAttempt(identity)}`);
    console.log(`  formalAi: ${JSON.stringify(identity.formalAi)}`);
    if (identity.formalAi.version && baked && identity.formalAi.version !== baked) console.log(`  drift: the image-baked binary (${baked}) is not what this attempt runs (${identity.formalAi.version})`);
  } catch (error) {
    console.log(`\n${mode}: ${error instanceof AttemptIdentityError ? `${error.outcome}: ` : ''}${error.message}`);
  }
}
