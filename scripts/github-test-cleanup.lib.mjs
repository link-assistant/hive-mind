/** Cleanup isolated resources without touching ordinary branches or issues. */
import { githubApi, githubList } from './github-api.lib.mjs';
import { isTestBranch, isBranchDeletionRuleError, reportRetainedTestBranch } from './github-test-resources.lib.mjs';

export const mayDeleteTestRepository = (repo, layer) => layer !== 'default' && repo?.permissions?.admin === true;
export const isTestRepositoryName = name => /^test-feedback-lines-(?:[0-9a-z]+|\d{13}-[0-9a-f-]{36})$/.test(name || '') || /^test-hello-world-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(name || '');

export async function cleanupStaleTestResources({ api = githubApi, repository, now = Date.now(), maxAgeHours = 24, dryRun = false, log = console.log } = {}) {
  if (!repository || !Number.isFinite(maxAgeHours) || maxAgeHours < 1) throw new Error('repository and a positive cleanup age are required');
  const root = `repos/${repository}`;
  const cutoff = now - maxAgeHours * 60 * 60 * 1000;
  const stale = date => Number.isFinite(Date.parse(date)) && Date.parse(date) < cutoff;
  const branches = await githubList(`${root}/branches?per_page=100`, null, api);
  const selected = new Set();
  const protectedPrefixes = new Set();
  const fixturePrefix = ref => /^(?:e2e|integration)\/[^/]+/.exec(ref || '')?.[0];
  for (const branch of branches.filter(branch => isTestBranch(branch.name))) {
    const commit = await api(`${root}/commits/${branch.commit.sha}`);
    if (stale(commit.commit?.committer?.date)) selected.add(branch.name);
    else protectedPrefixes.add(fixturePrefix(branch.name));
  }
  const pulls = await githubList(`${root}/pulls?state=all&per_page=100`, null, api);
  const issues = await githubList(`${root}/issues?state=all&per_page=100`, null, api);
  const operations = [];
  const prNumbers = [];
  const issueNumbers = [];
  const stalePulls = [];
  // Resolve every active fixture before planning writes. PRs can share a base,
  // and their API order must never decide whether a live solver is deleted.
  for (const pr of pulls) {
    if (!isTestBranch(pr.base?.ref) && !isTestBranch(pr.head?.ref)) continue;
    // A live solver may have pushed since creating its orphan base. Never
    // close its PR or remove its base merely because that base is old.
    const commit = await api(`${root}/commits/${pr.head.sha}`);
    if (!stale(commit.commit?.committer?.date)) {
      for (const ref of [pr.base?.ref, pr.head?.ref]) {
        const prefix = fixturePrefix(ref);
        if (prefix) protectedPrefixes.add(prefix);
      }
    } else {
      // The orphan base may already be gone after a partial cleanup. Its PR
      // still identifies a solver head outside the disposable-ref prefixes.
      stalePulls.push(pr);
    }
  }
  for (const ref of selected) if (protectedPrefixes.has(fixturePrefix(ref))) selected.delete(ref);
  for (const pr of stalePulls) {
    if ([pr.base?.ref, pr.head?.ref].some(ref => protectedPrefixes.has(fixturePrefix(ref)))) continue;
    prNumbers.push(pr.number);
    if (pr.state !== 'closed') operations.push([`${root}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } }]);
    if (pr.head?.repo?.full_name === repository) selected.add(pr.head.ref);
  }
  for (const issue of issues) {
    if (issue.pull_request || !stale(issue.created_at)) continue;
    const prefix = /<!-- hive-mind-test: ((?:e2e|integration)\/[^\s]+) -->/.exec(issue.body || '')?.[1];
    if (!prefix || protectedPrefixes.has(prefix)) continue;
    issueNumbers.push(issue.number);
    if (issue.state !== 'closed') operations.push([`${root}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } }]);
  }
  for (const branch of selected) operations.push([`${root}/git/refs/heads/${branch}`, { method: 'DELETE' }]);
  const errors = [];
  const retainedBranches = [];
  for (const [endpoint, options] of operations) {
    log(`${dryRun ? 'Would perform' : 'Performing'} ${options.method} ${endpoint}`);
    if (dryRun) continue;
    try {
      await api(endpoint, options);
    } catch (error) {
      // A previous attempt may already have removed a solver's head ref.
      if (options.method === 'DELETE' && /Reference does not exist|404|Not Found/i.test(error.message)) continue;
      if (options.method === 'DELETE' && isBranchDeletionRuleError(error)) {
        const branch = endpoint.split('/git/refs/heads/')[1];
        retainedBranches.push(branch);
        reportRetainedTestBranch(branch, log);
        continue;
      }
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, `Test cleanup failed: ${errors.map(error => error.message).join('; ')}`);
  return { branches: [...selected], retainedBranches, issues: issueNumbers, pulls: prNumbers };
}

export async function cleanupTestRepositories({ api = githubApi, repository, layer = 'default', dryRun = false, log = console.log } = {}) {
  if (layer === 'default') {
    log('Repository deletion unavailable with layer default; isolated fixture cleanup was attempted.');
    return;
  }
  const owners = new Set([repository.split('/')[0]]);
  if (layer === 'token') owners.add((await api('user')).login);
  for (const owner of owners) {
    const account = await api(`users/${owner}`);
    const endpoint = account.type === 'Organization' ? `orgs/${owner}/repos` : `users/${owner}/repos`;
    const repos = await githubList(`${endpoint}?per_page=100`, null, api);
    for (const repo of repos.filter(repo => !repo.archived && isTestRepositoryName(repo.name))) {
      const fullName = repo.full_name || `${owner}/${repo.name}`;
      const details = await api(`repos/${fullName}`);
      if (!mayDeleteTestRepository(details, layer)) {
        log(`Preserving ${fullName}: repository Administration permission unavailable.`);
        continue;
      }
      log(`${dryRun ? 'Would delete' : 'Deleting'} test repository ${fullName}`);
      if (dryRun) continue;
      try {
        await api(`repos/${fullName}`, { method: 'DELETE' });
      } catch (error) {
        if (!/403|delete_repo|not accessible/i.test(error.message)) throw error;
        log(`Preserving ${fullName}: deletion requires Administration: write or delete_repo (${error.message}).`);
      }
    }
  }
}
