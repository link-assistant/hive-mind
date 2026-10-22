/**
 * GitHub-backed dependency-update issue generation for
 * `/fix --update-all-dependencies` and `/task --update-all-dependencies`
 * (issue #2184).
 *
 * The counterpart of `fix.ci-cd-issue.lib.mjs`: it collects the repository's
 * languages, default branch, latest commit and committed file list, then hands
 * them to the pure builders in `fix.update-dependencies.lib.mjs`.
 *
 * Before any of that it merges every open Dependabot pull request without
 * waiting for its CI/CD (issue #3413), so the issue describes the repository
 * after those merges and tells the solver to fix whatever they broke.
 */

import { UPDATE_DEPENDENCIES_ISSUE_LABELS, UPDATE_DEPENDENCIES_ISSUE_TYPE, buildUpdateDependenciesIssueBody, buildUpdateDependenciesIssueTitle, mapRepositoryToEcosystems } from './fix.update-dependencies.lib.mjs';
import { detectLanguages, getDefaultBranch, getLatestCommit, getRepositoryFiles, runCommand } from './fix.github.lib.mjs';
import { createOrReuseTaskIssue } from './task.issue-creation.lib.mjs';
import { mergeDependabotPullRequests } from './fix.dependabot-merge.lib.mjs';

/**
 * `mergeDependabotPrs` (default on) merges the open Dependabot pull requests
 * first; with `dryRun` they are only listed. A caller that already merged them
 * can pass the result as `dependabot` instead.
 */
export async function prepareUpdateDependenciesIssue({ repository, run = runCommand, warn = message => console.warn(message), log = null, reportDependenciesIssues = true, mergeDependabotPrs = true, dryRun = false, verbose = false, dependabot = null }) {
  // Issue #3413: merge before reading the default branch, so the latest commit
  // and the manifest inventory already include Dependabot's updates.
  const dependabotResult = dependabot || (mergeDependabotPrs ? await mergeDependabotPullRequests({ repository, run, warn, log, dryRun, verbose }) : { enabled: false, dryRun: Boolean(dryRun), method: null, listingError: null, pullRequests: [] });
  const [languages, defaultBranch] = await Promise.all([detectLanguages(repository, run, warn), getDefaultBranch(repository, run, warn)]);
  const commit = await getLatestCommit(repository, defaultBranch, run, warn);
  const { files, truncated } = await getRepositoryFiles(repository, defaultBranch, run, warn);

  const { detected } = mapRepositoryToEcosystems({ languages, files });
  if (typeof log === 'function') {
    log(`ℹ️  Detected ${detected.length} dependency ecosystem(s) across ${files.length} file(s)${truncated ? ' (file listing truncated by GitHub)' : ''}.`);
  }

  return {
    repository,
    defaultBranch,
    commit,
    languages,
    files,
    filesTruncated: truncated,
    ecosystems: detected,
    dependabot: dependabotResult,
    title: buildUpdateDependenciesIssueTitle(),
    body: buildUpdateDependenciesIssueBody({ repository, defaultBranch, commit, languages, files, filesTruncated: truncated, reportDependenciesIssues, dependabot: dependabotResult }),
  };
}

export async function createUpdateDependenciesIssue({ repository, prepared = null, run = runCommand, log = null, warn = message => console.warn(message), reportDependenciesIssues = true, mergeDependabotPrs = true, verbose = false }) {
  const issueDraft = prepared || (await prepareUpdateDependenciesIssue({ repository, run, warn, log, reportDependenciesIssues, mergeDependabotPrs, verbose }));
  // Issue #3684: a repeated run refreshes the open issue of an earlier run.
  const issue = await createOrReuseTaskIssue({
    repository,
    title: issueDraft.title,
    body: issueDraft.body,
    issueType: UPDATE_DEPENDENCIES_ISSUE_TYPE,
    labels: [...UPDATE_DEPENDENCIES_ISSUE_LABELS],
    run,
    log,
    verbose,
  });
  return { ...issue, prepared: issueDraft };
}
