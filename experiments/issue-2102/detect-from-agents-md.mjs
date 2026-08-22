/**
 * Issue #2102 — run the shipped detector against the real CEHR2005/GCS-TS
 * agent instruction files, to show that the detector works and only its input
 * was missing.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { detectRequiredCodexCapabilities } from '../../src/codex-capability-preflight.lib.mjs';

const dataDir = path.join(import.meta.dirname, '..', '..', 'docs', 'case-studies', 'issue-2102', 'data');
for (const file of ['gcs-ts-AGENTS.md', 'gcs-ts-packages-gcs-engine-AGENTS.md']) {
  const text = await fs.readFile(path.join(dataDir, file), 'utf8');
  const detected = detectRequiredCodexCapabilities(text);
  console.log(`=== ${file} ===`);
  console.log('plugins :', detected.plugins);
  console.log('skills  :', detected.skills);
  console.log('explicit:', detected.explicit);
  console.log(
    'rejected:',
    detected.rejected.map(entry => entry.capability)
  );
}

const issue = JSON.parse(await fs.readFile(path.join(dataDir, 'gcs-ts-issue-5.json'), 'utf8'));
const comments = JSON.parse(await fs.readFile(path.join(dataDir, 'gcs-ts-issue-5-comments.json'), 'utf8'));
const issueCorpus = [issue.title, issue.body, ...comments.map(comment => comment.body)].filter(Boolean).join('\n');
const fromIssue = detectRequiredCodexCapabilities(issueCorpus);
console.log('=== issue #5 title + body + comments (the shipped corpus) ===');
console.log('plugins :', fromIssue.plugins);
console.log('skills  :', fromIssue.skills);
console.log('mentions superpowers:', /superpowers/i.test(issueCorpus));
