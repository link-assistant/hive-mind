/**
 * Solution Drafts Listing Module
 * Displays completed issues with their linked pull requests
 *
 * Issue #2160: this listing used to ask only for OPEN pull requests, so every issue whose draft
 * `--auto-merge` had already merged was reported as "(no PR found)" — a false negative in the
 * summary a human reads to judge the run. Merged and closed drafts are now listed with their state.
 */

/** Pull request states worth reporting at the end of a run, in the order they are most useful. */
const REPORTED_PULL_REQUEST_STATES = ['OPEN', 'MERGED', 'CLOSED'];

/**
 * Lists all completed issues with their solution drafts (PRs)
 * @param {Object} issueQueue - The issue queue containing completed issues
 * @param {Function} log - Logging function
 * @param {Function} batchCheckPullRequestsForIssues - Function to batch check PRs for issues
 */
export async function listSolutionDrafts(issueQueue, log, batchCheckPullRequestsForIssues) {
  // `completed` is a Set in hive.mjs, but callers/tests may pass an array.
  const completedUrls = issueQueue?.completed ? Array.from(issueQueue.completed) : [];
  if (completedUrls.length === 0) return;
  await log('\n📋 Issues with solution drafts:');
  const byRepo = {};
  for (const url of completedUrls) {
    const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (m) (byRepo[`${m[1]}/${m[2]}`] ||= { owner: m[1], repo: m[2], iss: [] }).iss.push({ n: +m[3], url });
  }
  for (const r of Object.values(byRepo)) {
    const prs = await batchCheckPullRequestsForIssues(
      r.owner,
      r.repo,
      r.iss.map(i => i.n),
      { includeStates: REPORTED_PULL_REQUEST_STATES }
    );
    for (const i of r.iss)
      if (prs[i.n]?.linkedPRs?.length) {
        await log(`   - ${i.url}`);
        for (const p of prs[i.n].linkedPRs) {
          const state = p.state && p.state !== 'OPEN' ? ` (${p.state.toLowerCase()})` : '';
          await log(`     → PR #${p.number}${state}: ${p.url}`);
        }
      } else await log(`   - ${i.url} (no PR found)`);
  }
}
