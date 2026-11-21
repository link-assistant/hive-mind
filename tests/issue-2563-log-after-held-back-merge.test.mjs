#!/usr/bin/env node
/**
 * Issue #2563: on link-foundation/command-stream#206 the session ended like this:
 *
 *   14:43:44  verifyResults attached the solution draft log (cost estimation,
 *             context and tokens usage, models used)
 *   14:46:27  the auto-merge loop, which ran no AI session, held the merge back
 *             and posted the "Auto-merge blocked" comment
 *   14:46:43  attachLogAfterAutoMergeBlocked uploaded the same log again, and
 *             that comment only had "Models used"
 *
 * The replay below drives the real helpers with the same sequence.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { attachLogAfterAutoMergeBlocked } from '../src/attach-logs-guarantee.lib.mjs';
import { buildAgentBudgetStats } from '../src/claude.budget-stats.lib.mjs';
import { attachLogToGitHub } from '../src/github.lib.mjs';
import { isLatestAiWorkAttached, recordAiSessionFinished, recordLogAttached, rememberLogUsage, withLatestLogUsage } from '../src/log-attach-state.lib.mjs';
import { classifySessionResult } from '../src/session-result.lib.mjs';
import { reportAutoMergeBlockedByIssue } from '../src/solve.auto-merge.lib.mjs';

const blockers = [{ reason: 'issue_unavailable', message: 'Issue #320 in link-foundation/command-stream is no longer accessible.' }];
const heldBack = { success: false, reason: 'issue_unavailable', mergeBlockers: blockers };
// Usage of the codex session that produced command-stream#206.
const pricingInfo = { modelName: 'GPT-6.1 Sol', provider: 'OpenAI', modelId: 'gpt-6.1-sol', tokenUsage: { inputTokens: 357300, outputTokens: 73200, cacheReadTokens: 10100000 } };
const sessionResult = { success: true, sessionId: 'codex-session', publicPricingEstimate: 4.553812, pricingInfo };
const budgetStatsData = { tokenUsage: buildAgentBudgetStats({ inputTokens: 357300, outputTokens: 73200, cacheReadTokens: 10100000, cacheWriteTokens: 0, stepCount: 40, respondedModelId: 'gpt-6.1-sol', contextLimit: 200000, outputLimit: 128000, peakContextUsage: 120000 }, { modelName: 'GPT-6.1 Sol', totalCostUSD: 4.553812 }), subAgentCalls: null };

const guaranteeParams = ({ uploads, logs, globalState }) => ({
  shouldAttachLogs: true,
  prNumber: 206,
  owner: 'link-foundation',
  repo: 'command-stream',
  $: null,
  log: async line => logs.push(line),
  sanitizeLogContent: text => text,
  getLogFile: () => '/tmp/solve.log',
  attachLogToGitHub: async options => {
    uploads.push(options);
    globalState.logAttachedToGitHub = true;
    globalState.latestLogAttachFailed = false;
    recordLogAttached(globalState);
    return true;
  },
  argv: { tool: 'codex', model: 'gpt-6.1-sol' },
  globalState,
});

test('replay of command-stream#206: a held-back merge without new AI work does not upload the same log again', async () => {
  const globalState = {};
  const uploads = [];
  const logs = [];
  const params = guaranteeParams({ uploads, logs, globalState });
  recordAiSessionFinished(sessionResult, globalState); // the codex session ends
  await params.attachLogToGitHub({}); // 14:43:44 verifyResults attaches its log
  uploads.length = 0;
  // 14:46:27 the loop waited for CI and held the merge back.
  assert.equal(await attachLogAfterAutoMergeBlocked({ autoMergeResult: heldBack, ...params }), false);
  assert.equal(uploads.length, 0, 'the log of 14:43:44 already covers the only AI session');
  assert.ok(
    logs.some(line => line.includes('Not uploading the session log again')),
    logs.join('\n')
  );
});

test('a held-back merge still publishes AI work that no attached log covers', async () => {
  for (const prepare of [
    state => recordAiSessionFinished(sessionResult, state), // no log was attached at all
    state => {
      state.logAttachedToGitHub = true;
      recordLogAttached(state);
      recordAiSessionFinished(sessionResult, state); // a restart iteration ran after the upload
    },
    state => {
      state.logAttachedToGitHub = true;
      recordLogAttached(state);
      state.latestLogAttachFailed = true; // the latest upload failed
    },
  ]) {
    const globalState = {};
    const uploads = [];
    prepare(globalState);
    assert.equal(await attachLogAfterAutoMergeBlocked({ autoMergeResult: heldBack, ...guaranteeParams({ uploads, logs: [], globalState }) }), true);
    assert.equal(uploads.length, 1);
    assert.equal(isLatestAiWorkAttached(globalState), true);
  }
});

test('every finished AI session is counted, for every tool', async () => {
  const before = global.aiSessionsFinished || 0;
  for (const tool of ['claude', 'codex', 'opencode', 'agent']) await classifySessionResult({ toolResult: { ...sessionResult, tool }, argv: { tool } });
  assert.equal(global.aiSessionsFinished, before + 4);
  assert.equal(global.latestLogUsage.publicPricingEstimate, 4.553812);
});

test('the held-back notice and new AI work are published as one comment', async () => {
  const globalState = {};
  recordAiSessionFinished(sessionResult, globalState);
  const notices = [];
  const result = await reportAutoMergeBlockedByIssue({ owner: 'link-foundation', repo: 'command-stream', prNumber: 206, issueNumber: '205', mergeBlockers: blockers, globalState, commandRunner: () => assert.fail('no separate comment is posted'), attachLogWithNotice: async notice => notices.push(notice) > 0 });
  assert.deepEqual(result, { posted: true, reason: 'issue_unavailable', combinedWithLog: true });
  assert.equal(notices.length, 1);
  assert.match(notices[0], /Auto-merge blocked: this pull request is ready/);
});

test('without new AI work, or when the combined upload fails, only the notice is posted', async () => {
  const attached = { logAttachedToGitHub: true };
  recordAiSessionFinished(sessionResult, attached);
  recordLogAttached(attached);
  const failing = {};
  recordAiSessionFinished(sessionResult, failing);
  for (const [globalState, attachLogWithNotice] of [
    [attached, async () => assert.fail('the log is already attached')],
    [failing, async () => false],
    [failing, async () => Promise.reject(new Error('upload failed'))],
  ]) {
    // No target: reportAutomationStop answers without calling GitHub, which shows the fallback ran.
    const result = await reportAutoMergeBlockedByIssue({ owner: 'link-foundation', repo: 'command-stream', prNumber: null, issueNumber: '205', mergeBlockers: blockers, globalState, attachLogWithNotice });
    assert.equal(result.skipped, 'missing_target');
  }
});

test('an upload without usage data reuses the latest session usage', () => {
  const globalState = {};
  rememberLogUsage({ argv: { tool: 'codex' }, tool: 'codex', requestedModel: 'gpt-6.1-sol' }, globalState);
  recordAiSessionFinished(sessionResult, globalState);
  rememberLogUsage({ budgetStatsData, resultModelUsage: null }, globalState);
  const filled = withLatestLogUsage({ logFile: 'x', anthropicTotalCostUSD: null, resultModelUsage: null }, globalState);
  assert.equal(filled.publicPricingEstimate, 4.553812);
  assert.equal(filled.pricingInfo, pricingInfo);
  assert.equal(filled.budgetStatsData, budgetStatsData);
  assert.equal(filled.tool, 'codex');
  assert.equal(filled.requestedModel, 'gpt-6.1-sol');
  assert.equal(filled.resultModelUsage, null, 'unknown fields stay as given');
  // Explicit values win, and a new session drops the previous session's usage.
  assert.equal(withLatestLogUsage({ publicPricingEstimate: 1 }, globalState).publicPricingEstimate, 1);
  recordAiSessionFinished({ success: true }, globalState);
  assert.equal(withLatestLogUsage({}, globalState).publicPricingEstimate, undefined);
  assert.equal(withLatestLogUsage({}, globalState).tool, 'codex');
});

test('the re-uploaded log comment has cost estimation, context and tokens usage and models used', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2563-'));
  const saved = { latestLogUsage: global.latestLogUsage, aiSessionsFinished: global.aiSessionsFinished, aiSessionsAtLatestLogAttach: global.aiSessionsAtLatestLogAttach, logAttachedToGitHub: global.logAttachedToGitHub, latestLogAttachFailed: global.latestLogAttachFailed };
  try {
    const logFile = path.join(dir, 'solve.log');
    await fs.writeFile(logFile, 'a transcript line\n'.repeat(50));
    const bodies = [];
    const $ = first => async () => {
      if (first?.stdin) bodies.push(JSON.parse(first.stdin).body);
      return { code: 0, stdout: first?.stdin ? '{"id":6018810946}' : 'public', stderr: '' };
    };
    const target = { logFile, targetType: 'pr', targetNumber: 206, owner: 'link-foundation', repo: 'command-stream', $, log: async () => {}, recordResources: async () => {} };
    const argv = { tool: 'codex', model: 'gpt-6.1-sol', think: 'xhigh' };
    recordAiSessionFinished(sessionResult);
    // verifyResults: the upload with the session's usage.
    assert.equal(await attachLogToGitHub({ ...target, sessionId: 'codex-session', publicPricingEstimate: 4.553812, pricingInfo, budgetStatsData, argv, requestedModel: 'gpt-6.1-sol', tool: 'codex' }), true);
    // The guarantee re-upload, with only what attachUpdatedLog passes.
    assert.equal(await attachLogToGitHub({ ...target, sessionId: 'codex-session', anthropicTotalCostUSD: null, argv, requestedModel: 'gpt-6.1-sol', tool: 'codex', resultModelUsage: null }), true);
    assert.equal(bodies.length, 2);
    for (const body of bodies) {
      for (const section of ['### 💰 **Cost estimation:**', '### 📊 **Context and tokens usage:**', '### 🤖 **Models used:**']) assert.ok(body.includes(section), `${section} missing in:\n${body.slice(0, 1500)}`);
    }
    // The held-back notice leads the log comment it is combined with.
    assert.equal(await attachLogToGitHub({ ...target, leadingSection: '## ⚠️ Auto-merge blocked: this pull request is ready' }), true);
    assert.match(bodies[2], /^## ⚠️ Auto-merge blocked: this pull request is ready\n\n## 🤖 Solution Draft Log\n/);
    assert.ok(bodies[2].includes('### 💰 **Cost estimation:**'));
  } finally {
    Object.assign(global, saved);
    await fs.rm(dir, { recursive: true, force: true });
  }
});
