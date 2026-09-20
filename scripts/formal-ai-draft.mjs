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

import { execFile, spawn } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { buildDockerArgv, buildSolveArgv, DEFAULT_HIVE_MIND_IMAGE, decideDraft, formatDecisionOutputs, keepPullRequestAsDraftArgs, labelPullRequestArgs, readIssueEvent, selectDraftPullRequest } from './formal-ai-draft.lib.mjs';

const execFileAsync = promisify(execFile);

const flags = new Set(process.argv.slice(2));
const decideOnly = flags.has('--decide');
const dryRun = flags.has('--dry-run');

const env = process.env;
const repository = env.GITHUB_REPOSITORY || '';
const serverUrl = env.GITHUB_SERVER_URL || 'https://github.com';

/** `gh` with an argv array — no shell, so a webhook string can never become a command. */
const gh = async args => {
  const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return stdout;
};

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
const decision = decideDraft({ eventName, action, issue, hasToken: Boolean((env.FORMAL_AI_DRAFT_TOKEN || '').trim()) });

console.log(`Formal AI draft: ${decision.run ? 'attempting' : 'skipping'} — ${decision.reason}`);
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

const dockerArgv = buildDockerArgv({
  solveArgv: buildSolveArgv({ issueUrl: issueUrlFor(issue), logDir: containerLogDir }),
  image: env.FORMAL_AI_DRAFT_IMAGE || DEFAULT_HIVE_MIND_IMAGE,
  hostLogDir,
  containerLogDir,
});

console.log(`\n$ docker ${dockerArgv.join(' ')}\n`);
if (dryRun) process.exit(0);

const status = await new Promise((resolve, reject) => {
  const child = spawn('docker', dockerArgv, { stdio: 'inherit' });
  child.on('error', reject);
  child.on('close', code => resolve(code ?? 1));
});

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
    if (!pullRequest.isDraft) await gh(keepPullRequestAsDraftArgs({ repository, number: pullRequest.number }));
    await gh(labelPullRequestArgs({ repository, number: pullRequest.number }));
  }
} catch (error) {
  console.log(`Could not finalize the draft's state (${error.message}); the pull request itself is unaffected.`);
}

process.exit(status);
