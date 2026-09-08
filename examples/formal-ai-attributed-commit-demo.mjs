#!/usr/bin/env node

/**
 * Issue #2229 — watch a commit become one formal-ai's self-hosting metric can
 * attribute.
 *
 * Builds a throwaway repository, prepares an attribution session exactly as a
 * `solve --model formal-ai` run does, then commits with the environment the
 * session hands to the agent process — plain `git commit -m`, nothing else.
 * The commit that results is read back the way the metric reads it: the
 * trailers from its message, the evidence from its own tree.
 *
 * Usage: node examples/formal-ai-attributed-commit-demo.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFormalAiAttributionSession, FORMAL_AI_TRAILER_KEYS } from '../src/formal-ai-attribution.lib.mjs';
import { readFormalAiVersion } from '../src/formal-ai.lib.mjs';

const ISSUE = 2229;
const SESSION = 'ses_demo0001';
const PR_URL = `https://github.com/link-assistant/hive-mind/pull/2230`;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-attribution-demo-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo, { recursive: true });

const git = (args, env = {}) => {
  try {
    return String(execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    return `${error.stdout || ''}${error.stderr || ''}`;
  }
};

git(['init', '--quiet', '--initial-branch', 'main']);
git(['config', 'user.email', 'formal-ai@example.com']);
git(['config', 'user.name', 'Formal AI']);
fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
git(['add', 'README.md']);
git(['commit', '--quiet', '-m', 'chore: initial']);

// The version is the one the trailer records; a host without the binary still
// gets a runnable demo.
const version = (await readFormalAiVersion()) || '0.345.0';

const session = createFormalAiAttributionSession({
  repositoryPath: repo,
  issueNumber: ISSUE,
  prUrl: PR_URL,
  version,
  model: 'formal-ai',
  tool: 'agent',
  flushRecordThreshold: 1,
  log: async line => console.log(`   ${line}`),
});

console.log('\n1. Preparing the session (this is what solve does before the Agent CLI starts)');
const prepared = await session.prepare();
console.log(`   enabled: ${prepared.enabled}`);
console.log(`   git env: ${Object.keys(prepared.env).sort().join(', ')}`);

console.log('\n2. The Agent CLI reports its session and streams its work');
await session.noteSessionId(SESSION);
await session.recordStreamEvent({ type: 'session.started', sessionID: SESSION, providerID: 'formalai', modelID: 'formal-ai' });
await session.recordStreamEvent({ type: 'text', text: 'Teaching the parser about ranges.' });

console.log('\n3. The model commits — an ordinary commit, with the environment it was given');
fs.writeFileSync(path.join(repo, 'parser.mjs'), 'export const parseRange = value => value.split("..");\n');
git(['add', 'parser.mjs'], session.gitEnv);
git(['commit', '--quiet', '-m', 'feat: teach the parser about ranges'], session.gitEnv);

console.log('\n4. What the metric sees, read out of the commit itself');
const sha = git(['rev-parse', 'HEAD']).trim();
console.log(`   commit ${sha.slice(0, 8)}`);
for (const key of Object.values(FORMAL_AI_TRAILER_KEYS)) {
  console.log(`   ${key}: ${git(['show', '-s', `--format=%(trailers:key=${key},valueonly)`, sha]).trim() || '(missing)'}`);
}
const evidence = git(['show', '-s', `--format=%(trailers:key=${FORMAL_AI_TRAILER_KEYS.evidence},valueonly)`, sha]).trim();
console.log(`\n   files under ${evidence} in this commit's tree:`);
for (const file of git(['ls-tree', '-r', '--name-only', sha, '--', evidence]).trim().split('\n').filter(Boolean)) {
  console.log(`     ${file}`);
}
console.log(`\n   ${evidence}/session-id.txt:`);
for (const line of git(['show', `${sha}:${evidence}/session-id.txt`])
  .trim()
  .split('\n')) {
  console.log(`     ${line}`);
}

console.log('\n5. And the run reports what it attributed');
const report = await session.finalize({ branchName: 'main' });
console.log(`   attributed: ${report.attributed.length}, malformed: ${report.malformed.length}`);
console.log(`\n   git status: ${git(['status', '--porcelain']).trim() || '(clean — the bundle leaves no residue)'}`);

fs.rmSync(root, { recursive: true, force: true });
