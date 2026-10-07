/**
 * Close stale task fixtures before removing their owned branches.
 *
 * Issue #2625: a repository ruleset with a `deletion` rule on every branch
 * made each DELETE answer HTTP 422 "Repository rule violations found", so the
 * daily cleanup failed every day while doing exactly what the policy allows.
 * Branches a rule protects are now detected before deletion, reported once as
 * retained, and never counted as errors. Any other failure is still fatal.
 */

/** The answer GitHub gives when a ruleset forbids deleting the branch. */
export const isBranchDeletionRuleViolation = message => /\bHTTP 422\b/i.test(message) && /Repository rule violations found/i.test(message) && /Cannot delete this branch/i.test(message);

/**
 * Ask the rules API whether an active rule forbids deleting the branch for this
 * token. Unknown answers return false, so the DELETE is still attempted and its
 * own error is classified.
 */
export async function isBranchDeletionForbidden(repository, branch, { api }) {
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
      const ruleset = await api(`repos/${repository}/rulesets/${rule.ruleset_id}`);
      if (ruleset?.current_user_can_bypass !== 'always') return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** One line per run, instead of one warning per retained branch. */
export const describeRetainedBranches = branches => {
  const shown = branches.slice(0, 5).join(', ');
  const more = branches.length > 5 ? ` and ${branches.length - 5} more` : '';
  return `${branches.length} fixture branch(es) retained by a repository rule that prohibits deletion (${shown}${more}). Removing them requires a ruleset exclusion, or a bypass for the cleanup token, that covers these disposable branches; this cleanup deletes them once the rule allows it.`;
};

export async function cleanupStaleFixtures({ repository, api, list, dryRun = false, maxAgeHours = 24, now = Date.now(), log = console.log, warn = console.warn, appendSummary = () => {} }) {
  const cutoff = now - maxAgeHours * 3600_000;
  const stale = date => new Date(date).getTime() < cutoff;
  const errors = [];
  const retainedBranches = [];
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
  const branches = await list(`repos/${repository}/branches?per_page=100`);
  const owned = [];
  for (const branch of branches.filter(branch => /^e2e\/(hello-world|integration)\//.test(branch.name))) {
    const commit = await api(`repos/${repository}/commits/${branch.commit.sha}`);
    if (stale(commit.commit.committer.date)) owned.push(branch.name);
  }
  for (const pr of await list(`repos/${repository}/pulls?state=all&per_page=100`)) {
    if (owned.includes(pr.base.ref) || owned.includes(pr.head.ref)) {
      if (pr.state === 'open') await mutate(`repos/${repository}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } });
      if (pr.head.repo?.full_name === repository && !owned.includes(pr.head.ref)) owned.push(pr.head.ref);
    }
  }
  for (const issue of await list(`repos/${repository}/issues?state=open&labels=e2e-task&per_page=100`)) {
    if (!issue.pull_request && stale(issue.created_at)) await mutate(`repos/${repository}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } });
  }
  for (const branch of owned.reverse()) {
    if (await isBranchDeletionForbidden(repository, branch, { api })) {
      retainedBranches.push(branch);
      continue;
    }
    await mutate(`repos/${repository}/git/refs/heads/${branch}`, { method: 'DELETE' });
  }
  log(`Stale fixture branches: ${owned.length}`);
  if (retainedBranches.length) {
    const message = describeRetainedBranches(retainedBranches);
    warn(`::warning title=Fixture branches retained::${message}`);
    appendSummary(`${message}\n\n`);
  }
  return { owned, errors, retainedBranches };
}
