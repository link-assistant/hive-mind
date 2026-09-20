#!/usr/bin/env node

/**
 * Issue #2229 — run formal-ai's own metric over a before/after pair.
 *
 * The issue's reproduction ends at step 3 with
 * `rust-script scripts/self-hosting-metric.rs measure <base>..<head>` reporting
 * 0 lines. This builds both branches in one throwaway repository — the same
 * change, committed once the way solve committed it before this fix and once
 * with the environment the attribution session hands to the agent — and asks
 * the real metric binary about each.
 *
 * The metric is `scripts/self-hosting-metric.rs` from link-assistant/formal-ai.
 * rust-script is not needed to run it; it has no dependencies beyond std:
 *
 *   gh api repos/link-assistant/formal-ai/contents/scripts/self-hosting-metric.rs \
 *     --jq .content | base64 -d > /tmp/metric-build/self-hosting-metric.rs   # and
 *   the two files it includes: self-hosting-retraction.rs, self-development-loop.rs
 *   cd /tmp/metric-build && rustc --edition 2024 -O -o metric self-hosting-metric.rs
 *
 * Usage: [FORMAL_AI_METRIC_BIN=/tmp/metric-build/metric] \
 *        node experiments/issue-2229/measure-with-formal-ai-metric.mjs
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createFormalAiAttributionSession } from '../../src/formal-ai-attribution.lib.mjs';

const METRIC = process.env.FORMAL_AI_METRIC_BIN || '/tmp/metric-build/metric';
const ISSUE = 2229;
const VERSION = '0.345.0';
const PR_URL = 'https://github.com/link-assistant/hive-mind/pull/2230';
const CHANGE = 'export const parseRange = value => value.split("..");\n';

if (!fs.existsSync(METRIC)) {
  console.log(`skipped: no metric binary at ${METRIC} (see the header of this file for how to build one)`);
  process.exit(0);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-metric-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo, { recursive: true });

const git = (args, env = {}) => String(execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }));
const measure = (since, until) => {
  try {
    return String(execFileSync(METRIC, ['--repo', repo, '--since', since, '--until', until], { stdio: ['ignore', 'pipe', 'pipe'] })).trim();
  } catch (error) {
    return `${error.stdout || ''}${error.stderr || ''}`.trim();
  }
};

git(['init', '--quiet', '--initial-branch', 'main']);
git(['config', 'user.email', 'formal-ai@example.com']);
git(['config', 'user.name', 'Formal AI']);
fs.writeFileSync(path.join(repo, 'README.md'), '# demo\n');
git(['add', 'README.md']);
git(['commit', '--quiet', '-m', 'chore: initial']);
const base = git(['rev-parse', 'HEAD']).trim();

// Before: what solve produced until this fix — the model's change, committed
// with no trailers and no evidence, the Agent CLI stream attached as a log.
git(['switch', '--quiet', '--create', 'before', base]);
fs.writeFileSync(path.join(repo, 'parser.mjs'), CHANGE);
git(['add', 'parser.mjs']);
git(['commit', '--quiet', '-m', 'feat: teach the parser about ranges']);

// After: the same change, committed with the environment the attribution
// session hands to the agent process. Nothing else about the commit changes.
git(['switch', '--quiet', '--create', 'after', base]);
const session = createFormalAiAttributionSession({ repositoryPath: repo, issueNumber: ISSUE, prUrl: PR_URL, version: VERSION, model: 'formal-ai', tool: 'agent', flushRecordThreshold: 1, log: async () => {} });
await session.prepare();
await session.noteSessionId('ses_metric0001');
await session.recordStreamEvent({ type: 'session.started', sessionID: 'ses_metric0001', providerID: 'formalai', modelID: 'formal-ai' });
fs.writeFileSync(path.join(repo, 'parser.mjs'), CHANGE);
git(['add', 'parser.mjs'], session.gitEnv);
git(['commit', '--quiet', '-m', 'feat: teach the parser about ranges'], session.gitEnv);
await session.finalize({ branchName: 'after' });

console.log('formal-ai scripts/self-hosting-metric.rs, share of changed lines it attributes to Formal AI:\n');
console.log(`  before this fix  ${measure(base, 'before')}`);
console.log(`  after this fix   ${measure(base, 'after')}`);
console.log('\ncommit message on `after`:\n');
console.log(
  git(['show', '-s', '--format=%B', 'after'])
    .trim()
    .split('\n')
    .map(line => `  ${line}`)
    .join('\n')
);

fs.rmSync(root, { recursive: true, force: true });
