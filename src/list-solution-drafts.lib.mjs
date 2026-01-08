/**
 * Solution Drafts Listing Module
 * Displays completed issues with their linked pull requests
 */

/**
 * Lists all completed issues with their solution drafts (PRs)
 * @param {Object} issueQueue - The issue queue containing completed issues
 * @param {Function} log - Logging function
 * @param {Function} batchCheckPullRequestsForIssues - Function to batch check PRs for issues
 */
export async function listSolutionDrafts(issueQueue, log, batchCheckPullRequestsForIssues) {
  if (!issueQueue.completed || issueQueue.completed.length === 0) return;
  await log('\n📋 Issues with solution drafts:');
  const byRepo = {};
  for (const url of issueQueue.completed) {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (m) (byRepo[`${m[1]}/${m[2]}`] ||= { owner: m[1], repo: m[2], iss: [] }).iss.push({ n: +m[3], url });
  }
  for (const r of Object.values(byRepo)) {
    const prs = await batchCheckPullRequestsForIssues(
      r.owner,
      r.repo,
      r.iss.map(i => i.n)
    );
    for (const i of r.iss)
      if (prs[i.n]?.linkedPRs?.length) {
        await log(`   - ${i.url}`);
        for (const p of prs[i.n].linkedPRs) await log(`     → PR #${p.number}: ${p.url}`);
      } else await log(`   - ${i.url} (no PR found)`);
  }
}
