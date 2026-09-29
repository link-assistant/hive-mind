#!/usr/bin/env node

/**
 * Run one row of the Hello World end-to-end matrix (issue #2319).
 *
 *   node scripts/e2e-hello-world.mjs --tool agent --model formal-ai [--issue <url>] [--dry-run]
 *
 * 1. Without `--issue`, create a fresh task with `create-test-repo.mjs`.
 * 2. `docker run … solve <issue> --tool <tool> --model <model> …` — the same
 *    command for every model.
 * 3. Wait for the pull request's checks, collect the evidence, and evaluate
 *    every assertion #2319 names. Exit non-zero if any fails.
 *
 * `--dry-run` prints the exact solve command and exits 0 without a container,
 * a token or a model.
 *
 * Every decision lives in `scripts/e2e-hello-world.lib.mjs`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2319
 */

import { execFile, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';

import { buildDockerArgv, DEFAULT_HIVE_MIND_IMAGE } from './formal-ai-draft.lib.mjs';
import { buildE2eSolveArgv, evaluateE2eRun, formatE2eReport, parseIssue, parseIssueUrl, selectPullRequest, summariseChecks } from './e2e-hello-world.lib.mjs';

const execFileAsync = promisify(execFile);
const env = process.env;

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] || null;
};
const tool = option('--tool');
const model = option('--model');
const dryRun = args.includes('--dry-run');
const checksTimeoutMs = Number(env.E2E_CHECKS_TIMEOUT_MINUTES || 30) * 60 * 1000;

if (!tool || !model) {
  console.error('usage: node scripts/e2e-hello-world.mjs --tool <claude|agent|codex> --model <model> [--issue <url>] [--dry-run]');
  process.exit(2);
}

/** `gh` with an argv array — no shell. */
const gh = async ghArgs => (await execFileAsync('gh', ghArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const run = (command, commandArgs, { capture = false } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    let stdout = '';
    if (capture) {
      child.stdout.on('data', chunk => {
        stdout += chunk;
        process.stdout.write(chunk);
      });
    }
    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? 1, stdout }));
  });

// --- 1. The task ----------------------------------------------------------

let issueUrl = option('--issue');
if (!issueUrl && dryRun) issueUrl = 'https://github.com/owner/test-hello-world-dry-run/issues/1';
if (!issueUrl) {
  const created = await run('node', ['create-test-repo.mjs'], { capture: true });
  issueUrl = parseIssueUrl(created.stdout);
  if (created.code !== 0 || !issueUrl) {
    console.error(`create-test-repo.mjs did not produce an issue (exit ${created.code})`);
    process.exit(1);
  }
}
const { repository, number: issueNumber } = parseIssue(issueUrl);

// --- 2. The session -------------------------------------------------------

const hostLogDir = env.E2E_LOG_DIR || `${env.RUNNER_TEMP || '/tmp'}/e2e-hello-world-logs`;
const containerLogDir = '/home/box/logs';
const dockerArgv = buildDockerArgv({
  solveArgv: buildE2eSolveArgv({ issueUrl, tool, model, logDir: containerLogDir }),
  image: env.E2E_IMAGE || DEFAULT_HIVE_MIND_IMAGE,
  hostLogDir,
  containerLogDir,
  // Forwarded by name only; an unset name forwards nothing. The Formal AI rows
  // need none of the model keys — they are here for the LLM row.
  forwardEnv: ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY'],
});

console.log(`\n$ docker ${dockerArgv.join(' ')}\n`);
if (dryRun) process.exit(0);

mkdirSync(hostLogDir, { recursive: true });
// The container writes as `box`, whose uid is not the runner's (see formal-ai-draft.mjs).
chmodSync(hostLogDir, 0o777);
const session = await run('docker', dockerArgv);
console.log(`solve exited with ${session.code}`);

// --- 3. The evidence ------------------------------------------------------

const findPullRequest = async () => selectPullRequest(JSON.parse(await gh(['pr', 'list', '--repo', repository, '--state', 'all', '--limit', '100', '--json', 'number,headRefName,isDraft,state,title,body,url,headRefOid'])), issueNumber);

let pullRequest = await findPullRequest();
let checks = [];
if (pullRequest) {
  const deadline = Date.now() + checksTimeoutMs;
  for (;;) {
    checks = JSON.parse(await gh(['pr', 'view', String(pullRequest.number), '--repo', repository, '--json', 'statusCheckRollup'])).statusCheckRollup ?? [];
    const summary = summariseChecks(checks);
    if ((summary.total > 0 && summary.pending === 0) || Date.now() > deadline) break;
    console.log(`waiting for checks: ${summary.total} reported, ${summary.pending} pending`);
    await sleep(30_000);
  }
  // Re-read: solve may still have been finishing the body or the ready flag.
  pullRequest = await findPullRequest();
}

let files = [];
let workflowLog = '';
let comments = [];
if (pullRequest) {
  files = JSON.parse(await gh(['pr', 'view', String(pullRequest.number), '--repo', repository, '--json', 'files'])).files.map(file => file.path);
  const runs = JSON.parse(await gh(['run', 'list', '--repo', repository, '--commit', pullRequest.headRefOid, '--limit', '10', '--json', 'databaseId']));
  for (const workflowRun of runs) {
    try {
      workflowLog += await gh(['run', 'view', String(workflowRun.databaseId), '--repo', repository, '--log']);
    } catch (error) {
      console.log(`could not read the log of run ${workflowRun.databaseId}: ${error.message}`);
    }
  }
  for (const number of [pullRequest.number, issueNumber]) {
    comments.push(...(JSON.parse(await gh(['issue', 'view', String(number), '--repo', repository, '--json', 'comments'])).comments ?? []).map(comment => comment.body));
  }
}

const evaluation = evaluateE2eRun({ pullRequest, files, checks, workflowLog, comments });
const report = formatE2eReport({ tool, model, issueUrl, pullRequestUrl: pullRequest?.url ?? null, evaluation });
console.log(`\n${report}`);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report);

process.exit(evaluation.passed ? 0 : 1);
