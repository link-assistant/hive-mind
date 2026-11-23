#!/usr/bin/env node

/**
 * Open a Formal AI draft for one issue (issue #2233).
 *
 * Two modes, both driven by `.github/workflows/formal-ai-draft.yml`:
 *
 *   --decide   Read the event, decide whether to attempt a draft, and write
 *              `should_run` / `decision_code` / `decision_reason` to
 *              `$GITHUB_OUTPUT`. Never touches the network unless a
 *              `workflow_dispatch` replay makes it fetch the issue.
 *   (default)  Run the attempt: `docker run … solve <issue> --tool agent
 *              --model formal-ai --attach-logs --verbose`, then put the
 *              resulting pull request back into draft and label it.
 *
 * `--dry-run` prints the exact argv that would be executed and exits 0, so the
 * command can be inspected — and diffed in review — without a container, a
 * token or a model.
 *
 * Every decision this file makes lives in `scripts/formal-ai-draft.lib.mjs`;
 * this file only wires the real event payload, Docker and `gh` into it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2233
 * @see docs/FORMAL-AI-DRAFTS.md
 */

import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

import { parseIntegerEnv } from '../src/env-config.lib.mjs';
import { EXIT_CODE_SOLVE_NO_CHANGES } from '../src/solve.exit-codes.lib.mjs';
import { buildDockerArgv, buildGitIdentityEnv, buildRunContextEnv, buildSolveArgv, createdDraftPullRequestNumber, decideDraft, DRAFT_DECISION_ANNOTATION_TITLE, DRAFT_DECISION_CODES, DRAFT_FAILURE_ANNOTATION_TITLE, FORMAL_AI_BINARY_CONTAINER_PATH, formatDecisionOutputs, formatWorkflowAnnotation, isAttemptPullRequest, isIssuePullRequestHead, keepPullRequestAsDraftArgs, labelDraftPullRequest, readIssueEvent } from './formal-ai-draft.lib.mjs';
import { pullDraftImage, resolveDraftImages } from './formal-ai-draft-image.lib.mjs';
import { binaryDigest, draftRunLinks, publishDraftOutcome, readDraftSessionLog, saveDraftOutcome } from './formal-ai-draft-evidence.lib.mjs';
import { draftChangeEvidence, makeDraftOutcome } from './formal-ai-draft-outcome.lib.mjs';
import { gh, ghJson, ghList } from './github-actions.lib.mjs';

const flags = new Set(process.argv.slice(2));
const decideOnly = flags.has('--decide');
const dryRun = flags.has('--dry-run');

const env = process.env;
const repository = env.GITHUB_REPOSITORY || '';
const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com';

const setOutput = text => {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, text);
  process.stdout.write(text);
};

/**
 * The issue this run is about.
 *
 * On `issues: opened` it is already in the payload. On a `workflow_dispatch`
 * replay only the number is, so the rest is fetched — which is also the path
 * that lets a maintainer re-attempt a draft that failed for an infrastructure
 * reason rather than a model one.
 */
const resolveIssue = async () => {
  const eventName = env.GITHUB_EVENT_NAME || 'issues';
  if (eventName === 'issues' && env.GITHUB_EVENT_PATH) {
    const { action, issue } = readIssueEvent(JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')));
    return { eventName, action, issue };
  }

  const number = (env.FORMAL_AI_DRAFT_ISSUE || '').trim();
  if (!/^\d+$/.test(number)) throw new Error(`a manual run needs FORMAL_AI_DRAFT_ISSUE set to an issue number, received ${JSON.stringify(number)}`);
  const fetched = JSON.parse(await gh(['issue', 'view', number, '--repo', repository, '--json', 'number,labels,author,url,state']));
  return {
    eventName,
    // A replay is an explicit request, so it is treated as an `opened` event.
    action: 'opened',
    issue: { number: fetched.number, url: fetched.url, labels: fetched.labels, user: { login: fetched.author?.login, type: fetched.author?.is_bot ? 'Bot' : 'User' } },
  };
};

const issueUrlFor = issue => issue?.html_url || issue?.url || `${serverUrl}/${repository}/issues/${issue?.number}`;

const { eventName, action, issue } = await resolveIssue();
const decision = decideDraft({ eventName, action, issue, layer: env.AUTOMATION_LAYER || 'default' });

const reportDecision = (outcome, { preliminary = false } = {}) => {
  console.log(`Formal AI draft: ${outcome.run ? (preliminary ? 'eligible' : 'attempting') : 'skipping'} — ${outcome.reason}`);
  // The health check reads the final decision. An eligible event can still be occupied at launch.
  if (!preliminary) console.log(formatWorkflowAnnotation('notice', DRAFT_DECISION_ANNOTATION_TITLE, outcome.code));
  setOutput(formatDecisionOutputs(outcome));
  setOutput(`issue_number=${issue?.number ?? ''}\n`);
};

if (decideOnly || dryRun || !decision.run) reportDecision(decision, { preliminary: decision.run });
if (decideOnly || !decision.run) process.exit(0);

// --- The attempt ----------------------------------------------------------

// The direct caller's attempt has 20 minutes including image pulls. Leave 30
// seconds for failure reporting and accept the caller's absolute deadline when supplied.
const defaultDeadlineAtMs = Math.floor(performance.timeOrigin) + (20 * 60 - 30) * 1000;
const deadlineAtMs = parseIntegerEnv('HIVE_MIND_DEADLINE_AT_MS', defaultDeadlineAtMs, { scope: 'formal-ai-draft' });

const hostLogDir = env.FORMAL_AI_DRAFT_LOG_DIR || `${env.RUNNER_TEMP || '/tmp'}/formal-ai-draft-logs`;
const containerLogDir = '/home/box/logs';
mkdirSync(hostLogDir, { recursive: true });
// The runner creates this directory as its own user; the container writes to it
// as `box`, whose uid is not the runner's. Without this, solve's session log —
// the one artefact a failed draft is judged by — fails to write, and the
// failure looks like the model's rather than the mount's.
chmodSync(hostLogDir, 0o777);

// A draft that fails before solve starts (an image that is not published, a
// missing binary artifact) used to leave the log directory empty, so the upload
// step warned "No files were found" and the artifact held no record of why
// (issue #4050, run 43274283479). The failure itself is now that record.
const DRAFT_FAILURE_LOG = 'formal-ai-draft-failure.log';
const links = dryRun ? null : await draftRunLinks(env);
const target = issueUrlFor(issue);
const imageOptions = { override: env.FORMAL_AI_DRAFT_IMAGE, version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version };
let image = resolveDraftImages(imageOptions).image;
const runtime = { workflowVersion: imageOptions.version, sourceSha: env.HIVE_MIND_SOURCE_SHA || env.GITHUB_SHA || null, imageDigest: null, binarySha256: null };

const record = async details => {
  const outcome = makeDraftOutcome({ target, runtime: { ...runtime, image }, links, ...details });
  await saveDraftOutcome(hostLogDir, outcome);
  publishDraftOutcome(outcome, setOutput);
  return outcome;
};

const fail = async (message, code, processResult) => {
  console.log(formatWorkflowAnnotation('error', DRAFT_FAILURE_ANNOTATION_TITLE, message));
  try {
    appendFileSync(join(hostLogDir, DRAFT_FAILURE_LOG), `${new Date().toISOString()} ${message}\n`);
  } catch (error) {
    console.log(`Could not record the failure in ${hostLogDir}: ${error.message}`);
  }
  await record({ infrastructure: { status: 'failed', stage: processResult?.started ? 'execution' : 'setup', code }, process: processResult });
  process.exit(processResult?.exitCode || 1);
};

// A caller testing a Formal AI build (`workflow_call` with
// `formal_ai_binary_artifact`) runs it in place of the image's own binary.
const extraMounts = [];
const binary = (env.FORMAL_AI_DRAFT_BINARY || '').trim();
if (binary) {
  if (!existsSync(binary)) await fail(`FORMAL_AI_DRAFT_BINARY is ${binary}, which does not exist; the downloaded artifact must contain a file named formal-ai`, 'binary_missing');
  chmodSync(binary, 0o755);
  if (!dryRun) runtime.binarySha256 = await binaryDigest(binary).catch(() => null);
  extraMounts.push(`${binary}:${FORMAL_AI_BINARY_CONTAINER_PATH}:ro`);
}

// The image is the tag of the checked-out version, so the container runs the
// same hive-mind as these scripts; `docker run` alone would pull once and fail
// the draft on the first registry timeout.
const pullRunner = args =>
  new Promise(resolve => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = stream => chunk => {
      output += chunk;
      stream.write(chunk);
    };
    child.stdout.on('data', collect(process.stdout));
    child.stderr.on('data', collect(process.stderr));
    child.on('error', error => resolve({ code: 1, output: `${output}\n${error.message}` }));
    child.on('close', code => {
      if (code === 0) runtime.imageDigest = /^Digest: (sha256:[a-f0-9]{64})\s*$/mu.exec(output)?.[1] ?? null;
      resolve({ code: code ?? 1, output });
    });
  });

if (!dryRun) {
  try {
    image = await pullDraftImage({ ...imageOptions, run: pullRunner, sleep, warn: message => console.log(formatWorkflowAnnotation('warning', 'Formal AI draft image', message)) });
  } catch (error) {
    await fail(error.message, error.code || 'DRAFT_IMAGE_PULL_FAILED');
  }
}

const dockerArgv = buildDockerArgv({
  solveArgv: buildSolveArgv({ issueUrl: issueUrlFor(issue), logDir: containerLogDir }),
  forwardEnv: ['GH_TOKEN', 'FORMAL_AI_INSTALL_GRANT', 'HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS', 'HIVE_MIND_MIN_TRANSIENT_ERROR_DELAY_MS', 'HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS'],
  setEnv: { ...buildGitIdentityEnv(), ...buildRunContextEnv(env), HIVE_MIND_DEADLINE_AT_MS: String(deadlineAtMs), HIVE_MIND_FORMAL_AI_DRAFT: '1' },
  image,
  hostLogDir,
  containerLogDir,
  extraMounts,
});

const dockerCommand = `\n$ docker ${dockerArgv.join(' ')}\n`;
if (dryRun) {
  console.log(dockerCommand);
  process.exit(0);
}

// The image pull can take minutes, during which another solver may open a PR.
let openBeforeAttempt;
try {
  openBeforeAttempt = await ghList(`repos/${repository}/pulls?state=open&per_page=100`);
  if (openBeforeAttempt.some(pr => !Number.isSafeInteger(pr?.number) || typeof pr.head?.ref !== 'string')) throw new Error('Invalid pull request census');
} catch (error) {
  await fail(`Could not list open pull requests for ${repository}: ${error.message}`, 'pull_request_census_failed');
}
const occupying = openBeforeAttempt.find(pr => isIssuePullRequestHead(pr.head.ref, issue.number));
if (occupying) {
  reportDecision({ run: false, code: DRAFT_DECISION_CODES.occupied, reason: `#${issue.number} already has open pull request #${occupying.number}` });
  process.exit(0);
}
const previousNumbers = new Set(openBeforeAttempt.map(pr => pr.number));
reportDecision(decision);
console.log(dockerCommand);

// Keep only the startup transcript where solve reports PR creation. Stream all stdout to the workflow log.
const startupOutput = [];
let startupBytesRemaining = 1024 * 1024;
const startedAt = Date.now();
const processResult = await new Promise(resolve => {
  const child = spawn('docker', dockerArgv, { stdio: ['inherit', 'pipe', 'inherit'] });
  child.stdout.pipe(process.stdout, { end: false });
  const captureStartup = chunk => {
    const captured = chunk.subarray(0, startupBytesRemaining);
    startupOutput.push(captured);
    startupBytesRemaining -= captured.length;
    if (startupBytesRemaining === 0) child.stdout.off('data', captureStartup);
  };
  child.stdout.on('data', captureStartup);
  child.on('error', () => resolve({ started: false, exitCode: null, signal: null }));
  child.on('close', (code, signal) => resolve({ started: true, exitCode: code, signal }));
});
if (!processResult.started) await fail('Could not start Docker for the Formal AI draft', 'docker_spawn_failed', processResult);
const status = processResult.exitCode ?? 1;

// --- The failure policy ---------------------------------------------------
//
// This runs whether the attempt succeeded or failed, and its own failures are
// never fatal. #2233: the draft "stays open and red until a later run
// succeeds"; a labelling error must not close it, and must not turn a red
// draft into a red *workflow* that hides why the draft is red.

let change = null;
try {
  const number = createdDraftPullRequestNumber(Buffer.concat(startupOutput).toString('utf8'), repository);
  const view = ['pr', 'view', String(number), '--repo', repository, '--json', 'number,headRefName,isDraft,state,createdAt,headRefOid,changedFiles'];
  const pullRequest = number ? await ghJson(view) : null;
  if (!isAttemptPullRequest(pullRequest, { number, issueNumber: issue.number, startedAt, previousNumbers })) {
    console.log(`Could not verify a new draft pull request from this attempt on issue #${issue.number}. See the session log.`);
  } else {
    console.log(`Draft pull request: ${serverUrl}/${repository}/pull/${pullRequest.number}`);
    setOutput(`head_branch=${pullRequest.headRefName}\npull_request_number=${pullRequest.number}\n`);
    if (pullRequest.headRefOid && Number.isSafeInteger(pullRequest.changedFiles)) {
      try {
        const files = await gh(['api', `repos/${repository}/pulls/${number}/files?per_page=100`, '--paginate', '--jq', '.[] | .filename | @json']);
        const paths = files.trim()
          ? files
              .trim()
              .split('\n')
              .map(line => JSON.parse(line))
          : [];
        const current = await ghJson(view);
        if (current.headRefOid === pullRequest.headRefOid && paths.length === pullRequest.changedFiles) change = draftChangeEvidence(paths);
      } catch {
        console.log('Could not verify the pull request diff for the attempt outcome.');
      }
    }
    if (!pullRequest.isDraft) await gh(keepPullRequestAsDraftArgs({ repository, number: pullRequest.number }));
    await labelDraftPullRequest({ gh, repository, number: pullRequest.number });
  }
} catch (error) {
  console.log(`Could not finalize the draft's state (${error.message}); the pull request itself is unaffected.`);
}

const { log, session } = await readDraftSessionLog(hostLogDir);
const infrastructure = [125, 126, 127].includes(status) && !log ? { status: 'failed', stage: 'setup', code: 'docker_run_failed' } : {};
const outcome = await record({ process: processResult, infrastructure, change, session, log });
if (!outcome.task.usefulChange && outcome.task.acceptance !== 'accepted') {
  const terminal = outcome.solver.terminalState;
  const message = outcome.primary.code === 'no_requested_implementation' && terminal ? `${outcome.primary.message} (${terminal})` : outcome.primary.code === 'no_requested_implementation' && status === EXIT_CODE_SOLVE_NO_CHANGES && log.includes('the session produced no change: no new commit, no file change and no comment') ? 'Finished without changes: the session produced no change: no new commit, no file change and no comment' : outcome.primary.message;
  console.log(formatWorkflowAnnotation(status ? 'error' : 'warning', DRAFT_FAILURE_ANNOTATION_TITLE, message));
}

process.exitCode = status;
