// Reproduce CI's deletion-rule response through the production fixture cleanup.
// No GitHub calls or resource mutations; the input and work are finite.
import { cleanupBranchFixture } from '../../scripts/task-fixture.lib.mjs';

const result = await cleanupBranchFixture(
  { repository: 'fixture/task', pullRequestNumber: 2, issueNumber: 1, branches: ['e2e/integration/run/base', 'issue-1-solver'] },
  {
    api: async (endpoint, options) => {
      if (options.method === 'DELETE') throw new Error('gh: Repository rule violations found\nCannot delete this branch\n (HTTP 422)');
    },
    summaryFile: null,
  }
);
console.log(JSON.stringify(result));
