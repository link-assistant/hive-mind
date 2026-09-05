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
async function ghJson({ run, warn, endpoint, jq = null, label, fallback }) {
  try {
    const args = ['api', endpoint];
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

// `workflow_id`, `created_at` and `run_attempt` are what let
// `dedupeRunsByWorkflow` keep the latest run of each workflow (issue #2125).
const RUNS_JQ = '[.workflow_runs[] | {id: .id, name: .name, workflow_id: .workflow_id, path: .path, status: .status, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha, created_at: .created_at, run_attempt: .run_attempt}]';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/** Actions runs triggered by a specific commit. */
export async function getRunsForCommit(repository, sha, run, warn) {
  if (!sha) return [];
  const runs = await ghJson({ run, warn, endpoint: `repos/${repository.fullName}/actions/runs?head_sha=${sha}&per_page=100`, jq: RUNS_JQ, label: 'fetch CI/CD runs', fallback: [] });
  return asArray(runs);
}

/** Most recent Actions runs on a branch (fallback when a commit has none). */
export async function getRecentBranchRuns(repository, branch, run, warn) {
  if (!branch) return [];
  const runs = await ghJson({
    run,
    warn,
    endpoint: `repos/${repository.fullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
    jq: RUNS_JQ,
    label: `fetch recent CI/CD runs for branch ${branch}`,
    fallback: [],
  });
  return asArray(runs);
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
