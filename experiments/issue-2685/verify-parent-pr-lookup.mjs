// Read-only live verification of the captured calculator incident; no solvers or mutations.
import { writeFileSync } from 'node:fs';
import { batchCheckPullRequestsForIssues } from '../../src/github.batch.lib.mjs';

const numbers = [227, ...Array.from({ length: 18 }, (_, index) => 229 + index)];
const closingLinks = await batchCheckPullRequestsForIssues('link-assistant', 'calculator', numbers);
const issueOwnership = await batchCheckPullRequestsForIssues('link-assistant', 'calculator', numbers, { excludeAncestorPullRequests: true });
const result = { recordedAt: new Date().toISOString(), repository: 'link-assistant/calculator', closingLinks, issueOwnership };
writeFileSync(new URL('../../docs/case-studies/issue-2685/data/live-pr-ownership-follow-up.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
for (const [name, lookup] of Object.entries({ closingLinks, issueOwnership })) {
  console.log(`${name}: ${Object.values(lookup).filter(issue => issue.openPRCount > 0).length}/${numbers.length} issues with open PRs`);
  for (const [number, issue] of Object.entries(lookup)) if (issue.error) console.error(`#${number}: ${issue.error}`);
}
