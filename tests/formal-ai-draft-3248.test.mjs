#!/usr/bin/env node
/**
 * Issue #3248: the Formal AI Draft workflow failed on 53 of 60 new issues.
 *
 * Covered here (the workflow side of the fix):
 *   5. the image is pulled before `docker run`, with retries, and it is the
 *      image of the checked-out `package.json` version rather than `:latest`;
 *   7. a draft runs one attempt: the uncommitted-changes restart is off too;
 *   8. the workflow is reusable (`workflow_call`), with inputs for the image and
 *      for a Formal AI binary built by the caller;
 *   3. the container is told it is `--rm` and which run holds its log;
 *   health: the attempt records its decision and first error as annotations.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildDockerArgv, buildRunContextEnv, buildSolveArgv, DRAFT_SOLVE_FLAGS, FORMAL_AI_BINARY_CONTAINER_PATH, firstErrorLine, formatWorkflowAnnotation } from '../scripts/formal-ai-draft.lib.mjs';
import { classifyPullFailure, HIVE_MIND_IMAGE_REPOSITORY, pullDraftImage, pullImageWithRetry, resolveDraftImages } from '../scripts/formal-ai-draft-image.lib.mjs';

const ISSUE_URL = 'https://github.com/link-assistant/hive-mind/issues/3248';
const workflowText = readFileSync('.github/workflows/formal-ai-draft.yml', 'utf8');

/** The lines of one top-level key's block (`on:`) or one job's block (`  draft:`), by indentation. */
const block = (text, header) => {
  const lines = text.split('\n');
  const start = lines.findIndex(line => line === header);
  assert.ok(start >= 0, `${header.trim()} is present`);
  const indent = header.match(/^ */)[0].length;
  const end = lines.findIndex((line, index) => index > start && line.trim() && !line.trim().startsWith('#') && line.match(/^ */)[0].length <= indent);
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
};
const job = name => block(workflowText, `  ${name}:`);

// --- 7. One attempt per run -----------------------------------------------

test('a draft does not restart the model over uncommitted files', () => {
  assert.ok(DRAFT_SOLVE_FLAGS.includes('--no-auto-restart-on-uncommitted-changes'));
  assert.ok(DRAFT_SOLVE_FLAGS.includes('--no-auto-restart-until-mergeable'));
  assert.doesNotMatch(workflowText, /restart loop is disabled/, 'the workflow comment no longer claims more than the flags do');
});

// --- 5. Pinned image, pulled with retries -----------------------------------

test('the image follows the checked-out package.json version, with :latest only as a fallback', () => {
  assert.equal(HIVE_MIND_IMAGE_REPOSITORY, 'konard/hive-mind');
  assert.deepEqual(resolveDraftImages({ version: '2.35.9' }), { image: 'konard/hive-mind:2.35.9', fallback: 'konard/hive-mind:latest' });
  assert.deepEqual(resolveDraftImages({ override: 'example/hive:candidate', version: '2.35.9' }), { image: 'example/hive:candidate', fallback: null }, 'an explicit image is used as given');
  assert.deepEqual(resolveDraftImages({ override: '  ', version: 'not-a-version' }), { image: 'konard/hive-mind:latest', fallback: null });
  assert.deepEqual(resolveDraftImages({}), { image: 'konard/hive-mind:latest', fallback: null });
});

test('pull failures are classified: a missing tag is not retried, a registry timeout is', () => {
  assert.equal(classifyPullFailure('Error response from daemon: manifest for konard/hive-mind:9.9.9 not found: manifest unknown: manifest unknown'), 'missing');
  assert.equal(classifyPullFailure("Error response from daemon: pull access denied for konard/nope, repository does not exist or may require 'docker login'"), 'missing');
  assert.equal(classifyPullFailure('Error response from daemon: Get "https://registry-1.docker.io/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)'), 'transient');
  assert.equal(classifyPullFailure('Error response from daemon: Head "https://registry-1.docker.io/v2/konard/hive-mind/manifests/latest": Get "https://auth.docker.io/token?…": context deadline exceeded'), 'transient');
  assert.equal(classifyPullFailure('toomanyrequests: You have reached your pull rate limit.'), 'transient');
});

test('a registry timeout is retried with backoff until the pull succeeds', async () => {
  const calls = [];
  const sleeps = [];
  const outcomes = [
    { code: 1, output: 'net/http: request canceled while waiting for connection' },
    { code: 1, output: 'context deadline exceeded' },
    { code: 0, output: 'Status: Downloaded newer image for konard/hive-mind:2.35.9' },
  ];
  const result = await pullImageWithRetry({ image: 'konard/hive-mind:2.35.9', run: async args => (calls.push(args), outcomes.shift()), sleep: async ms => sleeps.push(ms), delays: [10, 20, 40], log: () => {} });
  assert.deepEqual(result, { ok: true, attempts: 3 });
  assert.deepEqual(calls, [
    ['pull', 'konard/hive-mind:2.35.9'],
    ['pull', 'konard/hive-mind:2.35.9'],
    ['pull', 'konard/hive-mind:2.35.9'],
  ]);
  assert.deepEqual(sleeps, [10, 20], 'each retry waits longer');
});

test('a registry that never answers fails the pull after the last retry, naming the error', async () => {
  const sleeps = [];
  const result = await pullImageWithRetry({ image: 'konard/hive-mind:2.35.9', run: async () => ({ code: 1, output: 'line one\ncontext deadline exceeded\n' }), sleep: async ms => sleeps.push(ms), delays: [10, 20], log: () => {} });
  assert.equal(result.ok, false);
  assert.equal(result.missing, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.error, 'context deadline exceeded');
  assert.deepEqual(sleeps, [10, 20]);
});

test('a pinned tag that is not published yet falls back to :latest with a warning', async () => {
  const pulled = [];
  const warnings = [];
  const image = await pullDraftImage({
    version: '2.36.0',
    run: async ([, image]) => (pulled.push(image), image.endsWith(':2.36.0') ? { code: 1, output: 'manifest unknown' } : { code: 0, output: '' }),
    sleep: async () => {},
    delays: [1, 1],
    log: () => {},
    warn: message => warnings.push(message),
  });
  assert.equal(image, 'konard/hive-mind:latest');
  assert.deepEqual(pulled, ['konard/hive-mind:2.36.0', 'konard/hive-mind:latest'], 'a missing tag is not retried');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /konard\/hive-mind:2\.36\.0 is not published/);
});

test('a transient failure of the pinned tag does not silently switch images', async () => {
  const pulled = [];
  await assert.rejects(pullDraftImage({ version: '2.35.9', run: async ([, image]) => (pulled.push(image), { code: 1, output: 'context deadline exceeded' }), sleep: async () => {}, delays: [1], log: () => {}, warn: () => {} }), /Could not pull konard\/hive-mind:2\.35\.9 after 2 attempts: context deadline exceeded/);
  assert.deepEqual(pulled, ['konard/hive-mind:2.35.9', 'konard/hive-mind:2.35.9']);
});

// --- 3. The container knows it is ephemeral -----------------------------------

test('the container is told it is removed on exit and which run holds its log', () => {
  assert.deepEqual(buildRunContextEnv({ GITHUB_ACTIONS: 'true', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'link-assistant/hive-mind', GITHUB_RUN_ID: '38515996193' }), {
    HIVE_MIND_EPHEMERAL_CONTAINER: '1',
    HIVE_MIND_CI_RUN_URL: 'https://github.com/link-assistant/hive-mind/actions/runs/38515996193',
  });
  assert.deepEqual(buildRunContextEnv({}), { HIVE_MIND_EPHEMERAL_CONTAINER: '1' });
});

// --- 8. A caller-built Formal AI binary --------------------------------------

test('a caller-built Formal AI binary is mounted read-only over the bundled one', () => {
  const argv = buildDockerArgv({
    solveArgv: buildSolveArgv({ issueUrl: ISSUE_URL }),
    image: 'konard/hive-mind:2.35.9',
    extraMounts: [`/runner/temp/formal-ai-binary/formal-ai:${FORMAL_AI_BINARY_CONTAINER_PATH}:ro`],
  });
  assert.equal(FORMAL_AI_BINARY_CONTAINER_PATH, '/usr/local/bin/formal-ai');
  const mount = argv.indexOf('/runner/temp/formal-ai-binary/formal-ai:/usr/local/bin/formal-ai:ro');
  assert.ok(mount > 0 && argv[mount - 1] === '-v', argv.join(' '));
  assert.ok(mount < argv.indexOf('konard/hive-mind:2.35.9'), 'docker options precede the image');
  assert.deepEqual(buildDockerArgv({ solveArgv: ['x'] }).slice(0, 4), ['run', '--rm', '--user', 'box'], 'existing callers are unchanged');
});

// --- Health: decision and first error as annotations ----------------------------

test('the first error is read from the session log without its timestamp and level', () => {
  const log = ['[2026-10-14T05:23:00.000Z] [INFO] 🚀 solve v2.35.9', '[2026-10-14T05:24:00.000Z] [ERROR] Warning text that is not the failure', '[2026-10-14T05:25:00.000Z] [ERROR] ❌ Agent reported error: Error: File not found: /tmp/gh-issue-solver-1791727879522/e.g', '[2026-10-14T05:26:00.000Z] [ERROR] ❌ Auto-restart limit reached'].join('\n');
  assert.equal(firstErrorLine(log), 'Agent reported error: Error: File not found: /tmp/gh-issue-solver-1791727879522/e.g');
  assert.equal(firstErrorLine('[2026-10-14T05:24:00.000Z] [ERROR] Something broke\n'), 'Something broke', 'without a ❌ line the first [ERROR] line is used');
  assert.equal(firstErrorLine('[2026-10-14T05:24:00.000Z] [INFO] fine\n'), null);
  assert.equal(firstErrorLine(''), null);
});

test('annotations are escaped so a message cannot inject another workflow command', () => {
  assert.equal(formatWorkflowAnnotation('notice', 'Formal AI draft decision', 'run'), '::notice title=Formal AI draft decision::run');
  assert.equal(formatWorkflowAnnotation('error', 'Formal AI draft failed', '100% bad\r\n::warning::x'), '::error title=Formal AI draft failed::100%25 bad%0D%0A::warning::x');
  assert.equal(formatWorkflowAnnotation('error', 'a,b:c', 'm'), '::error title=a%2Cb%3Ac::m');
});

// --- Workflow structure -------------------------------------------------------

test('the workflow is reusable and still opens a draft for every new issue here', () => {
  const on = block(workflowText, 'on:');
  assert.match(on, /^ {2}issues:\n {4}types: \[opened\]$/m, 'the trigger of #2233 is unchanged');
  const call = block(on, '  workflow_call:');
  for (const name of ['issue_number', 'image', 'formal_ai_binary_artifact', 'hive_mind_repository', 'hive_mind_ref']) assert.match(call, new RegExp(`^ {6}${name}:$`, 'm'), `workflow_call input ${name}`);
  assert.match(block(call, '      hive_mind_repository:'), /default: link-assistant\/hive-mind/);
  for (const name of ['AUTOMATION_APP_PRIVATE_KEY', 'AUTOMATION_TOKEN']) assert.match(block(call, `      ${name}:`), /required: false/, `optional secret ${name}`);

  const draft = job('draft');
  assert.match(draft, /repository: \$\{\{ inputs\.hive_mind_repository \|\| github\.repository \}\}/, "a caller runs Hive Mind's scripts, not its own checkout");
  assert.match(draft, /if: \$\{\{ inputs\.formal_ai_binary_artifact != '' \}\}\n\s+uses: actions\/download-artifact@v\d+/, "the caller's binary artifact is downloaded");
  assert.match(draft, /FORMAL_AI_DRAFT_IMAGE: \$\{\{ inputs\.image \|\| vars\.FORMAL_AI_DRAFT_IMAGE \}\}/);
  assert.match(draft, /FORMAL_AI_DRAFT_BINARY: /, 'the binary path reaches the script');
  assert.doesNotMatch(workflowText, /konard\/hive-mind:latest/, 'the workflow no longer pins :latest; the script picks the versioned image');
  assert.match(job('health'), /if: github\.event_name == 'schedule' && !inputs\.hive_mind_repository/, "a caller's schedule does not run this repository's health check");
});

test('dispatched check results are reported on the draft head with the permission that needs', () => {
  assert.match(job('draft'), /outputs:\n\s+head_branch: .*\n\s+checks_dispatched: /, 'the draft job hands the head branch to the reporter');
  const report = job('report-checks');
  assert.match(report, /needs: draft/);
  assert.match(report, /permissions:\n(?: +\S[^\n]*\n)*? +statuses: write/);
  assert.match(report, /actions: read/);
  assert.match(report, /timeout-minutes: \d+/);
  assert.match(report, /if: \$\{\{ !cancelled\(\) && needs\.draft\.outputs\.checks_dispatched == 'true' \}\}/);
  assert.match(report, /node scripts\/formal-ai-draft-checks\.mjs/);
});

test('every translation documents the reuse, the pinned image and the reported checks', () => {
  for (const suffix of ['', '.ru', '.zh', '.hi']) {
    const doc = readFileSync(`docs/FORMAL-AI-DRAFTS${suffix}.md`, 'utf8');
    for (const term of ['workflow_call', 'formal_ai_binary_artifact', '--no-auto-restart-on-uncommitted-changes', 'konard/hive-mind:<version>', 'report-checks', 'FORMAL_AI_CACHE_DIR']) {
      assert.ok(doc.includes(term), `docs/FORMAL-AI-DRAFTS${suffix}.md mentions ${term}`);
    }
  }
});
