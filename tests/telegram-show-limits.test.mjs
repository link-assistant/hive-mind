#!/usr/bin/env node
/**
 * Unit tests for src/telegram-show-limits.lib.mjs (issue #594).
 *
 * Covers: extractShowLimitsFlag, pickLimitsToolKey, captureLimitsSnapshot,
 * formatLimitsSnapshotBlock, formatLimitsDeltaBlock, appendInfoSection,
 * handleShowLimitsFlag, captureStartSnapshotAndAppend.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/594
 */

import assert from 'node:assert/strict';
import { preloadAllLocales } from '../src/i18n.lib.mjs';
import { extractShowLimitsFlag, pickLimitsToolKey, captureLimitsSnapshot, formatLimitsSnapshotBlock, formatLimitsDeltaBlock, appendInfoSection, handleShowLimitsFlag, captureStartSnapshotAndAppend, SHOW_LIMITS_FLAG_NAME, NO_SHOW_LIMITS_FLAG_NAME } from '../src/telegram-show-limits.lib.mjs';

await preloadAllLocales();

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => {
        console.log(`✅ ${name}`);
        passed++;
      },
      err => {
        console.log(`❌ ${name}`);
        console.log(`   ${err?.stack || err?.message || err}`);
        failed++;
      }
    );
}

console.log('\n📋 extractShowLimitsFlag\n');

await test('extracts --show-limits and strips it', () => {
  const r = extractShowLimitsFlag(['https://example.com', '--show-limits', '--verbose']);
  assert.equal(r.showLimits, true);
  assert.deepEqual(r.args, ['https://example.com', '--verbose']);
});

await test('handles --no-show-limits opt-out', () => {
  const r = extractShowLimitsFlag(['--no-show-limits', 'a']);
  assert.equal(r.showLimits, false);
  assert.deepEqual(r.args, ['a']);
});

await test('returns null when flag absent', () => {
  const r = extractShowLimitsFlag(['--verbose', 'a']);
  assert.equal(r.showLimits, null);
  assert.deepEqual(r.args, ['--verbose', 'a']);
});

await test('last occurrence wins (matches yargs)', () => {
  const r = extractShowLimitsFlag(['--show-limits', '--no-show-limits']);
  assert.equal(r.showLimits, false);
});

await test('--show-limits=true / =1 forms', () => {
  assert.equal(extractShowLimitsFlag(['--show-limits=true']).showLimits, true);
  assert.equal(extractShowLimitsFlag(['--show-limits=1']).showLimits, true);
  assert.equal(extractShowLimitsFlag(['--show-limits=false']).showLimits, false);
  assert.equal(extractShowLimitsFlag(['--show-limits=0']).showLimits, false);
});

await test('handles non-array input gracefully', () => {
  const r = extractShowLimitsFlag(null);
  assert.equal(r.showLimits, null);
  assert.deepEqual(r.args, []);
});

await test('exposes flag name constants', () => {
  assert.equal(SHOW_LIMITS_FLAG_NAME, '--show-limits');
  assert.equal(NO_SHOW_LIMITS_FLAG_NAME, '--no-show-limits');
});

console.log('\n📋 pickLimitsToolKey\n');

await test('returns codex for codex tool', () => {
  assert.equal(pickLimitsToolKey('codex'), 'codex');
  assert.equal(pickLimitsToolKey('CODEX'), 'codex');
});

await test('returns claude for claude/opencode/agent/gemini/qwen', () => {
  for (const t of ['claude', 'opencode', 'agent', 'gemini', 'qwen', '', null, undefined]) {
    assert.equal(pickLimitsToolKey(t), 'claude', `tool=${t}`);
  }
});

console.log('\n📋 captureLimitsSnapshot\n');

await test('throws without limitsLib', async () => {
  await assert.rejects(() => captureLimitsSnapshot({ tool: 'claude' }), /requires limitsLib/);
});

await test('routes claude tool to getCachedClaudeLimits', async () => {
  let calledFetcher = null;
  const limitsLib = {
    getCachedClaudeLimits: async () => {
      calledFetcher = 'claude';
      return { success: true, usage: { currentSession: { percentage: 42 } } };
    },
    getCachedCodexLimits: async () => {
      calledFetcher = 'codex';
      return { success: true, usage: {} };
    },
  };
  const snap = await captureLimitsSnapshot({ tool: 'claude', limitsLib });
  assert.equal(calledFetcher, 'claude');
  assert.equal(snap.toolKey, 'claude');
  assert.equal(snap.success, true);
  assert.equal(snap.usage.currentSession.percentage, 42);
  assert.ok(snap.capturedAt instanceof Date);
});

await test('routes codex tool to getCachedCodexLimits', async () => {
  let calledFetcher = null;
  const limitsLib = {
    getCachedClaudeLimits: async () => {
      calledFetcher = 'claude';
      return { success: false };
    },
    getCachedCodexLimits: async () => {
      calledFetcher = 'codex';
      return { success: true, usage: { currentSession: { percentage: 7 }, allModels: { percentage: 11 } } };
    },
  };
  const snap = await captureLimitsSnapshot({ tool: 'codex', limitsLib });
  assert.equal(calledFetcher, 'codex');
  assert.equal(snap.toolKey, 'codex');
});

await test('captures error message from failed fetcher', async () => {
  const limitsLib = {
    getCachedClaudeLimits: async () => ({ success: false, error: 'rate limited' }),
    getCachedCodexLimits: async () => ({ success: false }),
  };
  const snap = await captureLimitsSnapshot({ tool: 'claude', limitsLib });
  assert.equal(snap.success, false);
  assert.equal(snap.error, 'rate limited');
});

console.log('\n📋 formatLimitsSnapshotBlock\n');

await test('renders Claude snapshot with all windows', () => {
  const snap = {
    toolKey: 'claude',
    success: true,
    usage: {
      currentSession: { percentage: 25 },
      allModels: { percentage: 60 },
      sonnetOnly: { percentage: 30 },
    },
  };
  const out = formatLimitsSnapshotBlock(snap);
  assert.match(out, /📊 Limits at start \(Claude\)/);
  assert.match(out, /5h session: 25%/);
  assert.match(out, /7d all models: 60%/);
  assert.match(out, /7d Sonnet only: 30%/);
  assert.match(out, /```/);
});

await test('omits Sonnet line when sonnetOnly missing', () => {
  const snap = { toolKey: 'claude', success: true, usage: { currentSession: { percentage: 0 }, allModels: { percentage: 5 } } };
  const out = formatLimitsSnapshotBlock(snap);
  assert.doesNotMatch(out, /Sonnet/);
});

await test('renders Codex snapshot with weekly label', () => {
  const snap = {
    toolKey: 'codex',
    success: true,
    usage: { currentSession: { percentage: 10 }, allModels: { percentage: 22 } },
  };
  const out = formatLimitsSnapshotBlock(snap);
  assert.match(out, /Codex/);
  assert.match(out, /5h session: 10%/);
  assert.match(out, /Weekly: 22%/);
});

await test('handles failed snapshot with error', () => {
  const snap = { toolKey: 'claude', success: false, error: 'auth failed' };
  const out = formatLimitsSnapshotBlock(snap);
  assert.match(out, /Claude limits: auth failed/);
});

await test('handles N/A percentages', () => {
  const snap = { toolKey: 'claude', success: true, usage: { currentSession: {}, allModels: {} } };
  const out = formatLimitsSnapshotBlock(snap);
  assert.match(out, /5h session: N\/A/);
  assert.match(out, /7d all models: N\/A/);
});

await test('returns empty string for null snapshot', () => {
  assert.equal(formatLimitsSnapshotBlock(null), '');
});

await test('honors custom title', () => {
  const snap = { toolKey: 'claude', success: true, usage: { currentSession: { percentage: 0 }, allModels: { percentage: 0 } } };
  const out = formatLimitsSnapshotBlock(snap, { title: '📊 Custom title' });
  assert.match(out, /📊 Custom title/);
});

await test('localizes snapshot labels', () => {
  const snap = {
    toolKey: 'claude',
    success: true,
    usage: {
      currentSession: { percentage: 25 },
      allModels: { percentage: 60 },
      sonnetOnly: { percentage: 30 },
    },
  };
  const out = formatLimitsSnapshotBlock(snap, { locale: 'ru' });
  assert.match(out, /📊 Лимиты в начале \(Claude\)/);
  assert.match(out, /5-часовой сеанс: 25%/);
  assert.match(out, /7 дней, все модели: 60%/);
  assert.doesNotMatch(out, /Limits at start/);
});

console.log('\n📋 formatLimitsDeltaBlock\n');

await test('shows start, end, and delta for each window', () => {
  const start = {
    toolKey: 'claude',
    success: true,
    usage: { currentSession: { percentage: 10 }, allModels: { percentage: 20 }, sonnetOnly: { percentage: 5 } },
  };
  const end = {
    toolKey: 'claude',
    success: true,
    usage: { currentSession: { percentage: 30 }, allModels: { percentage: 21 }, sonnetOnly: { percentage: 5 } },
  };
  const out = formatLimitsDeltaBlock(start, end);
  assert.match(out, /📊 Limits change \(Claude\)/);
  assert.match(out, /5h session: 10% → 30% \(\+20%\)/);
  assert.match(out, /7d all models: 20% → 21% \(\+1%\)/);
  assert.match(out, /7d Sonnet only: 5% → 5% \(±0%\)/);
  // Disclaimer about parallel sessions
  assert.match(out, /parallel sessions share the same budget/);
});

await test('uses Weekly label for Codex deltas', () => {
  const start = { toolKey: 'codex', success: true, usage: { currentSession: { percentage: 1 }, allModels: { percentage: 2 } } };
  const end = { toolKey: 'codex', success: true, usage: { currentSession: { percentage: 5 }, allModels: { percentage: 6 } } };
  const out = formatLimitsDeltaBlock(start, end);
  assert.match(out, /Codex/);
  assert.match(out, /Weekly: 2% → 6% \(\+4%\)/);
});

await test('returns empty string for mismatched tool keys', () => {
  const start = { toolKey: 'claude', success: true, usage: {} };
  const end = { toolKey: 'codex', success: true, usage: {} };
  assert.equal(formatLimitsDeltaBlock(start, end), '');
});

await test('returns empty string when either snapshot is null', () => {
  assert.equal(formatLimitsDeltaBlock(null, { toolKey: 'claude' }), '');
  assert.equal(formatLimitsDeltaBlock({ toolKey: 'claude' }, null), '');
});

await test('handles both snapshots failing', () => {
  const start = { toolKey: 'claude', success: false, error: 'err1' };
  const end = { toolKey: 'claude', success: false, error: 'err2' };
  const out = formatLimitsDeltaBlock(start, end);
  assert.match(out, /Start: err1/);
  assert.match(out, /End: err2/);
});

await test('localizes delta labels', () => {
  const start = { toolKey: 'codex', success: true, usage: { currentSession: { percentage: 1 }, allModels: { percentage: 2 } } };
  const end = { toolKey: 'codex', success: true, usage: { currentSession: { percentage: 5 }, allModels: { percentage: 6 } } };
  const out = formatLimitsDeltaBlock(start, end, { locale: 'zh' });
  assert.match(out, /📊 限额变化 \(Codex\)/);
  assert.match(out, /5 小时会话: 1% → 5% \(\+4%\)/);
  assert.match(out, /每周: 2% → 6% \(\+4%\)/);
  assert.doesNotMatch(out, /Limits change/);
});

console.log('\n📋 appendInfoSection\n');

await test('appends with double newline separator', () => {
  assert.equal(appendInfoSection('Issue: x', 'block'), 'Issue: x\n\nblock');
});

await test('returns base when addition empty', () => {
  assert.equal(appendInfoSection('A', ''), 'A');
});

await test('returns addition when base empty', () => {
  assert.equal(appendInfoSection('', 'B'), 'B');
});

await test('handles both empty', () => {
  assert.equal(appendInfoSection(null, undefined), '');
});

console.log('\n📋 handleShowLimitsFlag\n');

await test('passes through when flag absent', async () => {
  const replies = [];
  const safeReply = async (_ctx, text) => replies.push(text);
  const r = await handleShowLimitsFlag({ ctx: { message: { message_id: 1 } }, safeReply, args: ['--verbose'], enabled: true });
  assert.equal(r.handled, false);
  assert.equal(r.showLimits, false);
  assert.deepEqual(r.args, ['--verbose']);
  assert.equal(replies.length, 0);
});

await test('honors flag when admin enabled', async () => {
  const replies = [];
  const safeReply = async (_ctx, text) => replies.push(text);
  const r = await handleShowLimitsFlag({ ctx: { message: { message_id: 1 } }, safeReply, args: ['--show-limits'], enabled: true });
  assert.equal(r.handled, false);
  assert.equal(r.showLimits, true);
  assert.deepEqual(r.args, []);
  assert.equal(replies.length, 0);
});

await test('rejects flag when admin disabled', async () => {
  const replies = [];
  const safeReply = async (_ctx, text) => replies.push(text);
  const r = await handleShowLimitsFlag({ ctx: { message: { message_id: 1 } }, safeReply, args: ['--show-limits'], enabled: false });
  assert.equal(r.handled, true);
  assert.equal(r.showLimits, false);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /disabled by the bot administrator/);
});

await test('localizes disabled reply', async () => {
  const replies = [];
  const safeReply = async (_ctx, text) => replies.push(text);
  const r = await handleShowLimitsFlag({ ctx: { message: { message_id: 1 } }, safeReply, args: ['--show-limits'], enabled: false, locale: 'hi' });
  assert.equal(r.handled, true);
  assert.equal(replies.length, 1);
  assert.match(replies[0], /बॉट व्यवस्थापक द्वारा अक्षम/);
});

await test('does not reject when --no-show-limits used while disabled', async () => {
  const replies = [];
  const safeReply = async (_ctx, text) => replies.push(text);
  const r = await handleShowLimitsFlag({ ctx: { message: { message_id: 1 } }, safeReply, args: ['--no-show-limits'], enabled: false });
  assert.equal(r.handled, false);
  assert.equal(r.showLimits, false);
  assert.equal(replies.length, 0);
});

console.log('\n📋 captureStartSnapshotAndAppend\n');

await test('appends "Limits at start" block to infoBlock', async () => {
  const limitsLib = {
    getCachedClaudeLimits: async () => ({ success: true, usage: { currentSession: { percentage: 5 }, allModels: { percentage: 10 } } }),
    getCachedCodexLimits: async () => ({ success: false }),
  };
  const r = await captureStartSnapshotAndAppend({ infoBlock: 'Issue: x', tool: 'claude', limitsLib });
  assert.match(r.infoBlock, /Issue: x/);
  assert.match(r.infoBlock, /📊 Limits at start \(Claude\)/);
  assert.match(r.infoBlock, /5h session: 5%/);
  assert.equal(r.limitsAtStart.toolKey, 'claude');
  assert.equal(r.limitsAtStart.success, true);
});

await test('returns infoBlock unchanged when fetcher throws', async () => {
  const limitsLib = {
    getCachedClaudeLimits: async () => {
      throw new Error('boom');
    },
    getCachedCodexLimits: async () => ({ success: false }),
  };
  const r = await captureStartSnapshotAndAppend({ infoBlock: 'Issue: x', tool: 'claude', limitsLib });
  assert.equal(r.infoBlock, 'Issue: x');
  assert.equal(r.limitsAtStart, null);
});

await test('uses codex fetcher for codex tool', async () => {
  let used = null;
  const limitsLib = {
    getCachedClaudeLimits: async () => {
      used = 'claude';
      return { success: false };
    },
    getCachedCodexLimits: async () => {
      used = 'codex';
      return { success: true, usage: { currentSession: { percentage: 1 }, allModels: { percentage: 2 } } };
    },
  };
  const r = await captureStartSnapshotAndAppend({ infoBlock: '', tool: 'codex', limitsLib });
  assert.equal(used, 'codex');
  assert.equal(r.limitsAtStart.toolKey, 'codex');
  assert.match(r.infoBlock, /Codex/);
  assert.match(r.infoBlock, /Weekly: 2%/);
});

console.log(`\n${'='.repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) process.exit(1);
