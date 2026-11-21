/**
 * Close stale task fixtures before removing their owned branches.
 *
 * Issue #2625: a repository ruleset with a `deletion` rule on every branch
 * made each DELETE answer HTTP 422 "Repository rule violations found", so the
 * daily cleanup failed every day while doing exactly what the policy allows.
 * Branches a rule protects are now detected before deletion, reported once as
 * retained, and never counted as errors. Any other failure is still fatal.
 *
 * Issue #4025: the job was then cancelled every day by its 15-minute timeout.
 * Retained branches are never removed, so the work grew with every E2E run.
 * By the last successful run (14m15s, 1138 retained branches) the script made
 * about 3,400 sequential API calls: one commit lookup per fixture branch, plus
 * a rules lookup and a ruleset lookup per owned branch. It printed nothing
 * until the end, so the cancelled runs showed no output at all. Now:
 *
 * - commit dates come from GraphQL, 100 branches per request;
 * - a deletion ruleset that covers every branch is detected once, and a
 *   ruleset is never read twice;
 * - progress is logged, and CLEANUP_VERBOSE=true logs every API call;
 * - a time budget stops the run cleanly before the job timeout, leaving the
 *   rest for the next day.
 */

/** The answer GitHub gives when a ruleset forbids deleting the branch. */
export const isBranchDeletionRuleViolation = message => /\bHTTP 422\b/i.test(message) && /Repository rule violations found/i.test(message) && /Cannot delete this branch/i.test(message);

export const FIXTURE_BRANCH_PATTERN = /^e2e\/(hello-world|integration)\//;

/** Read a ruleset once per run; concurrent readers share the request. */
const readRuleset = (repository, id, { api, rulesets }) => {
  if (!rulesets) return api(`repos/${repository}/rulesets/${id}`);
  if (!rulesets.has(id)) rulesets.set(id, api(`repos/${repository}/rulesets/${id}`));
  return rulesets.get(id);
};

/**
 * Ask the rules API whether an active rule forbids deleting the branch for this
 * token. Unknown answers return false, so the DELETE is still attempted and its
 * own error is classified. Pass the same `rulesets` Map for every branch so
 * each ruleset is fetched once.
 */
export async function isBranchDeletionForbidden(repository, branch, { api, rulesets }) {
  let rules;
  try {
    rules = await api(`repos/${repository}/rules/branches/${branch}`);
  } catch {
    return false;
  }
  const deletionRules = Array.isArray(rules) ? rules.filter(rule => rule?.type === 'deletion') : [];
  if (deletionRules.length === 0) return false;
  for (const rule of deletionRules) {
    // Organization rulesets are not readable through the repository endpoint;
    // without proof of a bypass the rule applies.
    if (rule.ruleset_source_type !== 'Repository' || !rule.ruleset_id) return true;
    try {
      const ruleset = await readRuleset(repository, rule.ruleset_id, { api, rulesets });
      if (ruleset?.current_user_can_bypass !== 'always') return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Find an active repository ruleset that forbids deleting *every* branch for
 * this token: a `deletion` rule, `~ALL` included, nothing excluded, no other
 * condition and no bypass. When one exists no per-branch lookup can change the
 * answer, so the cleanup skips them. Anything less certain returns null and
 * the per-branch check runs as before.
 */
export async function findBlanketDeletionRuleset(repository, { api, list, rulesets }) {
  let summaries;
  try {
    summaries = await list(`repos/${repository}/rulesets?per_page=100`);
  } catch {
    return null;
  }
  for (const summary of Array.isArray(summaries) ? summaries : []) {
    if (summary?.target !== 'branch' || summary?.enforcement !== 'active' || summary?.source_type !== 'Repository' || !summary?.id) continue;
    let ruleset;
    try {
      ruleset = await readRuleset(repository, summary.id, { api, rulesets });
    } catch {
      continue;
    }
    const conditions = ruleset?.conditions ?? {};
    const refName = conditions.ref_name ?? {};
    const coversEveryBranch = Object.keys(conditions).every(key => key === 'ref_name') && Array.isArray(refName.include) && refName.include.includes('~ALL') && (refName.exclude ?? []).length === 0;
    const forbidsDeletion = Array.isArray(ruleset?.rules) && ruleset.rules.some(rule => rule?.type === 'deletion');
    if (ruleset?.enforcement === 'active' && coversEveryBranch && forbidsDeletion && ruleset.current_user_can_bypass !== 'always') return ruleset;
  }
  return null;
}

const FIXTURE_DATES_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", query: "e2e/", first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { name target { ... on Commit { committedDate } } }
    }
  }
}`;

/** Fixture branch name -> committer date, 100 branches per GraphQL request. */
export async function listFixtureBranchDates(repository, { graphql }) {
  const [owner, name] = repository.split('/');
  const dates = new Map();
  let cursor = null;
  do {
    const response = await graphql(FIXTURE_DATES_QUERY, { owner, name, cursor });
    const refs = response?.data?.repository?.refs;
    if (!refs || !Array.isArray(refs.nodes)) throw new Error(`unexpected GraphQL answer: ${JSON.stringify(response).slice(0, 200)}`);
    for (const node of refs.nodes) {
      if (FIXTURE_BRANCH_PATTERN.test(node?.name ?? '') && node.target?.committedDate) dates.set(node.name, node.target.committedDate);
    }
    cursor = refs.pageInfo?.hasNextPage ? refs.pageInfo.endCursor : null;
  } while (cursor);
  return dates;
}

/** One line per run, instead of one annotation per retained branch. */
export const describeRetainedBranches = branches => {
  const shown = branches.slice(0, 5).join(', ');
  const more = branches.length > 5 ? ` and ${branches.length - 5} more` : '';
  return `${branches.length} fixture branch(es) retained by a repository rule that prohibits deletion (${shown}${more}). Removing them requires a ruleset exclusion, or a bypass for the cleanup token, that covers these disposable branches; this cleanup deletes them once the rule allows it.`;
};

/**
 * @param {object} options
 * @param {(query: string, variables: object) => Promise<object>} [options.graphql]
 *   Bulk commit-date lookup. Without it (or when it fails) each fixture
 *   branch's commit is read over REST, as before issue #4025.
 * @param {number} [options.deadline] Epoch ms. Work still pending then is
 *   left for the next run instead of being killed by the job timeout.
 * @param {boolean} [options.verbose] Log every API call and its duration.
 */
export async function cleanupStaleFixtures({ repository, api, list, graphql, dryRun = false, maxAgeHours = 24, now = Date.now(), clock = Date.now, deadline = Infinity, verbose = false, log = console.log, warn = console.warn, appendSummary = () => {} }) {
  const cutoff = now - maxAgeHours * 3600_000;
  const stale = date => new Date(date).getTime() < cutoff;
  const errors = [];
  const retainedBranches = [];
  const startedAt = clock();
  const elapsed = () => `${Math.round((clock() - startedAt) / 1000)}s`;
  const outOfTime = () => clock() >= deadline;
  if (verbose) {
    const trace =
      (kind, fn) =>
      async (...args) => {
        const begin = clock();
        try {
          return await fn(...args);
        } finally {
          log(`[verbose] ${kind} ${kind === 'graphql' ? JSON.stringify(args[1]) : `${args[1]?.method ?? 'GET'} ${args[0]}`} ${clock() - begin}ms`);
        }
      };
    api = trace('api', api);
    list = trace('list', list);
    if (graphql) graphql = trace('graphql', graphql);
  }
  const mutate = async (endpoint, options) => {
    log(`${dryRun ? 'Would' : 'Will'} ${options.method} ${endpoint}`);
    if (dryRun) return;
    try {
      await api(endpoint, options);
    } catch (error) {
      if (options.method === 'DELETE' && isBranchDeletionRuleViolation(error.message)) {
        retainedBranches.push(endpoint.slice(`repos/${repository}/git/refs/heads/`.length));
        return;
      }
      errors.push(`${endpoint}: ${error.message}`);
    }
  };

  let dates = null;
  if (graphql) {
    try {
      dates = await listFixtureBranchDates(repository, { graphql });
    } catch (error) {
      log(`GraphQL commit-date lookup failed, reading each branch over REST instead: ${error.message}`);
    }
  }
  const owned = [];
  let incomplete = false;
  if (dates) {
    for (const [name, date] of dates) if (stale(date)) owned.push(name);
    log(`Fixture branches: ${dates.size}, stale: ${owned.length} (${elapsed()})`);
  } else {
    const fixtures = (await list(`repos/${repository}/branches?per_page=100`)).filter(branch => FIXTURE_BRANCH_PATTERN.test(branch.name));
    for (const [index, branch] of fixtures.entries()) {
      if (outOfTime()) {
        incomplete = true;
        break;
      }
      const commit = await api(`repos/${repository}/commits/${branch.commit.sha}`);
      if (stale(commit.commit.committer.date)) owned.push(branch.name);
      if ((index + 1) % 100 === 0) log(`Checked ${index + 1}/${fixtures.length} fixture branch dates (${elapsed()})`);
    }
    log(`Fixture branches: ${fixtures.length}, stale: ${owned.length} (${elapsed()})`);
  }

  const ownedSet = new Set(owned);
  const staleFixtureCount = owned.length;
  if (!outOfTime()) {
    const pulls = await list(`repos/${repository}/pulls?state=all&per_page=100`);
    log(`Pull requests scanned: ${pulls.length} (${elapsed()})`);
    for (const pr of pulls) {
      if (ownedSet.has(pr.base.ref) || ownedSet.has(pr.head.ref)) {
        if (pr.state === 'open') await mutate(`repos/${repository}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
        if (pr.head.repo?.full_name === repository && !ownedSet.has(pr.head.ref)) {
          ownedSet.add(pr.head.ref);
          owned.push(pr.head.ref);
        }
      }
    }
  } else incomplete = true;
  if (!outOfTime()) {
    for (const issue of await list(`repos/${repository}/issues?state=open&labels=e2e-task&per_page=100`)) {
      if (!issue.pull_request && stale(issue.created_at)) await mutate(`repos/${repository}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } });
    }
  } else incomplete = true;

  const rulesets = new Map();
  const blanket = owned.length && !outOfTime() ? await findBlanketDeletionRuleset(repository, { api, list, rulesets }) : null;
  if (blanket) {
    // Every owned branch is protected; a rules lookup or DELETE per branch
    // would only confirm that, at two API calls a branch.
    log(`Ruleset ${blanket.id} (${blanket.name}) forbids deleting every branch; no fixture branch can be deleted (${elapsed()})`);
    retainedBranches.push(...owned.slice().reverse());
  } else {
    let checked = 0;
    for (const branch of owned.slice().reverse()) {
      if (outOfTime()) {
        incomplete = true;
        break;
      }
      if (await isBranchDeletionForbidden(repository, branch, { api, rulesets })) retainedBranches.push(branch);
      else await mutate(`repos/${repository}/git/refs/heads/${branch}`, { method: 'DELETE' });
      if (++checked % 100 === 0) log(`Processed ${checked}/${owned.length} stale branches (${elapsed()})`);
    }
  }
  // Issue #4029: "stale: 1108" followed by "Stale fixture branches: 1380" read
  // as a miscount; the difference is pull request heads based on a fixture.
  log(`Stale fixture branches: ${owned.length} (${staleFixtureCount} e2e/ fixtures, ${owned.length - staleFixtureCount} pull request heads based on them) (${elapsed()})`);
  if (retainedBranches.length) {
    // Still a warning: the retained branches pile up until someone with admin
    // rights excludes them from the ruleset, and only a person can do that.
    const message = describeRetainedBranches(retainedBranches);
    warn(`::warning title=Fixture branches retained::${message}`);
    appendSummary(`${message}\n\n`);
  }
  if (incomplete) {
    const message = `Cleanup stopped at its time budget after ${elapsed()}; the remaining fixtures are handled by the next run.`;
    warn(`::warning title=Cleanup incomplete::${message}`);
    appendSummary(`${message}\n\n`);
  }
  return { owned, errors, retainedBranches, incomplete };
}
