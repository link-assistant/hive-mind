#!/usr/bin/env node

/**
 * `/fix` command (issue #1733).
 *
 * Currently implements `--ci-cd`: automatically generate a CI/CD remediation
 * issue for a target repository and (optionally) hand it off to
 * `/solve --auto-merge`.
 *
 *   fix.mjs <github-repository-url> --ci-cd [solve options...]
 *
 * Every option `/fix` does not consume itself (e.g. --tool, --model, --think)
 * is forwarded to `/solve`.
 */

import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { buildCiCdIssueBody, buildCiCdIssueTitle, buildSolveArgs, partitionFixArgs, summarizeRunFailures } from './fix.ci-cd.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`Usage: fix.mjs <github-repository-url> --ci-cd [options]

Automatically generate a CI/CD remediation issue for a repository and hand it
off to /solve --auto-merge.

Options:
  --ci-cd            Generate a CI/CD remediation issue (required mode)
  --dry-run          Print the issue that would be created without creating it
  --no-solve         Create the issue but do not start /solve on it
  --version          Show version number
  --help, -h         Show help

All other options (e.g. --tool, --model, --think) are forwarded to /solve.

Examples:
  fix.mjs https://github.com/owner/repo --ci-cd
  fix.mjs https://github.com/owner/repo --ci-cd --tool codex --model gpt-5.5
  fix.mjs owner/repo --ci-cd --think max --no-solve`);
}

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
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function commandOutput(command, args) {
  const result = await runCommand(command, args);
  if (result.code !== 0) {
    const output = `${result.stderr || ''}${result.stdout || ''}`.trim();
    throw new Error(output || `${command} exited with code ${result.code}`);
  }
  return result.stdout.trim();
}

async function detectLanguages(repository) {
  try {
    const json = await commandOutput('gh', ['api', `repos/${repository.fullName}/languages`]);
    return JSON.parse(json);
  } catch (error) {
    console.warn(`⚠️  Could not detect languages: ${error.message}`);
    return {};
  }
}

async function getDefaultBranch(repository) {
  try {
    return await commandOutput('gh', ['api', `repos/${repository.fullName}`, '--jq', '.default_branch']);
  } catch (error) {
    console.warn(`⚠️  Could not determine default branch: ${error.message}`);
    return null;
  }
}

async function getLatestCommit(repository, branch) {
  if (!branch) return null;
  try {
    const json = await commandOutput('gh', ['api', `repos/${repository.fullName}/commits/${branch}`, '--jq', '{sha: .sha, message: .commit.message, url: .html_url}']);
    return JSON.parse(json);
  } catch (error) {
    console.warn(`⚠️  Could not fetch latest commit: ${error.message}`);
    return null;
  }
}

const RUNS_JQ = '[.workflow_runs[] | {name: .name, status: .status, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha}]';

async function getRunsForCommit(repository, sha) {
  if (!sha) return [];
  try {
    const json = await commandOutput('gh', ['api', `repos/${repository.fullName}/actions/runs?head_sha=${sha}&per_page=100`, '--jq', RUNS_JQ]);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`⚠️  Could not fetch CI/CD runs: ${error.message}`);
    return [];
  }
}

async function getRecentBranchRuns(repository, branch) {
  if (!branch) return [];
  try {
    const json = await commandOutput('gh', ['api', `repos/${repository.fullName}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`, '--jq', RUNS_JQ]);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`⚠️  Could not fetch recent CI/CD runs for branch ${branch}: ${error.message}`);
    return [];
  }
}

function resolveSolveCommand() {
  return path.join(__dirname, 'solve.mjs');
}

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('--version')) {
    const { getVersion } = await import('./version.lib.mjs');
    try {
      console.log(await getVersion());
    } catch {
      console.error('Error: Unable to determine version');
      process.exit(1);
    }
    return;
  }

  if (rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    process.exit(rawArgs.length === 0 ? 1 : 0);
  }

  const parsed = partitionFixArgs(rawArgs);

  if (!parsed.ciCd) {
    console.error('❌ /fix currently supports only --ci-cd mode. Pass --ci-cd to continue.');
    process.exit(1);
  }

  if (!parsed.repository) {
    console.error('❌ Missing or invalid GitHub repository URL. Provide it as the first argument, e.g. fix.mjs https://github.com/owner/repo --ci-cd');
    process.exit(1);
  }

  const repository = parsed.repository;
  console.log(`🔧 /fix --ci-cd for ${repository.fullName}`);

  const [languages, defaultBranch] = await Promise.all([detectLanguages(repository), getDefaultBranch(repository)]);
  const commit = await getLatestCommit(repository, defaultBranch);
  let runs = await getRunsForCommit(repository, commit?.sha);
  let runsSource = 'commit';

  // Release/tag commits frequently produce no runs of their own. Fall back to
  // the most recent runs on the default branch so the issue stays actionable.
  if (runs.length === 0) {
    const branchRuns = await getRecentBranchRuns(repository, defaultBranch);
    if (branchRuns.length > 0) {
      runs = branchRuns;
      runsSource = 'branch';
    }
  }

  const { total, failing } = summarizeRunFailures(runs);
  console.log(`   Default branch: ${defaultBranch || 'unknown'}`);
  console.log(`   Latest commit:  ${commit?.sha ? commit.sha.slice(0, 7) : 'unknown'}`);
  console.log(`   CI/CD runs:     ${total} (${failing} not passing)${runsSource === 'branch' ? ' [recent branch runs]' : ''}`);

  const title = buildCiCdIssueTitle(repository);
  const body = buildCiCdIssueBody({ repository, defaultBranch, commit, runs, languages, runsSource });

  if (parsed.dryRun) {
    console.log('\n--- DRY RUN: issue that would be created ---\n');
    console.log(`Title: ${title}\n`);
    console.log(body);
    return;
  }

  console.log('\n📝 Creating remediation issue...');
  const { createTaskIssue } = await import('./task.issue-creation.lib.mjs');
  const issue = await createTaskIssue({ repository, title, body, run: runCommand });
  console.log(`✅ Created issue: ${issue.url}`);

  if (!parsed.runSolve) {
    console.log('ℹ️  --no-solve set; skipping /solve. Run it manually with:');
    console.log(`   solve ${issue.url} --auto-merge`);
    return;
  }

  const solveArgs = buildSolveArgs({ issueUrl: issue.url, passthrough: parsed.passthrough });
  const solveCommand = resolveSolveCommand();
  console.log(`\n🚀 Starting /solve: solve ${solveArgs.join(' ')}`);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [solveCommand, ...solveArgs], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`solve exited with code ${code}`));
    });
  });
}

main().catch(error => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});
