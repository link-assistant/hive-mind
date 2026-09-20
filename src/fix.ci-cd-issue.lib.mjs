/**
 * Shared GitHub-backed CI/CD issue generation for `/fix --ci-cd` and
 * `/task --ci-cd` (issues #1733 and #2121).
 *
 * The generic GitHub getters (languages, default branch, latest commit,
 * workflow runs) moved to `fix.github.lib.mjs` in issue #2184 so that
 * `/fix --update-all-dependencies` reuses them rather than copying them.
 */

import { CI_CD_ISSUE_LABELS, CI_CD_ISSUE_TYPE, buildCiCdIssueBody, buildCiCdIssueTitle, dedupeRunsByWorkflow } from './fix.ci-cd.lib.mjs';
import { detectLanguages, getDefaultBranch, getLatestCommit, getRecentBranchRuns, getRunsForCommit, runCommand } from './fix.github.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';

export async function prepareCiCdIssue({ repository, run = runCommand, warn = message => console.warn(message), log = null }) {
  const [languages, defaultBranch] = await Promise.all([detectLanguages(repository, run, warn), getDefaultBranch(repository, run, warn)]);
  const commit = await getLatestCommit(repository, defaultBranch, run, warn);
  let runs = await getRunsForCommit(repository, commit?.sha, run, warn);
  let runsSource = 'commit';

  if (runs.length === 0) {
    const branchRuns = await getRecentBranchRuns(repository, defaultBranch, run, warn);
    if (branchRuns.length > 0) {
      runs = branchRuns;
      runsSource = 'branch';
    }
  }

  // The branch fallback returns every run of every workflow across many
  // commits; the issue must list one row per workflow (issue #2125).
  const fetchedRuns = runs.length;
  runs = dedupeRunsByWorkflow(runs);
  const duplicates = fetchedRuns - runs.length;
  if (duplicates > 0 && typeof log === 'function') {
    log(`ℹ️  Collapsed ${duplicates} older CI/CD run(s) — keeping the latest run of each workflow (${runs.length} workflow(s), source: ${runsSource}).`);
  }

  return {
    repository,
    defaultBranch,
    commit,
    runs,
    fetchedRuns,
    duplicateRuns: duplicates,
    languages,
    runsSource,
    title: buildCiCdIssueTitle(),
    body: buildCiCdIssueBody({ repository, defaultBranch, commit, runs, languages, runsSource }),
  };
}

export async function createCiCdIssue({ repository, prepared = null, run = runCommand, log = null, warn = message => console.warn(message) }) {
  const issueDraft = prepared || (await prepareCiCdIssue({ repository, run, warn, log }));
  const issue = await createTaskIssue({
    repository,
    title: issueDraft.title,
    body: issueDraft.body,
    issueType: CI_CD_ISSUE_TYPE,
    labels: [...CI_CD_ISSUE_LABELS],
    run,
    log,
  });
  return { ...issue, prepared: issueDraft };
}
