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
 *   (default)  Run the attempt: verify the selected Formal AI binary, the
 *              exact Hive Mind image (by digest) and the process that will
 *              serve the task (#3909), then `docker run … solve <issue>
 *              --tool agent --model formal-ai --attach-logs --verbose`, then
 *              put the resulting pull request back into draft and label it.
 *              A missing or mismatched artefact ends the attempt before solve
 *              as a typed deferred/mismatch outcome; nothing falls back.
 *
 * `--dry-run` prints the exact argv that would be executed and exits 0, so the
 * command can be inspected — and diffed in review — without a container, a
 * token or a model.
 *
 * Every decision this file makes lives in `scripts/formal-ai-draft.lib.mjs`;
 * this file only wires the real event payload, Docker and `gh` into it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2233
 * @see https://github.com/link-assistant/hive-mind/issues/3909
 * @see docs/FORMAL-AI-DRAFTS.md
 */

import { execFile, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { buildDockerArgv, buildGitIdentityEnv, buildRunContextEnv, buildSolveArgv, decideDraft, DRAFT_DECISION_ANNOTATION_TITLE, DRAFT_FAILURE_ANNOTATION_TITLE, FORMAL_AI_BINARY_CONTAINER_PATH, firstErrorLine, formatDecisionOutputs, formatWorkflowAnnotation, keepPullRequestAsDraftArgs, labelDraftPullRequest, readIssueEvent, selectDraftPullRequest } from './formal-ai-draft.lib.mjs';
import { ATTEMPT_ANNOTATION_TITLE, ATTEMPT_MODE_LABELS, ATTEMPT_MODES, ATTEMPT_OUTCOME_ANNOTATION_TITLES, ATTEMPT_OUTCOMES, AttemptIdentityError, BINARY_FILE, BINARY_SOURCES, buildAttemptEnv, buildOutcomeRecord, describeAttempt, IDENTITY_FILE, OUTCOME_FILE, parseAttemptIdentity, RECEIPT_FILE } from './formal-ai-draft-identity.lib.mjs';
import { DraftImageUnavailableError, pullDraftImage } from './formal-ai-draft-image.lib.mjs';
import { PROBE_FILE, RECORD_FILE, verifyAttemptPreflight } from './formal-ai-draft-preflight.lib.mjs';
import { createGitHubSelectDeps, readHiveSource, selectAttempt } from './formal-ai-draft-select.lib.mjs';
import { gh } from './github-actions.lib.mjs';
import { sha256OfFile } from '../src/formal-ai-attempt-identity.lib.mjs';

const execFileAsync = promisify(execFile);

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

console.log(`Formal AI draft: ${decision.run ? 'attempting' : 'skipping'} — ${decision.reason}`);
// Read back by the scheduled health check, which flags a decision that repeats.
console.log(formatWorkflowAnnotation('notice', DRAFT_DECISION_ANNOTATION_TITLE, decision.code));
setOutput(formatDecisionOutputs(decision));
setOutput(`issue_number=${issue?.number ?? ''}\n`);

if (decideOnly || !decision.run) process.exit(0);

// --- The attempt ----------------------------------------------------------

const hostLogDir = env.FORMAL_AI_DRAFT_LOG_DIR || `${env.RUNNER_TEMP || '/tmp'}/formal-ai-draft-logs`;
const containerLogDir = '/home/box/logs';
mkdirSync(hostLogDir, { recursive: true });
// The runner creates this directory as its own user; the container writes to it
// as `box`, whose uid is not the runner's. Without this, solve's session log —
// the one artefact a failed draft is judged by — fails to write, and the
// failure looks like the model's rather than the mount's.
chmodSync(hostLogDir, 0o777);

const fail = message => {
  console.log(formatWorkflowAnnotation('error', DRAFT_FAILURE_ANNOTATION_TITLE, message));
  process.exit(1);
};

const writeLog = (name, value) => writeFileSync(join(hostLogDir, name), `${JSON.stringify(value, null, 2)}\n`);

/**
 * End an attempt that never reached solve (#3909): a deferred infrastructure
 * outcome (an artefact for the exact selection is missing) or an identity
 * mismatch, with its evidence next to the session log. Anything untyped is an
 * ordinary failure.
 */
let identity = null;
const endBeforeSolve = error => {
  const outcome = error instanceof AttemptIdentityError ? error.outcome : error instanceof DraftImageUnavailableError ? ATTEMPT_OUTCOMES.deferred : null;
  if (!outcome) fail(error.message);
  writeLog(OUTCOME_FILE, buildOutcomeRecord({ identity, error: { outcome, message: error.message, evidence: error.evidence || {} } }));
  console.log(formatWorkflowAnnotation('error', ATTEMPT_OUTCOME_ANNOTATION_TITLES[outcome], `${identity ? `attempt ${identity.id}: ` : ''}${error.message}`));
  setOutput(`attempt_outcome=${outcome}\n`);
  process.exit(1);
};

const run = async (file, args, options = {}) => (await execFileAsync(file, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options })).stdout;
const binaryVersion = async path => (await run(path, ['--version'], { timeout: 60_000 }).catch(error => `failed: ${error.message}`)).trim();

// --- The attempt identity (#3909) -----------------------------------------
//
// The workflow's `select` job admitted the attempt and passes its identity.
// A caller running this script directly with its own binary (Formal AI's issue
// workflow) is admitted here, bound to that binary's digest. Without either,
// only an explicit historical replay may run the binary baked into the image.

const callerBinary = (env.FORMAL_AI_DRAFT_BINARY || '').trim() || null;
const binaryDir = (env.FORMAL_AI_DRAFT_BINARY_DIR || '').trim() || null;
try {
  if ((env.FORMAL_AI_DRAFT_ATTEMPT_IDENTITY || '').trim()) {
    identity = parseAttemptIdentity(env.FORMAL_AI_DRAFT_ATTEMPT_IDENTITY);
    if (identity.repository !== repository || identity.issue !== Number(issue.number)) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.mismatch, `the attempt identity is for ${identity.repository}#${identity.issue}, not ${repository}#${issue.number}`);
  } else {
    const mode = env.FORMAL_AI_DRAFT_MODE || ATTEMPT_MODES.liveCurrent;
    if (!callerBinary && mode !== ATTEMPT_MODES.historicalReplay) {
      throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `no Formal AI binary was selected for this ${mode} attempt; run it through the workflow's select job or pass FORMAL_AI_DRAFT_BINARY — the image's own Formal AI is only run as a ${ATTEMPT_MODES.historicalReplay}`);
    }
    if (callerBinary && !existsSync(callerBinary)) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `FORMAL_AI_DRAFT_BINARY is ${callerBinary}, which does not exist; the downloaded artifact must contain a file named formal-ai`);
    if (callerBinary) chmodSync(callerBinary, 0o755);
    const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
    const hive = await readHiveSource({ root, repository: env.FORMAL_AI_DRAFT_HIVE_REPOSITORY || 'link-assistant/hive-mind', imageOverride: env.FORMAL_AI_DRAFT_IMAGE, git: args => run('git', args), readFile: path => readFileSync(path, 'utf8') });
    identity = await selectAttempt({
      mode,
      ref: env.FORMAL_AI_DRAFT_FORMAL_AI_REF,
      repository,
      issue: Number(issue.number),
      hive,
      callerBinary,
      callerSourceSha: env.FORMAL_AI_DRAFT_SOURCE_SHA,
      selected: { at: new Date().toISOString(), runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, runUrl: env.GITHUB_RUN_ID ? `${serverUrl}/${repository}/actions/runs/${env.GITHUB_RUN_ID}` : null },
      deps: createGitHubSelectDeps({ gh, hashFile: sha256OfFile, binaryVersion }),
    });
  }
} catch (error) {
  endBeforeSolve(error);
}
writeLog(IDENTITY_FILE, identity);
console.log(formatWorkflowAnnotation('notice', ATTEMPT_ANNOTATION_TITLE, describeAttempt(identity)));
setOutput(`attempt_id=${identity.id}\nattempt_mode=${identity.mode}\n`);

/** The binary this attempt mounts: the caller's, or the one the `binary` job produced. */
const selectedBinary = () => {
  const source = identity.formalAi.binarySource;
  if (source === BINARY_SOURCES.imageBaked) return { path: null, receipt: null };
  if (source === BINARY_SOURCES.caller) return { path: callerBinary, receipt: null };
  const path = binaryDir ? join(binaryDir, BINARY_FILE) : null;
  const receiptPath = binaryDir ? join(binaryDir, RECEIPT_FILE) : null;
  if (!path || !existsSync(path)) {
    const job = (env.FORMAL_AI_DRAFT_BINARY_JOB_RESULT || '').trim();
    throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `the ${source} binary of Formal AI ${identity.formalAi.sourceSha} is not available${job ? ` (the binary job ended: ${job})` : ''}; the attempt is deferred rather than run on another backend`, { source, binaryJob: job || null });
  }
  chmodSync(path, 0o755);
  return { path, receipt: receiptPath && existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : null };
};

const dockerRun = args =>
  new Promise(resolve => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stdout = '';
    const collect = (stream, keep) => chunk => {
      output += chunk;
      if (keep) stdout += chunk;
      stream.write(chunk);
    };
    child.stdout.on('data', collect(process.stdout, true));
    child.stderr.on('data', collect(process.stderr, false));
    child.on('error', error => resolve({ code: 1, output: `${output}\n${error.message}`, stdout }));
    child.on('close', code => resolve({ code: code ?? 1, output, stdout }));
  });

const probeScript = fileURLToPath(new URL('./formal-ai-draft-serving-probe.mjs', import.meta.url));
const preflightDeps = {
  inspectBinary: async path => (existsSync(path) ? { sha256: await sha256OfFile(path), bytes: statSync(path).size } : null),
  binaryVersion,
  pullImage: image => pullDraftImage({ image, run: dockerRun, sleep }),
  inspectImage: async image => {
    const [inspected] = JSON.parse(await run('docker', ['image', 'inspect', image]));
    return { labels: inspected?.Config?.Labels || {}, repoDigest: (inspected?.RepoDigests || []).find(digest => digest.startsWith(`${image.replace(/:[^:/]+$/, '')}@`)) || inspected?.RepoDigests?.[0] || null };
  },
  compare: async (base, head) => JSON.parse(await gh(['api', `repos/${identity.hive.repository}/compare/${base}...${head}`])),
  probe: async ({ image, binaryPath }) => {
    const mounts = ['-v', `${probeScript}:/home/box/.formal-ai-draft-probe.mjs:ro`, ...(binaryPath ? ['-v', `${binaryPath}:${FORMAL_AI_BINARY_CONTAINER_PATH}:ro`] : [])];
    const { stdout, output } = await dockerRun(['run', '--rm', '--user', 'box', ...mounts, image, 'node', '/home/box/.formal-ai-draft-probe.mjs']);
    const line = stdout
      .trim()
      .split('\n')
      .filter(text => text.startsWith('{'))
      .pop();
    const probe = line ? JSON.parse(line) : { ok: false, error: `the serving probe printed no result: ${output.trim().split('\n').pop() || 'no output'}` };
    writeLog(PROBE_FILE, probe);
    return probe;
  },
};

let record = null;
let mount = null;
if (!dryRun) {
  try {
    const { path, receipt } = selectedBinary();
    record = await verifyAttemptPreflight({ identity, binaryPath: path, receipt, deps: preflightDeps, log: message => console.log(`Formal AI draft preflight — ${message}`) });
    mount = path;
  } catch (error) {
    endBeforeSolve(error);
  }
  writeLog(RECORD_FILE, { ...record, identity });
  console.log(formatWorkflowAnnotation('notice', ATTEMPT_ANNOTATION_TITLE, `verified before solve: ${describeAttempt(identity)}; serving executable ${record.serving.servingExeSha256}, image ${record.image.reference}`));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Formal AI draft attempt ${identity.id}\n\n${describeAttempt(identity)}\n\n- binary: ${record.binary?.sha256 ?? 'image-baked'}\n- image: ${record.image.reference} (revision ${record.image.revision})\n- serving executable: ${record.serving.servingExeSha256} (Formal AI ${record.serving.formalAiVersion})\n`);
  if (/^(?:1|true|yes)$/i.test(env.FORMAL_AI_DRAFT_PREFLIGHT_ONLY || '')) {
    console.log('Preflight only: the attempt is verified; solve is not started.');
    process.exit(0);
  }
}

const extraMounts = mount ? [`${mount}:${FORMAL_AI_BINARY_CONTAINER_PATH}:ro`] : callerBinary ? [`${callerBinary}:${FORMAL_AI_BINARY_CONTAINER_PATH}:ro`] : [];
const image = record?.image.reference || identity.hive.image;
const attemptEnv = record?.attemptEnv || buildAttemptEnv({ identity, binarySha256: identity.formalAi.callerBinarySha256 });

const dockerArgv = buildDockerArgv({
  solveArgv: buildSolveArgv({ issueUrl: issueUrlFor(issue), logDir: containerLogDir }),
  forwardEnv: ['GH_TOKEN', 'FORMAL_AI_INSTALL_GRANT'],
  setEnv: { ...buildGitIdentityEnv(), ...buildRunContextEnv(env), ...attemptEnv },
  image,
  hostLogDir,
  containerLogDir,
  extraMounts,
});

console.log(`\n$ docker ${dockerArgv.join(' ')}\n`);
if (dryRun) process.exit(0);

const status = await new Promise((resolve, reject) => {
  const child = spawn('docker', dockerArgv, { stdio: 'inherit' });
  child.on('error', reject);
  child.on('close', code => resolve(code ?? 1));
});

/** The first error of the newest session log, so the run's summary says why it is red. */
const reportFirstError = () => {
  let text = '';
  try {
    const logs = readdirSync(hostLogDir)
      .filter(name => name.endsWith('.log'))
      .map(name => join(hostLogDir, name))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (logs.length) text = readFileSync(logs[0], 'utf8');
  } catch {
    // No log is itself the finding; the fallback message says so.
  }
  console.log(formatWorkflowAnnotation('error', DRAFT_FAILURE_ANNOTATION_TITLE, firstErrorLine(text) || `docker run exited ${status} without a session log error`));
};
if (status !== 0) reportFirstError();

// --- The failure policy ---------------------------------------------------
//
// This runs whether the attempt succeeded or failed, and its own failures are
// never fatal. #2233: the draft "stays open and red until a later run
// succeeds"; a labelling error must not close it, and must not turn a red
// draft into a red *workflow* that hides why the draft is red.

try {
  const open = JSON.parse(await gh(['pr', 'list', '--repo', repository, '--state', 'open', '--limit', '100', '--json', 'number,headRefName,isDraft']));
  const pullRequest = selectDraftPullRequest(open, issue.number);
  if (!pullRequest) {
    console.log(`No pull request was opened for issue #${issue.number}; the session log is the record of why.`);
  } else {
    console.log(`Draft pull request: ${serverUrl}/${repository}/pull/${pullRequest.number}`);
    setOutput(`head_branch=${pullRequest.headRefName}\npull_request_number=${pullRequest.number}\n`);
    if (!pullRequest.isDraft) await gh(keepPullRequestAsDraftArgs({ repository, number: pullRequest.number }));
    await labelDraftPullRequest({ gh, repository, number: pullRequest.number });
    // A replay or a release qualification is labelled as such, never as current-source evidence.
    const modeLabel = ATTEMPT_MODE_LABELS[identity.mode];
    if (modeLabel) await labelDraftPullRequest({ gh, repository, number: pullRequest.number, label: modeLabel, description: `Formal AI draft attempt run as ${identity.mode} (issue #3909)` });
  }
} catch (error) {
  console.log(`Could not finalize the draft's state (${error.message}); the pull request itself is unaffected.`);
}

process.exit(status);
