/**
 * One Hello World matrix row: create the owned task, run solve in the task
 * image, verify the delivery with the independent oracles, and finalize the
 * task. Every effect goes through an injected adapter, so the same code runs
 * against GitHub in CI and against the emulator in the replay tests
 * (issue #3630).
 */
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildDockerArgv } from './formal-ai-draft.lib.mjs';
import { buildE2eSolveArgv, evaluateE2eRun, formatE2eReport, parseIssue, parseIssueUrl, selectPullRequest } from './e2e-hello-world.lib.mjs';
import { helloWorldReadme, helloWorldIssue } from './hello-world-task.lib.mjs';
import { createBranchFixture, cleanupBranchFixture, fixtureBranch } from './task-fixture.lib.mjs';
import { verifyGeneratedWorkflow } from './e2e-workflow.lib.mjs';
import { detectWorkflowPushRejection, splitE2eVerdict, stagedWorkflowExecution, stagedWorkflowTarget, workflowDirectoryForLayer, workflowPushRejectionResult } from './e2e-matrix-harness.lib.mjs';
import { buildCustody, deriveOutcome, finalizeE2eTask } from './e2e-task-lifecycle.lib.mjs';
import { deliveryRecord, keepTail, startCommandRecord, writeEvidenceManifest } from './e2e-evidence.lib.mjs';
import { ledgerRecord } from './e2e-plan.lib.mjs';
import { gh as realGh, ghApi, ghJson as realGhJson, ghList } from './github-actions.lib.mjs';

export const E2E_TOOLS = Object.freeze(['claude', 'agent', 'codex']);
const PULL_REQUEST_FIELDS = 'number,headRefName,isDraft,state,title,body,url,headRefOid,baseRefName';

/** Spawn a process; `onData` sees stdout and stderr. An aborted signal kills it. */
export const spawnCommand = (command, argv, { env, onData, signal }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, argv, { env, stdio: ['ignore', 'pipe', 'pipe'], signal, killSignal: 'SIGTERM' });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', onData);
    child.on('error', reject);
    child.on('close', (code, closeSignal) => resolve({ code: code ?? 1, signal: closeSignal }));
  });

const readJson = path => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/**
 * @param {object} options
 * @param {string} options.tool claude | agent | codex
 * @param {string} options.model
 * @param {object} [options.deps] api, list, ghJson, gh, exec, stdout, signal
 * @returns {Promise<object>} the evidence written to result.json
 */
export async function runE2eRow({ tool, model, isolation = 'branch', keep = false, dryRun = false, issueUrl: givenIssueUrl = null, image = 'hive-e2e:candidate', hostLogDir, env = process.env, deps = {} }) {
  const { api = ghApi, list = ghList, ghJson = realGhJson, gh = realGh, exec = spawnCommand, stdout = process.stdout, signal = null, lockWaitMs = 30_000, pollMs = 3_000, wait } = deps;
  if (!E2E_TOOLS.includes(tool) || !model || !['branch', 'repository'].includes(isolation)) throw new Error('usage: --tool <claude|agent|codex> --model <model> [--isolation branch|repository] [--keep] [--dry-run]');
  if (isolation === 'repository' && env.AUTOMATION_CAN_CREATE_REPOSITORIES !== 'true' && !dryRun) throw new Error('Repository isolation requires verified can-create-repositories; branch isolation works in every layer');
  mkdirSync(hostLogDir, { recursive: true });
  chmodSync(hostLogDir, 0o777);
  const commands = [];
  const evidence = { tool, model, isolation, layer: env.AUTOMATION_LAYER || 'default', formalAiTag: env.E2E_FORMAL_AI_TAG || null, scope: env.E2E_SCOPE || null, startedAt: new Date().toISOString(), resources: null, passed: false, commands };
  // Every save keeps the command records and the manifest current, so a
  // runner killed mid-session still uploads evidence marked interrupted.
  const save = () => {
    writeFileSync(join(hostLogDir, 'result.json'), JSON.stringify(evidence, null, 2));
    writeFileSync(join(hostLogDir, 'commands.json'), JSON.stringify(commands, null, 2));
    writeEvidenceManifest(hostLogDir, { commands });
  };
  const saveCustody = (custody, resource) => writeFileSync(join(hostLogDir, 'custody.json'), JSON.stringify({ custody, resource }, null, 2));
  // Issue #3332: harness failures (rejected workflow push, wrong image, missing
  // credential) are reported apart from the model's assertions.
  const harness = [];
  // The default token cannot push .github/workflows, so a task this run creates asks for ci/.
  const workflowDir = !givenIssueUrl && isolation === 'branch' ? workflowDirectoryForLayer(evidence.layer) : '.github/workflows/';
  evidence.workflowDir = workflowDir;
  let issueUrl = givenIssueUrl;
  const childEnv = { ...env, GITHUB_TOKEN: env.GH_TOKEN || env.GITHUB_TOKEN };
  const run = async (command, argv, logName) => {
    if (signal?.aborted) throw new Error(`cancelled before ${command}`);
    const recorder = startCommandRecord(commands, { command, argv, logName });
    let output = '';
    save();
    const result = await exec(command, argv, {
      env: childEnv,
      signal,
      onData: chunk => {
        appendFileSync(join(hostLogDir, logName), chunk);
        stdout.write(chunk);
        // Only act/create-repo output is consumed in memory; session logs stay on disk.
        if (logName !== 'solve.log') output = keepTail(output, String(chunk));
        recorder.output(Buffer.byteLength(chunk), logName === 'solve.log' ? 0 : Buffer.byteLength(output));
      },
    });
    recorder.finish(result);
    if (logName === 'solve.log') recorder.record.truncated = false;
    return { code: result.code, stdout: output };
  };
  let resource;
  let custody = null;
  let pullRequest;
  let workspace;
  try {
    let baseBranch;
    if (!issueUrl) {
      const runId = `${env.GITHUB_RUN_ID || randomUUID()}${env.GITHUB_RUN_ATTEMPT && env.GITHUB_RUN_ATTEMPT !== '1' ? `-${env.GITHUB_RUN_ATTEMPT}` : ''}`;
      baseBranch = fixtureBranch({ runId, tool, model });
      if (dryRun) issueUrl = `https://github.com/${env.GITHUB_REPOSITORY || 'owner/repo'}/issues/1`;
      else if (isolation === 'branch') {
        const repository = env.GITHUB_REPOSITORY;
        if (!repository) throw new Error('Branch isolation needs GITHUB_REPOSITORY=owner/repo');
        const language = env.E2E_LANGUAGE || { claude: 'Kotlin', agent: 'Scala', codex: 'Rust' }[tool];
        // Issue #3630: the task names the workflow run, attempt and source that own it.
        custody = buildCustody({ repository, task: `${tool}-${model}`, baseBranch, env });
        evidence.custody = custody;
        resource = await createBranchFixture({
          repository,
          baseBranch,
          readme: helloWorldReadme({ repoName: repository.split('/')[1], randomLanguage: language }),
          ...helloWorldIssue(language, { workflowDir }),
          custody,
          api,
          runGh: gh,
          list,
          lockWaitMs,
          pollMs,
          ...(wait ? { wait } : {}),
          onResource: partial => {
            resource = partial;
            evidence.resources = partial;
            saveCustody(custody, partial);
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
        custody = buildCustody({ repository: parsed.repository, task: `${tool}-${model}`, kind: 'repository', env });
        saveCustody(custody, resource);
      }
    }
    const { repository, number: issueNumber } = parseIssue(issueUrl);
    evidence.issueUrl = issueUrl;
    evidence.resources = resource || null;
    const modelKeys = model === 'formal-ai' || model === 'nemotron-3-super-free' ? [] : tool === 'claude' ? ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'] : ['OPENAI_API_KEY'];
    const dockerArgv = buildDockerArgv({ solveArgv: buildE2eSolveArgv({ issueUrl, tool, model, baseBranch, logDir: '/home/box/logs' }), solveCommand: '/opt/hive-e2e/src/solve.mjs', image, hostLogDir, forwardEnv: ['GH_TOKEN', ...modelKeys, 'FORMAL_AI_INSTALL_GRANT', 'GITHUB_ACTIONS'] });
    stdout.write(`$ docker ${dockerArgv.join(' ')}\n`);
    if (dryRun) {
      evidence.dryRun = true;
      evidence.dockerArgv = dockerArgv;
      return evidence;
    }
    const version = await run('docker', ['run', '--rm', '--entrypoint', 'formal-ai', image, '--version'], 'image-version.log');
    evidence.formalAiVersion = version.stdout.trim();
    const imageId = await run('docker', ['image', 'inspect', '--format', '{{.Id}}', image], 'image-id.log');
    evidence.identity = { image, imageId: imageId.code === 0 ? imageId.stdout.trim() : null, formalAiTag: evidence.formalAiTag, formalAiVersion: evidence.formalAiVersion, sourceRepository: env.GITHUB_REPOSITORY || null, sourceSha: env.E2E_SOURCE_SHA || env.GITHUB_SHA || null, hiveMindVersion: readJson(new URL('../package.json', import.meta.url))?.version ?? null };
    writeFileSync(join(hostLogDir, 'identity.json'), JSON.stringify(evidence.identity, null, 2));
    if (version.code !== 0 || (evidence.formalAiTag && !version.stdout.includes(evidence.formalAiTag.replace(/^v/, '')))) throw new Error(`Task image does not contain the shipped Formal AI ${evidence.formalAiTag} (found ${evidence.formalAiVersion || 'none'})`);
    harness.push({ name: 'task image runs the shipped Formal AI', ok: true, reason: evidence.formalAiVersion || 'unknown' });
    // A repeated invocation of the same attempt adopts the first one's task and
    // only judges what it delivered; it never runs a second session (#3630).
    const session = resource?.reused ? { code: 0, reused: true } : await run('docker', dockerArgv, 'solve.log');
    evidence.solveExitCode = session.code;
    if (session.reused) evidence.reusedTask = true;
    const solveLogPath = join(hostLogDir, 'solve.log');
    const solveLog = existsSync(solveLogPath) ? readFileSync(solveLogPath, 'utf8') : '';
    pullRequest = selectPullRequest(await ghJson(['pr', 'list', '--repo', repository, '--state', 'all', '--limit', '100', '--json', PULL_REQUEST_FIELDS]), issueNumber);
    let files = [];
    let changes = [];
    let execution = { mode: 'none', checks: [], workflowLog: '' };
    const comments = [];
    if (pullRequest) {
      evidence.pullRequestUrl = pullRequest.url;
      if (resource) {
        resource.pullRequestNumber = pullRequest.number;
        if (!resource.branches.includes(pullRequest.headRefName)) resource.branches.push(pullRequest.headRefName);
        if (custody) saveCustody(custody, resource);
      }
      changes = await list(`repos/${repository}/pulls/${pullRequest.number}/files?per_page=100`);
      files = changes.map(file => file.filename);
      const workflows = files.filter(file => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(file));
      const staged = workflowDir === '.github/workflows/' ? [] : files.filter(file => file.startsWith(workflowDir) && /^[^/]+\.ya?ml$/.test(file.slice(workflowDir.length)));
      // act runs each workflow from a clone of the head branch; a staged workflow is copied into place first.
      const runAct = async entries => {
        workspace = await mkdtemp(join(tmpdir(), 'hive-e2e-act-'));
        await gh(['repo', 'clone', repository, workspace, '--', '--branch', pullRequest.headRefName, '--single-branch', '--depth', '1']);
        const event = { action: 'synchronize', number: pullRequest.number, pull_request: await api(`repos/${repository}/pulls/${pullRequest.number}`), repository: await api(`repos/${repository}`) };
        const eventPath = join(hostLogDir, 'pull-request-event.json');
        writeFileSync(eventPath, JSON.stringify(event));
        const results = [];
        for (const { source, target } of entries) {
          if (source !== target) {
            mkdirSync(dirname(join(workspace, target)), { recursive: true });
            copyFileSync(join(workspace, source), join(workspace, target));
          }
          results.push(await run('act', ['pull_request', '-W', join(workspace, target), '--directory', workspace, '--container-architecture', 'linux/amd64', '--eventpath', eventPath, '--json', '-s', 'GITHUB_TOKEN', '-P', 'ubuntu-latest=catthehacker/ubuntu:act-24.04', '-P', 'ubuntu-24.04=catthehacker/ubuntu:act-24.04'], 'act.log'));
        }
        return { code: results.some(result => result.code !== 0) ? 1 : 0, stdout: results.map(result => result.stdout).join('\n') };
      };
      if (workflows.length)
        execution = await verifyGeneratedWorkflow({
          repository,
          pullRequest,
          workflows,
          layer: evidence.layer,
          timeoutMs: Number(env.E2E_CHECKS_TIMEOUT_MINUTES || 30) * 60_000,
          api,
          runGh: gh,
          ...(deps.sleep ? { sleepImpl: deps.sleep } : {}),
          runAct: () => runAct(workflows.map(workflow => ({ source: workflow, target: workflow }))),
        });
      else if (staged.length) execution = stagedWorkflowExecution(await runAct(staged.map(source => ({ source, target: stagedWorkflowTarget(source) }))), staged);
      for (const number of [pullRequest.number, issueNumber]) comments.push(...(await list(`repos/${repository}/issues/${number}/comments?per_page=100`)).map(comment => comment.body));
    }
    // A workflow a later push did deliver is not missing (#3332).
    const rejection = detectWorkflowPushRejection(solveLog, { files: pullRequest ? files : null });
    harness.push(rejection ? workflowPushRejectionResult(rejection, { layer: evidence.layer }) : { name: 'workflow push accepted', ok: true, reason: 'no unrecovered workflow push rejection in solve.log' });
    const evaluation = evaluateE2eRun({ pullRequest, files, checks: execution.checks, workflowLog: execution.workflowLog, comments, workflowDir });
    if (baseBranch && pullRequest?.baseRefName !== baseBranch) evaluation.results.push({ name: 'isolated base branch', ok: false, reason: `Expected ${baseBranch}, received ${pullRequest?.baseRefName}` });
    if (session.code !== 0) evaluation.results.push({ name: 'solve completed', ok: false, reason: `solve exited ${session.code}` });
    evaluation.passed = evaluation.results.every(result => result.ok);
    const verdict = splitE2eVerdict({ harness, evaluation });
    Object.assign(evidence, { evaluation, harness, verdict: { harness: verdict.harness.ok, model: verdict.model.judged ? verdict.model.ok : null }, passed: verdict.passed, execution: { ...execution, workflowLog: undefined }, files });
    writeFileSync(join(hostLogDir, 'workflow.log'), execution.workflowLog);
    writeFileSync(join(hostLogDir, 'delivery.json'), JSON.stringify(deliveryRecord({ issueUrl, pullRequest, files, changes, checks: execution.checks, comments, execution }), null, 2));
    const report = formatE2eReport({ tool, model, issueUrl, pullRequestUrl: pullRequest?.url, evaluation, harness });
    const strategy = `Workflow execution: **${execution.mode}**${execution.fallbackReason ? ` (${execution.fallbackReason})` : ''}.\n`;
    stdout.write(`${report}${strategy}\n`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report + strategy);
  } catch (error) {
    evidence.error = error.message;
    if (signal?.aborted) evidence.cancelled = true;
    stdout.write(`${error.message}\n`);
    // A run that stopped before judging the model is a harness failure; say so in the summary.
    harness.push({ name: 'harness run', ok: false, reason: `harness: ${error.message}` });
    Object.assign(evidence, { harness, verdict: { harness: false, model: null }, passed: false });
    const report = formatE2eReport({ tool, model, issueUrl: issueUrl ?? 'none', pullRequestUrl: pullRequest?.url, evaluation: { passed: false, results: [] }, harness });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, report);
  } finally {
    if (workspace) await rm(workspace, { recursive: true, force: true });
    if (signal?.aborted) evidence.cancelled = true;
    else evidence.finishedAt = new Date().toISOString();
    save();
  }
  // Finalization runs in its own `if: always()` step in CI, after the evidence
  // is uploaded; a local run finalizes here unless the task is kept.
  if (resource && !keep && env.E2E_DEFER_FINALIZE !== 'true') {
    evidence.finalization = await finalizeRow({ hostLogDir, env, deps: { api, list } });
    save();
  }
  return evidence;
}

/**
 * Finalize the row's task from its evidence directory: the outcome comment,
 * closing the issue and pull request, and removing owned branches. Safe to
 * run again; missing custody (the run stopped before creating a task) is a
 * no-op.
 *
 * @returns {Promise<{outcome: string, finalized: boolean, errors: string[], retainedBranches: string[], actions: string[]}>}
 */
export async function finalizeRow({ hostLogDir, jobStatus = null, env = process.env, deps = {} }) {
  const { api = ghApi, list = ghList } = deps;
  const evidence = readJson(join(hostLogDir, 'result.json'));
  const outcome = deriveOutcome({ evidence, jobStatus });
  const owned = readJson(join(hostLogDir, 'custody.json'));
  if (!owned?.resource?.issueNumber) return { outcome, finalized: false, errors: [], retainedBranches: [], actions: ['no owned task to finalize'] };
  const failed = (evidence?.evaluation?.results || []).filter(result => !result.ok).map(result => `${result.name}: ${result.reason}`);
  const harnessFailed = (evidence?.harness || []).filter(result => !result.ok).map(result => `${result.name}: ${result.reason}`);
  const details = [...harnessFailed, ...failed];
  if (evidence?.error) details.unshift(`Error: ${evidence.error}`);
  if (outcome === 'interrupted') details.unshift('The row runner stopped before it recorded a verdict.');
  const resource = { ...owned.resource };
  // The runner knows the pull request it judged; otherwise finalize discovers it.
  if (!resource.pullRequestNumber) delete resource.pullRequestNumber;
  const result = await finalizeE2eTask({
    resource,
    custody: owned.custody,
    outcome,
    details,
    artifact: env.E2E_EVIDENCE_ARTIFACT || null,
    keepBranches: false,
    finalizer: env.GITHUB_JOB ? `job \`${env.GITHUB_JOB}\` of the owning run` : 'the row runner',
    api,
    list,
    cleanup: async ({ repository, branches }) => cleanupBranchFixture({ repository, branches }, { api, summaryFile: env.GITHUB_STEP_SUMMARY }),
  });
  // A ruleset that forbids deleting branches is reported; on a pull request it
  // is a warning, after a merge the row fails as before (R5).
  const retentionFails = result.retainedBranches.length > 0 && env.E2E_SCOPE !== 'pull-request';
  return { outcome, finalized: result.errors.length === 0, failed: result.errors.length > 0 || retentionFails, ...result };
}

/**
 * The exit status of the run step. On a pull request the harness and the
 * task lifecycle are strict, while the model's own delivery is advisory: a
 * Formal AI model regression is not a defect of the pull request, and the row
 * is retried on the next commit because only a pass is reused.
 */
export function rowExitCode(evidence, { scope = null } = {}) {
  if (evidence?.passed) return 0;
  if (scope === 'pull-request' && evidence?.verdict?.harness === true && !evidence.cancelled) return 0;
  return 1;
}

/**
 * The finalize step of a row job: finalize the task unless it is kept, then
 * write the row's ledger record to `ledgerDir` when the run has a ledger
 * scope. A finalization that throws is reported as failed, never skipped.
 *
 * @returns {Promise<{outcome: string, finalization: object, record: object|null, lines: string[]}>}
 */
export async function finalizeAndRecord({ hostLogDir, ledgerDir, env = process.env, deps = {}, now = new Date() }) {
  const evidence = readJson(join(hostLogDir, 'result.json'));
  const owned = readJson(join(hostLogDir, 'custody.json'));
  const jobStatus = env.E2E_JOB_STATUS || null;
  let finalization;
  try {
    finalization = env.E2E_KEEP === 'true' ? { outcome: null, failed: false, errors: [], retainedBranches: [], actions: ['kept for inspection (E2E_KEEP)'] } : await finalizeRow({ hostLogDir, jobStatus, env, deps });
  } catch (error) {
    finalization = { outcome: null, failed: true, errors: [error.message], retainedBranches: [], actions: [] };
  }
  const outcome = finalization.outcome || deriveOutcome({ evidence, jobStatus });
  const [tool, model] = [env.E2E_TOOL || evidence?.tool, env.E2E_MODEL || evidence?.model];
  let record = null;
  if (env.E2E_SCOPE_KEY && tool && model) {
    mkdirSync(ledgerDir, { recursive: true });
    record = ledgerRecord({ tool, model, scope: env.E2E_SCOPE, scopeKey: env.E2E_SCOPE_KEY, outcome, formalAiTag: env.E2E_FORMAL_AI_TAG, pullRequest: env.E2E_PULL_REQUEST ? Number(env.E2E_PULL_REQUEST) : null, custody: owned?.custody || { runId: env.GITHUB_RUN_ID, runAttempt: String(env.GITHUB_RUN_ATTEMPT || '1'), sourceRepository: env.GITHUB_REPOSITORY, sourceSha: env.E2E_SOURCE_SHA || env.GITHUB_SHA }, issueUrl: evidence?.issueUrl || null, pullRequestUrl: evidence?.pullRequestUrl || null, attempt: Number(env.E2E_ATTEMPT || 1), now });
    writeFileSync(join(ledgerDir, 'ledger.json'), JSON.stringify(record, null, 2));
  }
  const lines = [`### Finalized ${tool}/${model}: \`${outcome}\``, '', ...finalization.actions.map(action => `- ${action}`), ...finalization.errors.map(error => `- ❌ ${error}`), ...finalization.retainedBranches.map(branch => `- ⚠️ retained \`${branch}\``), ''];
  return { outcome, finalization, record, lines, tool, model };
}
