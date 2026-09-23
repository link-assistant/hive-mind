/**
 * GitHub-backed data collection shared by every `/fix` mode (issues #1733 and
 * #2184).
 *
 * `/fix --ci-cd` and `/fix --update-all-dependencies` both start by asking
 * GitHub the same questions — what languages does this repository use, what is
 * its default branch, what is the latest commit on it — and only then diverge
 * into mode-specific queries (workflow runs vs. the manifest inventory). These
 * helpers were originally private to `fix.ci-cd-issue.lib.mjs`; they live here
 * so the second mode reuses them instead of copying them.
 *
 * Every getter degrades to a neutral value (`{}`, `null`, `[]`) and reports the
 * failure through `warn`, because a missing permission on one endpoint must not
 * stop the issue from being generated from the data that *was* readable.
 */

import { spawn } from 'child_process';
import { describeChildExit } from './child-exit.lib.mjs';

/** Run a command and resolve with its captured output (never rejects). */
export function runCommand(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      stderr += data.toString();
    });
    child.on('error', error => {
      resolve({ code: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code, signal) => {
      resolve({ code, stdout, stderr, signal });
    });
  });
}

/** Run a command through `run` and return trimmed stdout, throwing on failure. */
export async function commandOutput(run, command, args) {
  const result = await run(command, args);
  if (result.code !== 0) {
    const output = `${result.stderr || ''}${result.stdout || ''}`.trim();
    // Issue #2135: `describeChildExit` names a signal instead of "code null".
    throw new Error(output || describeChildExit({ command, code: result.code, signal: result.signal }));
  }
  return result.stdout.trim();
}

/**
 * Fetch JSON from a `gh api` endpoint, returning `fallback` and warning when
 * the call fails. `label` completes the sentence "Could not <label>".
 */
async function ghJson({ run, warn, endpoint, jq = null, label, fallback, paginate = false }) {
  try {
    const args = ['api', endpoint];
    if (paginate) args.push('--paginate', '--slurp');
    if (jq) args.push('--jq', jq);
    const output = await commandOutput(run, 'gh', args);
    return output ? JSON.parse(output) : fallback;
  } catch (error) {
    warn(`⚠️  Could not ${label}: ${error.message}`);
    return fallback;
  }
}

/** Byte-weighted language map from GitHub Linguist (`{ "JavaScript": 1234 }`). */
export async function detectLanguages(repository, run, warn) {
  return ghJson({ run, warn, endpoint: `repos/${repository.fullName}/languages`, label: 'detect languages', fallback: {} });
}

/** Name of the repository's default branch, or null. */
export async function getDefaultBranch(repository, run, warn) {
  try {
    return await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}`, '--jq', '.default_branch']);
  } catch (error) {
    warn(`⚠️  Could not determine default branch: ${error.message}`);
    return null;
  }
}

/** `{ sha, message, url }` of the latest commit on `branch`, or null. */
export async function getLatestCommit(repository, branch, run, warn) {
  if (!branch) return null;
  return ghJson({
    run,
    warn,
    endpoint: `repos/${repository.fullName}/commits/${branch}`,
    jq: '{sha: .sha, message: .commit.message, url: .html_url}',
    label: 'fetch latest commit',
    fallback: null,
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// `gh api --paginate --slurp` wraps the response object from every page in an
// array. GitHub caps filtered workflow-run searches at 1,000 results, but this
// avoids silently inspecting only the first 100. Mocks may return the already
// flattened array, so accept both shapes.
function normalizeWorkflowRuns(value) {
  const pages = asArray(value);
  const runs = pages.some(page => Array.isArray(page?.workflow_runs)) ? pages.flatMap(page => asArray(page?.workflow_runs)) : pages;
  return runs.map(item => ({
    id: item.id,
    name: item.name,
    workflow_id: item.workflow_id,
    path: item.path,
    status: item.status,
    conclusion: item.conclusion,
    html_url: item.html_url,
    head_branch: item.head_branch,
    head_sha: item.head_sha,
    event: item.event,
    created_at: item.created_at,
    run_attempt: item.run_attempt,
  }));
}

/** Workflows GitHub currently considers active in the repository. */
export async function getActiveWorkflows(repository, run, warn) {
  const pages = await ghJson({
    run,
    warn,
    endpoint: `repos/${repository.fullName}/actions/workflows?per_page=100`,
    label: 'fetch active CI/CD workflows',
    fallback: null,
    paginate: true,
  });
  if (!Array.isArray(pages)) return null;
  return asArray(pages)
    .flatMap(page => asArray(page?.workflows))
    .filter(workflow => workflow?.state === 'active')
    .map(workflow => ({ id: workflow.id, name: workflow.name, path: workflow.path, state: workflow.state }));
}

/**
 * Latest default-branch run of every active workflow.
 *
 * GitHub caps a filtered combined run search at 1,000 results. A noisy
 * workflow (Dependabot in issue #2286) can crowd a quieter required workflow
 * out of that window, while offset pages can shift as new runs arrive.
 *
 * The workflow-specific `branch=` search is also eventually consistent: it
 * returned run 35013947631 while the unfiltered endpoint already returned the
 * newer main run 35644890960. Read each workflow's time-ordered runs and apply
 * the branch check locally. Usually page one is enough; continue only until a
 * default-branch run is found. The server-side filter is a last resort after
 * GitHub's 1,000-result search boundary.
 */
export async function getLatestRunsForWorkflows(repository, branch, workflows, run, warn) {
  if (!branch || !Array.isArray(workflows) || workflows.length === 0) return [];
  const pageSize = 100;
  const maxPages = 10;
  const responses = await Promise.all(
    workflows.map(async workflow => {
      for (let page = 1; page <= maxPages; page += 1) {
        const response = await ghJson({
          run,
          warn,
          endpoint: `repos/${repository.fullName}/actions/workflows/${workflow.id}/runs?per_page=${pageSize}&page=${page}`,
          label: `fetch ${workflow.name || workflow.id} runs while finding branch ${branch}`,
          fallback: null,
        });
        if (response == null) return null;
        const pageRuns = normalizeWorkflowRuns([response]);
        const branchRun = pageRuns.find(item => item.head_branch === branch);
        if (branchRun) return branchRun;
        if (pageRuns.length < pageSize) return undefined;
      }

      // If one workflow produced more than 1,000 newer runs on other branches,
      // its possibly stale branch index is still better than omitting it.
      const response = await ghJson({
        run,
        warn,
        endpoint: `repos/${repository.fullName}/actions/workflows/${workflow.id}/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
        label: `fetch the latest indexed ${workflow.name || workflow.id} run for branch ${branch}`,
        fallback: null,
      });
      if (response == null) return null;
      return normalizeWorkflowRuns([response]).find(item => item.head_branch === branch);
    })
  );
  // Returning the successful subset would look authoritative while silently
  // omitting a workflow. Let the caller use the combined-history fallback if
  // any individual query failed.
  if (responses.some(response => response === null)) return null;
  return responses.filter(Boolean).sort((a, b) => (Date.parse(b.created_at || '') || 0) - (Date.parse(a.created_at || '') || 0));
}

/** Actions runs triggered by a specific commit. */
export async function getRunsForCommit(repository, sha, run, warn) {
  if (!sha) return [];
  const pages = await ghJson({ run, warn, endpoint: `repos/${repository.fullName}/actions/runs?head_sha=${sha}&per_page=100`, label: 'fetch CI/CD runs', fallback: [], paginate: true });
  return normalizeWorkflowRuns(pages);
}

/** Recent Actions runs on a branch (the primary CI/CD health source). */
export async function getRecentBranchRuns(repository, branch, run, warn) {
  if (!branch) return [];
  const pages = await ghJson({
    run,
    warn,
    endpoint: `repos/${repository.fullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
    label: `fetch recent CI/CD runs for branch ${branch}`,
    fallback: [],
    paginate: true,
  });
  return normalizeWorkflowRuns(pages);
}

/**
 * Every file path in the repository at `branch` (issue #2184).
 *
 * The recursive tree endpoint answers "which package manifests exist, and
 * where" in a single request — the alternative, one Contents call per candidate
 * filename per directory, does not scale to a polyglot monorepo. GitHub caps
 * the response and sets `truncated: true` when it does; the caller is told so it
 * can say in the generated issue that the manifest list may be incomplete.
 */
export async function getRepositoryFiles(repository, branch, run, warn) {
  if (!branch) return { files: [], truncated: false };
  const tree = await ghJson({
    run,
    warn,
    endpoint: `repos/${repository.fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    jq: '{truncated: .truncated, files: [.tree[] | select(.type == "blob") | .path]}',
    label: 'list repository files',
    fallback: null,
  });
  return { files: asArray(tree?.files), truncated: Boolean(tree?.truncated) };
}
