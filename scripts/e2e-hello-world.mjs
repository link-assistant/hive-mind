#!/usr/bin/env node
/** Run, verify and clean one Hello World matrix row; artifacts survive cleanup. */
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildDockerArgv } from './formal-ai-draft.lib.mjs';
import { buildE2eSolveArgv, evaluateE2eRun, formatE2eReport, parseIssue, parseIssueUrl, selectPullRequest } from './e2e-hello-world.lib.mjs';
import { helloWorldReadme, helloWorldIssue } from './hello-world-task.lib.mjs';
import { createBranchFixture, cleanupBranchFixture, fixtureBranch } from './task-fixture.lib.mjs';
import { verifyGeneratedWorkflow } from './e2e-workflow.lib.mjs';
import { gh, ghApi, ghJson, ghList } from './github-actions.lib.mjs';

const env = process.env;
env.FORMAL_AI_INSTALL_GRANT ||= 'workspace';
const args = process.argv.slice(2);
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const tool = option('--tool');
const model = option('--model');
const isolation = option('--isolation') || 'branch';
const keep = args.includes('--keep') || env.E2E_KEEP === 'true';
const dryRun = args.includes('--dry-run');
const image = env.E2E_IMAGE || 'hive-e2e:candidate';
if (!['claude', 'agent', 'codex'].includes(tool) || !model || !['branch', 'repository'].includes(isolation)) throw new Error('usage: --tool <claude|agent|codex> --model <model> [--isolation branch|repository] [--keep] [--dry-run]');
if (isolation === 'repository' && env.AUTOMATION_CAN_CREATE_REPOSITORIES !== 'true' && !dryRun) throw new Error('Repository isolation requires verified can-create-repositories; branch isolation works in every layer');
const hostLogDir = env.E2E_LOG_DIR || join(env.RUNNER_TEMP || tmpdir(), 'e2e-hello-world-logs');
mkdirSync(hostLogDir, { recursive: true });
chmodSync(hostLogDir, 0o777);
const evidence = { tool, model, isolation, layer: env.AUTOMATION_LAYER || 'default', formalAiTag: env.E2E_FORMAL_AI_TAG || null, startedAt: new Date().toISOString(), resources: null, passed: false };
const save = () => writeFileSync(join(hostLogDir, 'result.json'), JSON.stringify(evidence, null, 2));
const run = (command, argv, logName) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, argv, { env: { ...env, GITHUB_TOKEN: env.GH_TOKEN || env.GITHUB_TOKEN }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', chunk => {
        appendFileSync(join(hostLogDir, logName), chunk);
        process.stdout.write(chunk);
        // Only act/create-repo output is consumed in memory; session logs stay on disk.
        if (logName !== 'solve.log') stdout = (stdout + chunk).slice(-32 * 1024 * 1024);
      });
    child.on('error', reject);
    child.on('close', code => resolve({ code: code ?? 1, stdout }));
  });
let resource;
let pullRequest;
let workspace;
try {
  let issueUrl = option('--issue');
  let baseBranch;
  if (!issueUrl) {
    const runId = `${env.GITHUB_RUN_ID || randomUUID()}${env.GITHUB_RUN_ATTEMPT && env.GITHUB_RUN_ATTEMPT !== '1' ? `-${env.GITHUB_RUN_ATTEMPT}` : ''}`;
    baseBranch = fixtureBranch({ runId, tool, model });
    if (dryRun) issueUrl = `https://github.com/${env.GITHUB_REPOSITORY || 'owner/repo'}/issues/1`;
    else if (isolation === 'branch') {
      const repository = env.GITHUB_REPOSITORY;
      if (!repository) throw new Error('Branch isolation needs GITHUB_REPOSITORY=owner/repo');
      const language = env.E2E_LANGUAGE || { claude: 'Kotlin', agent: 'Scala', codex: 'Rust' }[tool];
      resource = await createBranchFixture({
        repository,
        baseBranch,
        readme: helloWorldReadme({ repoName: repository.split('/')[1], randomLanguage: language }),
        ...helloWorldIssue(language),
        onResource: partial => {
          resource = partial;
          evidence.resources = partial;
          save();
        },
      });
      issueUrl = resource.issueUrl;
    } else {
      baseBranch = undefined;
      const created = await run('node', ['create-test-repo.mjs'], 'create-repo.log');
      issueUrl = parseIssueUrl(created.stdout);
      if (created.code !== 0 || !issueUrl) throw new Error('create-test-repo.mjs did not produce a task issue');
      const parsed = parseIssue(issueUrl);
      resource = { repository: parsed.repository, issueNumber: parsed.number, issueUrl, branches: [] };
    }
  }
  const { repository, number: issueNumber } = parseIssue(issueUrl);
  evidence.issueUrl = issueUrl;
  evidence.resources = resource || null;
  const modelKeys = model === 'formal-ai' || model === 'nemotron-3-super-free' ? [] : tool === 'claude' ? ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] : ['OPENAI_API_KEY'];
  const dockerArgv = buildDockerArgv({ solveArgv: buildE2eSolveArgv({ issueUrl, tool, model, baseBranch, logDir: '/home/box/logs' }), solveCommand: '/opt/hive-e2e/src/solve.mjs', image, hostLogDir, forwardEnv: ['GH_TOKEN', ...modelKeys, 'FORMAL_AI_INSTALL_GRANT'] });
  console.log(`$ docker ${dockerArgv.join(' ')}`);
  if (dryRun) process.exit(0);
  const version = await run('docker', ['run', '--rm', '--entrypoint', 'formal-ai', image, '--version'], 'image-version.log');
  evidence.formalAiVersion = version.stdout.trim();
  if (version.code !== 0 || (evidence.formalAiTag && !version.stdout.includes(evidence.formalAiTag.replace(/^v/, '')))) throw new Error('Task image does not contain the scheduled Formal AI release');
  const session = await run('docker', dockerArgv, 'solve.log');
  evidence.solveExitCode = session.code;
  pullRequest = selectPullRequest(await ghJson(['pr', 'list', '--repo', repository, '--state', 'all', '--limit', '100', '--json', 'number,headRefName,isDraft,state,title,body,url,headRefOid,baseRefName']), issueNumber);
  let files = [];
  let execution = { mode: 'none', checks: [], workflowLog: '' };
  const comments = [];
  if (pullRequest) {
    evidence.pullRequestUrl = pullRequest.url;
    if (resource) {
      resource.pullRequestNumber = pullRequest.number;
      resource.branches.push(pullRequest.headRefName);
    }
    const changes = await ghList(`repos/${repository}/pulls/${pullRequest.number}/files?per_page=100`);
    files = changes.map(file => file.filename);
    const workflows = files.filter(file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
    if (workflows.length)
      execution = await verifyGeneratedWorkflow({
        repository,
        pullRequest,
        workflows,
        layer: evidence.layer,
        timeoutMs: Number(env.E2E_CHECKS_TIMEOUT_MINUTES || 30) * 60_000,
        runAct: async () => {
          workspace = await mkdtemp(join(tmpdir(), 'hive-e2e-act-'));
          await gh(['repo', 'clone', repository, workspace, '--', '--branch', pullRequest.headRefName, '--single-branch', '--depth', '1']);
          const event = { action: 'synchronize', number: pullRequest.number, pull_request: await ghApi(`repos/${repository}/pulls/${pullRequest.number}`), repository: await ghApi(`repos/${repository}`) };
          const eventPath = join(hostLogDir, 'pull-request-event.json');
          writeFileSync(eventPath, JSON.stringify(event));
          const results = [];
          for (const workflow of workflows) results.push(await run('act', ['pull_request', '-W', join(workspace, workflow), '--directory', workspace, '--container-architecture', 'linux/amd64', '--eventpath', eventPath, '--json', '-s', 'GITHUB_TOKEN', '-P', 'ubuntu-latest=catthehacker/ubuntu:act-24.04', '-P', 'ubuntu-24.04=catthehacker/ubuntu:act-24.04'], 'act.log'));
          return { code: results.some(result => result.code !== 0) ? 1 : 0, stdout: results.map(result => result.stdout).join('\n') };
        },
      });
    for (const number of [pullRequest.number, issueNumber]) comments.push(...(await ghList(`repos/${repository}/issues/${number}/comments?per_page=100`)).map(comment => comment.body));
  }
  const evaluation = evaluateE2eRun({ pullRequest, files, checks: execution.checks, workflowLog: execution.workflowLog, comments });
  if (baseBranch && pullRequest?.baseRefName !== baseBranch) evaluation.results.push({ name: 'isolated base branch', ok: false, reason: `Expected ${baseBranch}, received ${pullRequest?.baseRefName}` });
  if (session.code !== 0) evaluation.results.push({ name: 'solve completed', ok: false, reason: `solve exited ${session.code}` });
  evaluation.passed = evaluation.results.every(result => result.ok);
  Object.assign(evidence, { evaluation, passed: evaluation.passed, execution: { ...execution, workflowLog: undefined }, files });
  writeFileSync(join(hostLogDir, 'workflow.log'), execution.workflowLog);
  const report = formatE2eReport({ tool, model, issueUrl, pullRequestUrl: pullRequest?.url, evaluation });
  const strategy = `Workflow execution: **${execution.mode}**${execution.fallbackReason ? ` (${execution.fallbackReason})` : ''}.\n`;
  console.log(report + strategy);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report + strategy);
} catch (error) {
  evidence.error = error.message;
  console.error(error.message);
} finally {
  // An error during evidence collection still closes the PR solve opened.
  if (resource && !keep) {
    if (!resource.pullRequestNumber && resource.issueNumber) {
      try {
        const found = selectPullRequest(await ghJson(['pr', 'list', '--repo', resource.repository, '--state', 'open', '--limit', '100', '--json', 'number,headRefName']), resource.issueNumber);
        if (found) {
          resource.pullRequestNumber = found.number;
          resource.branches.push(found.headRefName);
        }
      } catch (error) {
        evidence.cleanupDiscoveryError = error.message;
      }
    }
    evidence.cleanupErrors = await cleanupBranchFixture(resource);
    if (evidence.cleanupErrors.length) evidence.passed = false;
  }
  if (workspace) await rm(workspace, { recursive: true, force: true });
  evidence.finishedAt = new Date().toISOString();
  save();
}
process.exitCode = evidence.passed ? 0 : 1;
