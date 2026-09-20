/**
 * Issue #2102 — run the fixed requirement collector against a *real* clone of
 * the repository that produced the incident, with no mocks anywhere.
 *
 *   git clone --depth 1 https://github.com/CEHR2005/GCS-TS.git /tmp/gcs-ts-e2e
 *   node experiments/issue-2102/verify-real-checkout.mjs /tmp/gcs-ts-e2e
 *
 * The issue corpus is supplied from the committed case-study payloads instead of
 * the GitHub API so the run is reproducible offline and matches the state at
 * incident time.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectAgentInstructionFiles, collectCodexCapabilityRequirements } from '../../src/codex-capability-preflight.lib.mjs';

const projectDir = process.argv[2] ?? '/tmp/gcs-ts-e2e';
const dataDir = path.join(import.meta.dirname, '..', '..', 'docs', 'case-studies', 'issue-2102', 'data');
const readJson = async name => JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8'));

const issue = await readJson('gcs-ts-issue-5.json');
const comments = await readJson('gcs-ts-issue-5-comments.json');

// Stands in for `gh api`, replaying the payloads captured from CEHR2005/GCS-TS#5.
const runCommand = async ({ args }) => ({ code: 0, stdout: JSON.stringify(args.at(-1).endsWith('/comments') ? comments : issue), stderr: '' });

const instructions = await collectAgentInstructionFiles({ projectDir });
console.log(`=== instruction files discovered under ${projectDir}`);
for (const file of instructions.files) console.log(`  • ${file.relativePath} (${file.text.length} chars)`);
for (const skip of instructions.skipped) console.log(`  ⏭️ ${skip.relativePath}: ${skip.reason}`);

const issueOnly = await collectCodexCapabilityRequirements({ owner: 'CEHR2005', repo: 'GCS-TS', issueNumber: 5, projectDir: path.join(projectDir, 'docs'), runCommand, env: {} });
console.log('\n=== corpus without the repository AGENTS.md (the shipped v2.8.11 behaviour)');
console.log(`  sources : ${issueOnly.sources.join(', ')}`);
console.log(`  plugins : ${issueOnly.plugins.join(', ') || 'none'}`);
console.log(`  skills  : ${issueOnly.skills.join(', ') || 'none'}`);

const full = await collectCodexCapabilityRequirements({ owner: 'CEHR2005', repo: 'GCS-TS', issueNumber: 5, projectDir, runCommand, env: {} });
console.log('\n=== corpus with the repository instruction files (issue #2102 fix)');
console.log(`  sources : ${full.sources.join(', ')}`);
console.log(`  plugins : ${full.plugins.join(', ') || 'none'}`);
console.log(`  skills  : ${full.skills.join(', ') || 'none'}`);
console.log(`  explicit: ${full.explicit.join(', ') || 'none'}`);
console.log('  evidence:');
for (const entry of full.evidence) console.log(`    ↳ [${entry.source}] ${entry.explicit ? 'explicit' : 'advisory'} ${entry.capability}`);
if (full.rejected.length > 0) {
  console.log('  rejected:');
  for (const entry of full.rejected) console.log(`    ⏭️ [${entry.source}] ${entry.capability}`);
}
