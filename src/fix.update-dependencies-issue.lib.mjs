/**
 * GitHub-backed dependency-update issue generation for
 * `/fix --update-all-dependencies` and `/task --update-all-dependencies`
 * (issue #2184).
 *
 * The counterpart of `fix.ci-cd-issue.lib.mjs`: it collects the repository's
 * languages, default branch, latest commit and committed file list, then hands
 * them to the pure builders in `fix.update-dependencies.lib.mjs`.
 */

import { UPDATE_DEPENDENCIES_ISSUE_LABELS, UPDATE_DEPENDENCIES_ISSUE_TYPE, buildUpdateDependenciesIssueBody, buildUpdateDependenciesIssueTitle, mapRepositoryToEcosystems } from './fix.update-dependencies.lib.mjs';
import { detectLanguages, getDefaultBranch, getLatestCommit, getRepositoryFiles, runCommand } from './fix.github.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';

export async function prepareUpdateDependenciesIssue({ repository, run = runCommand, warn = message => console.warn(message), log = null }) {
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
    title: buildUpdateDependenciesIssueTitle(),
    body: buildUpdateDependenciesIssueBody({ repository, defaultBranch, commit, languages, files, filesTruncated: truncated }),
  };
}

export async function createUpdateDependenciesIssue({ repository, prepared = null, run = runCommand, log = null, warn = message => console.warn(message) }) {
  const issueDraft = prepared || (await prepareUpdateDependenciesIssue({ repository, run, warn, log }));
  const issue = await createTaskIssue({
    repository,
    title: issueDraft.title,
    body: issueDraft.body,
    issueType: UPDATE_DEPENDENCIES_ISSUE_TYPE,
    labels: [...UPDATE_DEPENDENCIES_ISSUE_LABELS],
    run,
    log,
  });
  return { ...issue, prepared: issueDraft };
}
