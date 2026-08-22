/**
 * Shared GitHub-backed CI/CD issue generation for `/fix --ci-cd` and
 * `/task --ci-cd` (issues #1733 and #2121).
 */

import { spawn } from 'child_process';
import { CI_CD_ISSUE_LABELS, CI_CD_ISSUE_TYPE, buildCiCdIssueBody, buildCiCdIssueTitle, dedupeRunsByWorkflow } from './fix.ci-cd.lib.mjs';
import { describeChildExit } from './child-exit.lib.mjs';
import { createTaskIssue } from './task.issue-creation.lib.mjs';

function runCommand(command, args, options = {}) {
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

async function commandOutput(run, command, args) {
  const result = await run(command, args);
  if (result.code !== 0) {
    const output = `${result.stderr || ''}${result.stdout || ''}`.trim();
    // Issue #2135: `describeChildExit` names a signal instead of "code null".
    throw new Error(output || describeChildExit({ command, code: result.code, signal: result.signal }));
  }
  return result.stdout.trim();
}

async function detectLanguages(repository, run, warn) {
  try {
    const json = await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}/languages`]);
    return JSON.parse(json);
  } catch (error) {
    warn(`⚠️  Could not detect languages: ${error.message}`);
    return {};
  }
}

async function getDefaultBranch(repository, run, warn) {
  try {
    return await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}`, '--jq', '.default_branch']);
  } catch (error) {
    warn(`⚠️  Could not determine default branch: ${error.message}`);
    return null;
  }
}

async function getLatestCommit(repository, branch, run, warn) {
  if (!branch) return null;
  try {
    const json = await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}/commits/${branch}`, '--jq', '{sha: .sha, message: .commit.message, url: .html_url}']);
    return JSON.parse(json);
  } catch (error) {
    warn(`⚠️  Could not fetch latest commit: ${error.message}`);
    return null;
  }
}

// `workflow_id`, `created_at` and `run_attempt` are what let
// `dedupeRunsByWorkflow` keep the latest run of each workflow (issue #2125).
const RUNS_JQ = '[.workflow_runs[] | {id: .id, name: .name, workflow_id: .workflow_id, path: .path, status: .status, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha, created_at: .created_at, run_attempt: .run_attempt}]';

async function getRunsForCommit(repository, sha, run, warn) {
  if (!sha) return [];
  try {
    const json = await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}/actions/runs?head_sha=${sha}&per_page=100`, '--jq', RUNS_JQ]);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    warn(`⚠️  Could not fetch CI/CD runs: ${error.message}`);
    return [];
  }
}

async function getRecentBranchRuns(repository, branch, run, warn) {
  if (!branch) return [];
  try {
    const json = await commandOutput(run, 'gh', ['api', `repos/${repository.fullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=100`, '--jq', RUNS_JQ]);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    warn(`⚠️  Could not fetch recent CI/CD runs for branch ${branch}: ${error.message}`);
    return [];
  }
}

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
