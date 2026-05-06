#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #1737: budget stats must report restored-context input pressure.
 *
 * The input figure for a request/sub-session is:
 *   input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *
 * The Total line still keeps new/cache-write/cache-read buckets separate.
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';
import { calculateSessionTokens } from '../src/claude.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

const test = async (name, fn) => {
  try {
    await fn();
    console.log(`PASS ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`   ${error.message}`);
    testsFailed++;
  }
};

const OPUS_MODEL_INFO = { limit: { context: 1_000_000, output: 128_000 } };
const HAIKU_MODEL_INFO = { limit: { context: 200_000, output: 64_000 } };

await test('renders Opus sub-sessions without peak request label', async () => {
  const tokenUsage = {
    modelUsage: {
      'claude-opus-4-7': {
        inputTokens: 20_508,
        cacheCreationTokens: 280_174,
        cacheReadTokens: 4_939_349,
        outputTokens: 63_155,
        modelName: 'Claude Opus 4.7',
        modelInfo: OPUS_MODEL_INFO,
        peakContextUsage: 155_300,
        costUSD: 5.902177,
      },
    },
    subSessions: [
      { inputTokens: 54, cacheCreationTokens: 127_298, cacheReadTokens: 3_442_071, outputTokens: 39_036, messageCount: 45, peakContextUsage: 155_300, peakOutputUsage: 5_223 },
      { inputTokens: 32, cacheCreationTokens: 65_623, cacheReadTokens: 1_238_528, outputTokens: 7_666, messageCount: 22, peakContextUsage: 147_300, peakOutputUsage: 1_922 },
    ],
  };

  const result = buildBudgetStatsString(tokenUsage);

  assert.match(result, /\*\*Claude Opus 4\.7:\*\* \(2 sub-sessions\)/);
  assert.ok(result.includes('1. 155.3K / 1M (16%) input tokens, 39.0K / 128K (30%) output tokens'), result);
  assert.ok(result.includes('2. 147.3K / 1M (15%) input tokens, 7.7K / 128K (6%) output tokens'), result);
  assert.ok(result.includes('Total: (20.5K new + 280.2K cache writes + 4.9M cache reads) input tokens, 63.2K output tokens, $5.902177 cost'), result);
  assert.ok(!result.includes('peak request:'), result);
  assert.ok(!result.includes('session segments'), result);
});

await test('renders single sub-agent input as total input with context limit', async () => {
  const tokenUsage = {
    modelUsage: {
      'claude-haiku-4-5-20251001': {
        inputTokens: 28_487,
        cacheCreationTokens: 165_470,
        cacheReadTokens: 0,
        outputTokens: 6_700,
        modelName: 'Claude Haiku 4.5',
        modelInfo: HAIKU_MODEL_INFO,
        peakContextUsage: 0,
        costUSD: 0.388825,
        _sourceResultJson: true,
      },
    },
    subSessions: [],
  };

  const result = buildBudgetStatsString(tokenUsage);

  assert.ok(result.includes('- 194.0K / 200K (97%) input tokens, 6.7K / 64K (10%) output tokens'), result);
  assert.ok(result.includes('Total: (28.5K new + 165.5K cache writes) input tokens, 6.7K output tokens, $0.388825 cost'), result);
});

await test('calculateSessionTokens includes cache reads in peak context', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'hive-mind-1737-'));
  const homeDir = path.join(root, 'home');
  const tempDir = path.join(root, 'workspace');
  const sessionId = 'session-issue-1737';
  const projectDirName = tempDir.replace(/\//g, '-');
  const sessionDir = path.join(homeDir, '.claude', 'projects', projectDirName);

  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    path.join(sessionDir, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        message: {
          id: 'msg_first',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 10, cache_creation_input_tokens: 90, cache_read_input_tokens: 1000, output_tokens: 50 },
        },
      }),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: '2026-05-01T10:00:00Z' }),
      JSON.stringify({
        message: {
          id: 'msg_second',
          model: 'claude-opus-4-7',
          usage: { input_tokens: 5, cache_creation_input_tokens: 15, cache_read_input_tokens: 300, output_tokens: 20 },
        },
      }),
    ].join('\n')
  );

  try {
    const tokenUsage = await calculateSessionTokens(sessionId, tempDir, null, {
      homeDir,
      fetchModelInfo: async () => ({
        name: 'Claude Opus 4.7',
        limit: { context: 1_000_000, output: 128_000 },
        cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
      }),
    });

    assert.equal(tokenUsage.peakContextUsage, 1100);
    assert.equal(tokenUsage.modelUsage['claude-opus-4-7'].peakContextUsage, 1100);
    assert.equal(tokenUsage.subSessions[0].peakContextUsage, 1100);
    assert.equal(tokenUsage.subSessions[1].peakContextUsage, 320);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

console.log(`\nTests: ${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) process.exit(1);
