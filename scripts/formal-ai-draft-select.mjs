#!/usr/bin/env node

/**
 * Admit one Formal AI draft attempt: resolve the Formal AI and Hive Mind
 * sources once and record the attempt identity (issue #3909).
 *
 * Run by the `select` job of `.github/workflows/formal-ai-draft.yml`, after
 * `--decide`. Its `$GITHUB_OUTPUT` (`attempt_id`, `formal_ai_revision`,
 * `hive_revision`, `identity_json`, …) is what the `binary` and `draft` jobs act
 * on; "Re-run failed jobs" reuses those outputs, so a retry keeps the
 * identity, while a new run re-resolves and a new source yields a new id.
 *
 * Environment:
 *   FORMAL_AI_DRAFT_ISSUE_NUMBER     the issue `--decide` admitted
 *   FORMAL_AI_DRAFT_MODE             live-current (default) | published-release | historical-replay
 *   FORMAL_AI_DRAFT_FORMAL_AI_REF    release tag or pinned ref (not for live-current)
 *   FORMAL_AI_DRAFT_REPLAY_IDENTITY  a recorded identity JSON to run unchanged
 *   FORMAL_AI_DRAFT_BINARY           a caller's binary (workflow_call artifact)
 *   FORMAL_AI_DRAFT_SOURCE_SHA       the commit that binary was built from
 *   FORMAL_AI_DRAFT_IMAGE            an explicit Hive Mind image
 *   FORMAL_AI_DRAFT_HIVE_REPOSITORY  the checked-out Hive Mind repository
 */

import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ATTEMPT_ANNOTATION_TITLE, ATTEMPT_OUTCOME_ANNOTATION_TITLES, ATTEMPT_OUTCOMES, AttemptIdentityError, describeAttempt, formatIdentityOutputs } from './formal-ai-draft-identity.lib.mjs';
import { createGitHubSelectDeps, readHiveSource, selectAttempt } from './formal-ai-draft-select.lib.mjs';
import { DRAFT_FAILURE_ANNOTATION_TITLE, formatWorkflowAnnotation } from './formal-ai-draft.lib.mjs';
import { gh } from './github-actions.lib.mjs';
import { sha256OfFile } from '../src/formal-ai-attempt-identity.lib.mjs';

const execFileAsync = promisify(execFile);
const env = process.env;
const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const run = async (file, args) => (await execFileAsync(file, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })).stdout;

try {
  const repository = env.GITHUB_REPOSITORY || '';
  const issue = String(env.FORMAL_AI_DRAFT_ISSUE_NUMBER || '').trim();
  if (!/^\d+$/.test(issue)) throw new Error(`FORMAL_AI_DRAFT_ISSUE_NUMBER must be an issue number, received ${JSON.stringify(issue)}`);
  const callerBinary = String(env.FORMAL_AI_DRAFT_BINARY || '').trim() || null;
  if (callerBinary && !existsSync(callerBinary)) throw new AttemptIdentityError(ATTEMPT_OUTCOMES.deferred, `FORMAL_AI_DRAFT_BINARY is ${callerBinary}, which does not exist; the caller's artifact must contain a file named formal-ai`);
  const hive = await readHiveSource({ root, repository: env.FORMAL_AI_DRAFT_HIVE_REPOSITORY || repository, imageOverride: env.FORMAL_AI_DRAFT_IMAGE, git: args => run('git', args), readFile: path => readFileSync(path, 'utf8') });
  const runUrl = env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL || 'https://github.com'}/${repository}/actions/runs/${env.GITHUB_RUN_ID}` : null;
  const identity = await selectAttempt({
    mode: env.FORMAL_AI_DRAFT_MODE,
    ref: env.FORMAL_AI_DRAFT_FORMAL_AI_REF,
    replayIdentity: env.FORMAL_AI_DRAFT_REPLAY_IDENTITY,
    repository,
    issue: Number(issue),
    hive,
    callerBinary,
    callerSourceSha: env.FORMAL_AI_DRAFT_SOURCE_SHA,
    selected: { at: new Date().toISOString(), runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, runUrl },
    deps: createGitHubSelectDeps({ gh, hashFile: sha256OfFile, binaryVersion: async path => (await run(path, ['--version'])).trim() }),
  });
  console.log(JSON.stringify(identity, null, 2));
  console.log(formatWorkflowAnnotation('notice', ATTEMPT_ANNOTATION_TITLE, describeAttempt(identity)));
  if (identity.formalAi.releaseCandidate) console.log(`Release ${identity.formalAi.releaseCandidate.tag} carries version ${identity.formalAi.version} but was built from ${identity.formalAi.releaseCandidate.sourceSha}, so the selected commit is built instead.`);
  const outputs = `${formatIdentityOutputs(identity)}hive_repository=${identity.hive.repository}\n`;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, outputs);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Formal AI draft attempt\n\n${describeAttempt(identity)}\n\n\`\`\`json\n${JSON.stringify(identity, null, 2)}\n\`\`\`\n`);
} catch (error) {
  const title = error instanceof AttemptIdentityError ? ATTEMPT_OUTCOME_ANNOTATION_TITLES[error.outcome] : DRAFT_FAILURE_ANNOTATION_TITLE;
  console.log(formatWorkflowAnnotation('error', title, `attempt admission failed: ${error.message}`));
  process.exit(1);
}
