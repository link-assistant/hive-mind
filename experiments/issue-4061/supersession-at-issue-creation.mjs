// Replays the supersession check on links-notation #396 and #407 against the
// base branch as it was when links-notation#408 was created (972d864).
// Usage: node experiments/issue-4061/supersession-at-issue-creation.mjs
import { readFile } from 'node:fs/promises';
import { evaluateSupersession, parseUnifiedDiff } from '../../src/fix.dependabot-superseded.lib.mjs';

const raw = new URL('../../docs/case-studies/issue-4061/raw/', import.meta.url);
for (const number of [396, 407]) {
  const files = parseUnifiedDiff(await readFile(new URL(`pr-${number}.diff`, raw), 'utf8'));
  const base = {};
  for (const file of files) base[file.path] = await readFile(new URL(`base-at-issue-creation/${file.path}`, raw), 'utf8').catch(() => null);
  const verdict = evaluateSupersession(files, base);
  console.log(`#${number}: superseded=${verdict.superseded} — ${verdict.reason}`);
}
