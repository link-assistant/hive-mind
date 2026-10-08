/** Create and solve post-merge remediation issues until CI/CD outputs verify. */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeChildExit } from './child-exit.lib.mjs';
import { delegateSignalHandling } from './exit-handler.lib.mjs';
import { commandOutput, runCommand } from './fix.github.lib.mjs';
import { createCiCdIssue, prepareCiCdIssue } from './fix.ci-cd-issue.lib.mjs';
import { buildCiCdIssueBody } from './fix.ci-cd.lib.mjs';
import { beginAutoRestartBudget, consumeAutoRestartIteration, hasExhaustedAutoRestartBudget, formatAutoRestartLabel } from './auto-restart-budget.lib.mjs';
import { validateAutoFixCiCd, buildRepairSolveArgs } from './solve.auto-fix-ci-cd.detect.lib.mjs';
import { monitorCiCd } from './solve.auto-fix-ci-cd.github.lib.mjs';

export async function getMergedCiCdTarget({ repository, prNumber, run = runCommand }) {
  if (!prNumber) return null;
  const pr = JSON.parse(await commandOutput(run, 'gh', ['pr', 'view', String(prNumber), '--repo', repository.fullName, '--json', 'state,mergedAt,mergeCommit,baseRefName']));
  if (pr.state !== 'MERGED') return null;
  if (!pr.mergeCommit?.oid || !pr.mergedAt || !pr.baseRefName) throw new Error('The merged pull request has no verifiable merge commit, time or target branch.');
  return { sha: pr.mergeCommit.oid, branch: pr.baseRefName, since: pr.mergedAt };
}

export async function getRepairCiCdTarget({ repository, issue, branch, run = runCommand }) {
  const details = JSON.parse(await commandOutput(run, 'gh', ['issue', 'view', issue.url, '--repo', repository.fullName, '--json', 'closedByPullRequestsReferences']));
  for (const pr of details.closedByPullRequestsReferences || []) {
    if (pr.repository && `${pr.repository.owner.login}/${pr.repository.name}` !== repository.fullName) continue;
    const target = await getMergedCiCdTarget({ repository, prNumber: pr.number, run });
    if (target?.branch === branch) return target;
  }
  // A release bot can advance HEAD without the repair merging. Conversely,
  // its version-bump commit may not start any CI of its own (GITHUB_TOKEN).
  // Always monitor the repair PR's merge, never infer it from branch HEAD.
  throw new Error(`CI/CD remediation has no merged pull request targeting ${branch}: ${issue.url}`);
}

export function solveCiCdIssue(args, { spawnChild = spawn, delegateSignals = delegateSignalHandling } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(process.execPath, [fileURLToPath(new URL('./solve.mjs', import.meta.url)), ...args], { stdio: 'inherit', env: process.env });
    let interrupted = false;
    // The global exit handler must not exit before a child finishes its own
    // graceful shutdown (including the working-session guard used by hive).
    delegateSignals(true);
    const forwardInterrupt = () => {
      interrupted = true;
      child.kill('SIGTERM');
    };
    process.on('SIGINT', forwardInterrupt);
    process.on('SIGTERM', forwardInterrupt);
    const cleanup = () => {
      process.removeListener('SIGINT', forwardInterrupt);
      process.removeListener('SIGTERM', forwardInterrupt);
      delegateSignals(false);
    };
    child.on('error', error => {
      cleanup();
      reject(error);
    });
    child.on('close', (code, signal) => {
      cleanup();
      if (interrupted) reject(new Error('CI/CD remediation was interrupted.'));
      else if (code === 0) resolve();
      else reject(new Error(describeChildExit({ command: 'solve CI/CD remediation', code, signal })));
    });
  });
}

export function buildRemediationIssueBody({ repository, prepared, target, health }) {
  const body = buildCiCdIssueBody({ repository, defaultBranch: target.branch, commit: { sha: target.sha }, runs: health.runs, languages: prepared.languages, runsSource: 'branch' }).replace('**Default branch:**', '**Target branch:**');
  const evidence = [`### Post-merge verification`, '', `Target: \`${target.branch}\`, commit \`${target.sha}\`, merged at ${target.since}.`, '', ...health.errors.map(error => `- ${error}`), ...(health.pending ? ['- CI/CD did not finish or start before the monitoring deadline.'] : []), '', ...health.outputs.map(output => `- ${output.kind}: ${output.verified ? 'verified' : 'missing/unverified'} — ${output.detail || ''}`), '', 'Inspect failed workflow logs and verify the published release, registry version and deployment after merging the fix. Passing workflows without a release or deployment are insufficient.', '', body].join('\n');
  return evidence;
}

async function createRemediationIssue({ repository, target, health, log }) {
  const warn = message => log(message, { level: 'warning' });
  const prepared = await prepareCiCdIssue({ repository, warn });
  const evidence = buildRemediationIssueBody({ repository, prepared, target, health });
  return createCiCdIssue({ repository, prepared: { ...prepared, body: evidence }, log: message => log(message), warn });
}

export async function runAutoFixCiCd({ argv, owner, repo, prNumber, rawArgs = process.argv.slice(2), log = async () => {}, dependencies = {} }) {
  validateAutoFixCiCd(argv);
  if (!argv.autoFixCiCd) return { skipped: true };
  const repository = { owner, repo, fullName: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
  const getTarget = dependencies.getTarget || getMergedCiCdTarget;
  const monitor = dependencies.monitor || monitorCiCd;
  const createIssue = dependencies.createIssue || createRemediationIssue;
  const solve = dependencies.solve || solveCiCdIssue;
  const refreshTarget = dependencies.refreshTarget || getRepairCiCdTarget;
  let target = await getTarget({ repository, prNumber });
  if (!target) return { skipped: true, reason: 'not_merged' };
  beginAutoRestartBudget({ maxIterations: argv.autoRestartMaxIterations });

  while (true) {
    await log(`🔎 Verifying CI/CD publications on ${repository.fullName}:${target.branch}...`);
    const health = await monitor({ repository, target, log });
    if (health.success) {
      await log(`✅ CI/CD passed and release/deployment outputs were verified for ${repository.url}.`);
      return health;
    }
    if (health.cancelled) throw new Error('CI/CD verification was interrupted.');
    if (hasExhaustedAutoRestartBudget()) throw new Error(`CI/CD repair limit reached: ${health.errors.join('; ')}`);
    const issue = await createIssue({ repository, target, health, log });
    const iteration = consumeAutoRestartIteration();
    await log(`🔧 CI/CD repair ${formatAutoRestartLabel(iteration)}: ${issue.url}`);
    await solve([...buildRepairSolveArgs(issue.url, rawArgs, argv.issueUrl || argv['issue-url']), `--base-branch=${target.branch}`]);
    const nextTarget = await refreshTarget({ repository, branch: target.branch, issue });
    if (!nextTarget?.sha || nextTarget.sha === target.sha) throw new Error(`CI/CD remediation did not advance ${target.branch}: ${issue.url}`);
    target = nextTarget;
  }
}
