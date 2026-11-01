// Replays the supersession check on the five Dependabot pull requests of
// konard/medical-neural-network-ml#25 (issue #3863), using the diffs and the
// base files saved in docs/case-studies/issue-3863/raw.
import { readFile } from 'node:fs/promises';
import { evaluateSupersession, parseUnifiedDiff } from '../src/fix.dependabot-superseded.lib.mjs';

const raw = new URL('../docs/case-studies/issue-3863/raw/', import.meta.url);
const base = {
  'scripts/unimedvl-requirements.txt': await readFile(new URL('base-at-issue-creation-unimedvl-requirements.txt', raw), 'utf8'),
  'pyproject.toml': await readFile(new URL('base-at-issue-creation-pyproject.toml', raw), 'utf8'),
};
for (const number of [13, 14, 15, 16, 17]) {
  const files = parseUnifiedDiff(await readFile(new URL(`pr-${number}.diff`, raw), 'utf8'));
  const verdict = evaluateSupersession(files, base);
  console.log(`#${number}: superseded=${verdict.superseded} — ${verdict.reason}`);
}
