#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression test for issue #2845: solve's log messages contradicted themselves.
 *
 *   1. "Auto-merge mode enabled" was printed for the default
 *      auto-restart-until-mergeable mode, which never merges.
 *   2. "PR #4 stays a draft" was printed right before the run-end restore
 *      (issue #2312) marked the same pull request ready for review.
 *   3. One failed Claude session printed "💡 To continue this session" three
 *      times: twice inside claude.lib.mjs and once more by solve.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2845
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_RETRY_BACKOFF_MULTIPLIER = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../src/anthropic-cost-accumulator.lib.mjs');
const { ensurePullRequestIsDraft, ensurePullRequestIsReady, ensurePullRequestStaysDraftAfterFailure, markPullRequestCreatedByThisRun, resetWorkingSessionDrafts, restoreDeliberateDraftsAtRunEnd } = await import('../src/pr-draft-state.lib.mjs');

const RESUME_BLOCK = /💡 To continue this session/;
const countResumeBlocks = logs => logs.filter(line => RESUME_BLOCK.test(line)).length;

const sessionEvent = { type: 'system', subtype: 'init', session_id: 'session-2845' };
const failedResult = { type: 'result', subtype: 'success', is_error: true, result: 'API Error: 400 invalid_request_error: invalid request', session_id: 'session-2845' };
const successResult = { type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0, session_id: 'session-2845' };
const limitResult = { type: 'result', subtype: 'success', is_error: true, api_error_status: 429, api_error: 'usage_limit_reached', result: "You've hit your session limit · resets 10:20pm (UTC)", session_id: 'session-2845' };

async function runClaude({ resultEvent, exitCode, showResumeInstructions }) {
  resetCumulativeAnthropicCost();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-2845-'));
  let logFile = path.join(tempDir, 'current.log');
  await writeFile(logFile, '');
  const logs = [];
  const fakeDollar = () => () => ({
    result: { code: exitCode },
    kill() {},
    async *stream() {
      yield { type: 'stdout', data: Buffer.from([sessionEvent, resultEvent].map(event => JSON.stringify(event)).join('\n') + '\n') };
    },
  });
  try {
    const result = await executeClaudeCommand({
      tempDir,
      branchName: 'issue-2845-test',
      prompt: 'Continue.',
      systemPrompt: 'Solve the issue.',
      escapedPrompt: 'Continue.',
      escapedSystemPrompt: 'Solve the issue.',
      argv: { model: 'opus', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/2845', verbose: true, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
      log: async message => logs.push(String(message)),
      getLogFile: () => logFile,
      setLogFile: value => {
        logFile = value;
      },
      formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
      getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      claudePath: 'claude',
      $: fakeDollar,
      owner: 'link-assistant',
      repo: 'hive-mind',
      prNumber: 2853,
      issueNumber: 2845,
      ...(showResumeInstructions === undefined ? {} : { showResumeInstructions }),
    });
    return { result, logs };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// --- 3. resume block -------------------------------------------------------

test('a failed Claude session prints the resume block once (standalone caller)', { timeout: 10000 }, async () => {
  const { result, logs } = await runClaude({ resultEvent: failedResult, exitCode: 1 });
  assert.equal(result.success, false);
  assert.equal(result.sessionId, 'session-2845');
  assert.equal(countResumeBlocks(logs), 1, `expected one resume block, got:\n${logs.join('\n')}`);
});

test('a failed Claude session prints no resume block when solve owns it', { timeout: 10000 }, async () => {
  const { result, logs } = await runClaude({ resultEvent: failedResult, exitCode: 1, showResumeInstructions: false });
  assert.equal(result.success, false);
  assert.equal(countResumeBlocks(logs), 0);
  assert.ok(
    logs.some(line => line.includes('📌 Session ID: session-2845')),
    'the session id is still reported'
  );
});

test('a successful Claude session prints the resume block once, or not at all when solve owns it', { timeout: 10000 }, async () => {
  assert.equal(countResumeBlocks((await runClaude({ resultEvent: successResult, exitCode: 0 })).logs), 1);
  assert.equal(countResumeBlocks((await runClaude({ resultEvent: successResult, exitCode: 0, showResumeInstructions: false })).logs), 0);
});

test('a usage limit lists the resume commands once (in the limit message, not a second block)', { timeout: 10000 }, async () => {
  const { result, logs } = await runClaude({ resultEvent: limitResult, exitCode: 1 });
  assert.equal(result.limitReached, true);
  assert.equal(countResumeBlocks(logs), 0);
  assert.equal(logs.filter(line => line.includes('To resume this session after the limit resets')).length, 1);
});

test('solve asks claude.lib not to print its own resume block', async () => {
  const solveSrc = await readFile(path.join(srcDir, 'solve.mjs'), 'utf8');
  assert.match(solveSrc, /executeClaude\(\{[\s\S]{0,800}showResumeInstructions: false/);
});

// --- 1. auto-merge message -------------------------------------------------

test('"Auto-merge mode enabled" is printed only for --auto-merge', async () => {
  const src = await readFile(path.join(srcDir, 'solve.results.lib.mjs'), 'utf8');
  const autoMergeLine = src.indexOf("'\\n🔄 Auto-merge mode enabled");
  assert.notEqual(autoMergeLine, -1);
  const guard = src.slice(src.lastIndexOf('if (', autoMergeLine), autoMergeLine);
  assert.match(guard, /^if \(argv\.autoMerge\) \{/, `the auto-merge message must be guarded by argv.autoMerge alone, got: ${guard}`);
  assert.match(src, /Auto-restart-until-mergeable mode enabled[^']*will NOT auto-merge/);
});

// --- 2. draft message ------------------------------------------------------

const createFakeGh = ({ isDraft }) => {
  const pr = { isDraft };
  const $ = (strings, ...values) => {
    const command = strings.reduce((out, part, index) => out + part + (index < values.length ? String(values[index]) : ''), '');
    if (command.includes('--json isDraft,state')) return Promise.resolve({ code: 0, stdout: JSON.stringify({ isDraft: pr.isDraft, state: 'OPEN' }), stderr: '' });
    if (command.startsWith('gh pr ready')) {
      pr.isDraft = command.includes('--undo');
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    }
    return Promise.resolve({ code: 1, stdout: '', stderr: `unexpected command: ${command}` });
  };
  return { $, pr };
};
const pr = { owner: 'Godmy', repo: 'stylist-svelte', prNumber: 4 };

test('a draft this run will restore says "kept as draft until run end", not "stays a draft"', async () => {
  resetWorkingSessionDrafts();
  const gh = createFakeGh({ isDraft: true });
  const logs = [];
  const log = async message => logs.push(String(message));
  markPullRequestCreatedByThisRun(pr);
  await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: gh.$, log, reason: 'auto-restart limit 5/5 reached' });
  await ensurePullRequestIsReady({ ...pr, $: gh.$, log });
  assert.ok(logs.includes('  ℹ️  PR #4 kept as draft until run end: auto-restart limit 5/5 reached'), logs.join('\n'));
  assert.ok(!logs.some(line => line.includes('stays a draft')), logs.join('\n'));
  await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log });
  assert.equal(gh.pr.isDraft, false, 'the run-end restore marks it ready, as the message announced');
});

test('a draft a human made before the run still "stays a draft"', async () => {
  resetWorkingSessionDrafts();
  const gh = createFakeGh({ isDraft: true });
  const logs = [];
  const log = async message => logs.push(String(message));
  await ensurePullRequestIsDraft({ ...pr, $: gh.$, log });
  await ensurePullRequestStaysDraftAfterFailure({ ...pr, $: gh.$, log, reason: 'session failed' });
  await ensurePullRequestIsReady({ ...pr, $: gh.$, log });
  assert.ok(logs.includes('  ℹ️  PR #4 stays a draft: session failed'), logs.join('\n'));
  await restoreDeliberateDraftsAtRunEnd({ $: gh.$, log });
  assert.equal(gh.pr.isDraft, true);
});
