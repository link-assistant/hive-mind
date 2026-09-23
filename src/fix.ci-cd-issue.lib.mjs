/**
 * Shared GitHub-backed CI/CD issue generation for `/fix --ci-cd` and
 * `/task --ci-cd` (issues #1733 and #2121).
 *
 * The generic GitHub getters (languages, default branch, latest commit,
 * workflow runs) moved to `fix.github.lib.mjs` in issue #2184 so that
 * `/fix --update-all-dependencies` reuses them rather than copying them.
 */

import { CI_CD_ISSUE_LABELS, CI_CD_ISSUE_TYPE, buildCiCdIssueBody, buildCiCdIssueTitle, dedupeRunsByWorkflow } from './fix.ci-cd.lib.mjs';
import { detectLanguages, getActiveWorkflows, getDefaultBranch, getLatestCommit, getLatestRunsForWorkflows, getRecentBranchRuns, getRunsForCommit, runCommand } from './fix.github.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';

export async function prepareCiCdIssue({ repository, run = runCommand, warn = message => console.warn(message), log = null }) {
  const [languages, defaultBranch] = await Promise.all([detectLanguages(repository, run, warn), getDefaultBranch(repository, run, warn)]);
  const [commit, activeWorkflows] = await Promise.all([getLatestCommit(repository, defaultBranch, run, warn), getActiveWorkflows(repository, run, warn)]);
  // Query each active workflow directly. The combined branch endpoint is both
  // capped at 1,000 results and offset-paginated, so a high-volume workflow can
  // crowd out or race past the quieter workflow whose failure matters.
  const hasWorkflowInventory = Array.isArray(activeWorkflows);
  const perWorkflowRuns = hasWorkflowInventory ? await getLatestRunsForWorkflows(repository, defaultBranch, activeWorkflows, run, warn) : null;
  // Never treat a successful subset as complete. If one workflow-specific
  // call fails (or the inventory itself is unavailable), the combined branch
  // endpoint is less precise but still preserves the best available evidence.
  const branchRuns = perWorkflowRuns ?? (await getRecentBranchRuns(repository, defaultBranch, run, warn));
  // Repository health is wider than one SHA. A merge commit can trigger only
  // auxiliary workflows while the required release workflow failed on the
  // immediately preceding commit (issue #2286). Always inspect recent branch
  // history, then keep the latest run of each workflow below.
  let runs = branchRuns;
  let runsSource = 'branch';

  // A branch history also contains the last run of deleted and disabled
  // workflows. Without an inventory check, an obsolete failure remains in
  // every generated issue forever. Preserve unidentifiable runs for backward
  // compatibility, and skip filtering if the inventory endpoint was denied.
  const activeWorkflowIds = new Set((activeWorkflows || []).map(workflow => workflow.id));
  const beforeActiveFilter = runs.length;
  if (activeWorkflowIds.size > 0) {
    runs = runs.filter(item => item.workflow_id == null || activeWorkflowIds.has(item.workflow_id));
  }
  const inactiveWorkflowRuns = beforeActiveFilter - runs.length;

  if (runs.length === 0 && (!hasWorkflowInventory || activeWorkflows.length > 0)) {
    const commitRuns = await getRunsForCommit(repository, commit?.sha, run, warn);
    if (commitRuns.length > 0) {
      runs = activeWorkflowIds.size > 0 ? commitRuns.filter(item => item.workflow_id == null || activeWorkflowIds.has(item.workflow_id)) : commitRuns;
      runsSource = 'commit';
    }
  }

  // Direct workflow queries already return one row each. Keep the deduplication
  // for combined-history and exact-commit fallbacks (issue #2125).
  const fetchedRuns = runs.length;
  runs = dedupeRunsByWorkflow(runs);
  const duplicates = fetchedRuns - runs.length;
  if (duplicates > 0 && typeof log === 'function') {
    log(`ℹ️  Collapsed ${duplicates} older CI/CD run(s) — keeping the latest run of each workflow (${runs.length} workflow(s), source: ${runsSource}).`);
  }
  if (inactiveWorkflowRuns > 0 && typeof log === 'function') {
    log(`ℹ️  Excluded ${inactiveWorkflowRuns} run(s) for deleted or disabled workflows.`);
  }

  return {
    repository,
    defaultBranch,
    commit,
    runs,
    fetchedRuns,
    duplicateRuns: duplicates,
    inactiveWorkflowRuns,
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
