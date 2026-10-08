#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 * Issue #2771: every tool runs on the cheapest pricing tier by default —
 * standard (non-Fast) speed, the short-context tier, plain model names, and
 * the latest/cheapest model behind each alias.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { applyClaudePricingTierToEnv, applyGeminiFamilyPricingTier, buildCodexPricingTierConfigArgs, buildCodexServiceTierConfigArgs, buildGeminiFamilyCompactionSettings, capSubSessionSizeToShortContext, describePricingTier, getShortContextTokens, normalizeSpeed, resolveClaudeModelForContext, resolveLongContext, resolvePricingTier } from '../src/pricing-tier.lib.mjs';
import { parseSubSessionSize } from '../src/sub-session-size.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getClaudeEnv } from '../src/config.lib.mjs';
import { mapModelToId } from '../src/claude.model-utils.lib.mjs';
import { claudeModels, MODELS_SUPPORTING_1M_CONTEXT } from '../src/models/catalog.mjs';
import { buildAgentCommanderControllerOptions } from '../src/agent-commander.lib.mjs';

const tier = overrides => resolvePricingTier({ tool: 'claude', model: 'opus', modelId: 'claude-opus-5-5', disable1mContext: undefined, subSessionSize: '150k', speed: undefined, ...overrides });

test('solve options default to auto long context and standard speed', () => {
  assert.equal(SOLVE_OPTION_DEFINITIONS['disable-1m-context'].default, undefined);
  assert.equal(SOLVE_OPTION_DEFINITIONS.speed.default, 'standard');
  assert.deepEqual(SOLVE_OPTION_DEFINITIONS.speed.choices, ['standard', 'flex', 'fast', 'ultrafast']);
});

test('speed aliases normalise and unknown speeds are rejected', () => {
  assert.equal(normalizeSpeed(undefined), 'standard');
  assert.equal(normalizeSpeed('default'), 'standard');
  assert.equal(normalizeSpeed('priority'), 'fast');
  assert.equal(normalizeSpeed('slow'), 'flex');
  assert.throws(() => normalizeSpeed('turbo'), /speed/);
});

test('short-context tiers per tool and model', () => {
  assert.equal(getShortContextTokens('claude', 'claude-opus-5-5'), 200_000);
  assert.equal(getShortContextTokens('claude', 'claude-haiku-5-5'), 100_000);
  assert.equal(getShortContextTokens('codex', 'gpt-6.1-sol'), 272_000);
  assert.equal(getShortContextTokens('gemini', 'gemini-3-pro-preview'), 200_000);
  assert.equal(getShortContextTokens('gemini', 'gemini-3-flash-preview'), null);
  assert.equal(getShortContextTokens('qwen', 'qwen3-coder-plus'), 256_000);
});

test('long context only when explicitly requested or implied by a big sub-session', () => {
  assert.equal(resolveLongContext({}).enabled, false);
  assert.equal(resolveLongContext({ disable1mContext: true, has1mSuffix: true }).enabled, false);
  assert.equal(resolveLongContext({ disable1mContext: false }).enabled, true);
  assert.equal(resolveLongContext({ has1mSuffix: true }).enabled, true);
  assert.equal(resolveLongContext({ requestedTokens: 150_000, shortContextTokens: 200_000 }).enabled, false);
  assert.equal(resolveLongContext({ requestedTokens: 500_000, shortContextTokens: 200_000 }).enabled, true);
  assert.equal(tier().longContext, false);
  assert.equal(tier({ subSessionSize: '500k' }).longContext, true);
  assert.equal(tier({ subSessionSize: '500k', disable1mContext: true }).longContext, false);
  assert.match(describePricingTier(tier()), /speed=standard, short context \(≤200000 tokens\)/);
});

test('sub-session sizes above the short tier are capped to 90% of it on short runs', () => {
  const short = { longContext: false, shortContextTokens: 200_000 };
  assert.deepEqual(capSubSessionSizeToShortContext(parseSubSessionSize('190k'), short), { parsed: { kind: 'tokens', tokens: 180_000, percent: null, raw: '190k' }, capped: true });
  assert.equal(capSubSessionSizeToShortContext(parseSubSessionSize('150k'), short).capped, false);
  assert.equal(capSubSessionSizeToShortContext(parseSubSessionSize('190k'), { ...short, longContext: true }).capped, false);
});

test('Claude env: fast mode off and 1M context off by default', () => {
  const env = getClaudeEnv({ model: 'opus', subSessionSize: parseSubSessionSize('150k'), contextWindowTokens: 200_000, pricingTier: tier() });
  assert.equal(env.CLAUDE_CODE_DISABLE_FAST_MODE, '1');
  assert.equal(env.CLAUDE_CODE_DISABLE_1M_CONTEXT, '1');
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '150000');
});

test('Claude env: --speed fast and long context are honoured', () => {
  const env = getClaudeEnv({ model: 'opus', subSessionSize: parseSubSessionSize('500k'), pricingTier: tier({ subSessionSize: '500k', speed: 'fast' }) });
  assert.equal(env.CLAUDE_CODE_DISABLE_FAST_MODE, undefined);
  assert.equal(env.CLAUDE_CODE_DISABLE_1M_CONTEXT, undefined);
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '500000');
});

test('Claude env: Haiku 5.5 compacts below its 100K price cliff', () => {
  const haikuTier = tier({ model: 'haiku', modelId: 'claude-haiku-5-5' });
  assert.equal(haikuTier.longContext, false, 'the 150k default must not opt Haiku 5.5 into its 5x tier');
  const env = {};
  applyClaudePricingTierToEnv(env, haikuTier);
  assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '100000');
  assert.equal(env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '90');
  assert.deepEqual(capSubSessionSizeToShortContext(parseSubSessionSize('150k'), haikuTier).parsed.tokens, 90_000);
  assert.equal(tier({ model: 'haiku', modelId: 'claude-haiku-5-5', subSessionSize: '300k' }).longContext, true);
});

test('Claude model names stay plain by default and gain [1m] only where required', () => {
  assert.deepEqual(resolveClaudeModelForContext('opus', { longContext: false, mapModelToId }), { model: 'opus', changed: false });
  assert.deepEqual(resolveClaudeModelForContext('opus[1m]', { longContext: false, mapModelToId }), { model: 'opus', changed: true });
  assert.deepEqual(resolveClaudeModelForContext('opus', { longContext: true, mapModelToId }), { model: 'opus', changed: false });
  assert.deepEqual(resolveClaudeModelForContext('opus-4-6', { longContext: true, mapModelToId }), { model: 'opus-4-6[1m]', changed: true });
  assert.deepEqual(resolveClaudeModelForContext('claude-sonnet-4-6[1m]', { longContext: true, mapModelToId }), { model: 'claude-sonnet-4-6[1m]', changed: false });
});

test('aliases resolve to the latest and cheapest Claude models; older ones stay available', () => {
  assert.equal(claudeModels.opus, 'claude-opus-5-5');
  assert.equal(claudeModels.sonnet, 'claude-sonnet-5-5');
  assert.equal(claudeModels.haiku, 'claude-haiku-5-5');
  assert.equal(mapModelToId('opus-4-6'), 'claude-opus-4-6');
  assert.equal(mapModelToId('opus-5'), 'claude-opus-5');
  assert.ok(MODELS_SUPPORTING_1M_CONTEXT.includes('claude-sonnet-5-5'));
});

test('Codex: standard service tier and 272K window by default', () => {
  const codexTier = resolvePricingTier({ tool: 'codex', model: 'gpt-6.1-sol', subSessionSize: '150k' });
  const args = buildCodexPricingTierConfigArgs({ tier: codexTier, parsedSubSessionSize: parseSubSessionSize('150k') });
  assert.deepEqual(args.serviceTierArgs, ['-c', 'service_tier=default']);
  assert.deepEqual(args.contextWindowArgs, ['-c', 'model_context_window=272000']);
  assert.deepEqual(args.subSessionSizeArgs, ['-c', 'model_auto_compact_token_limit=150000']);
  const percent = buildCodexPricingTierConfigArgs({ tier: codexTier, parsedSubSessionSize: parseSubSessionSize('50%'), contextWindow: 1_050_000 });
  assert.deepEqual(percent.subSessionSizeArgs, ['-c', 'model_auto_compact_token_limit=136000']);
  assert.deepEqual(buildCodexServiceTierConfigArgs('flex'), ['-c', 'service_tier=flex']);
  assert.deepEqual(buildCodexServiceTierConfigArgs('fast'), ['-c', 'service_tier=fast']);
});

test('Codex: a big --sub-session-size opts into long context', () => {
  const codexTier = resolvePricingTier({ tool: 'codex', model: 'gpt-6.1-sol', subSessionSize: '600k' });
  const args = buildCodexPricingTierConfigArgs({ tier: codexTier, parsedSubSessionSize: parseSubSessionSize('600k') });
  assert.deepEqual(args.contextWindowArgs, []);
  assert.deepEqual(args.subSessionSizeArgs, ['-c', 'model_auto_compact_token_limit=600000']);
});

test('agent-commander forwards the pricing tier to Claude and Codex', () => {
  const claude = buildAgentCommanderControllerOptions({ tool: 'claude', tempDir: '/tmp', prompt: 'p', argv: { model: 'opus', subSessionSize: '150k' } });
  assert.equal(claude.model, 'opus');
  assert.equal(claude.toolOptions.extraEnv.CLAUDE_CODE_DISABLE_FAST_MODE, '1');
  assert.equal(claude.toolOptions.extraEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT, '1');
  // An explicit [1m] asks for long context; native-1M Opus 5.5 needs no suffix.
  const claudeLong = buildAgentCommanderControllerOptions({ tool: 'claude', tempDir: '/tmp', prompt: 'p', argv: { model: 'opus[1m]', subSessionSize: '150k' } });
  assert.equal(claudeLong.model, 'opus');
  assert.equal(claudeLong.toolOptions.extraEnv.CLAUDE_CODE_DISABLE_1M_CONTEXT, undefined);
  const codex = buildAgentCommanderControllerOptions({ tool: 'codex', tempDir: '/tmp', prompt: 'p', argv: { model: 'gpt-6.1-sol', subSessionSize: '150k' } });
  const args = codex.toolOptions.extraArgs.join(' ');
  assert.match(args, /service_tier=default/);
  assert.match(args, /model_context_window=272000/);
  assert.match(args, /model_auto_compact_token_limit=150000/);
});

test('Gemini/Qwen compaction thresholds stay below the price cliff', () => {
  const pro = buildGeminiFamilyCompactionSettings({ tool: 'gemini', modelId: 'gemini-3-pro-preview', parsedSubSessionSize: parseSubSessionSize('default'), longContext: false });
  assert.deepEqual(pro, { model: { compressionThreshold: 0.1717 } });
  const flash = buildGeminiFamilyCompactionSettings({ tool: 'gemini', modelId: 'gemini-3-flash-preview', parsedSubSessionSize: parseSubSessionSize('default'), longContext: false });
  assert.deepEqual(flash, { model: { compressionThreshold: 0.5 } });
  const qwen = buildGeminiFamilyCompactionSettings({ tool: 'qwen', modelId: 'qwen3-coder-plus', parsedSubSessionSize: parseSubSessionSize('100k'), longContext: false });
  assert.deepEqual(qwen, { context: { autoCompactThreshold: 0.1 } });
});

test('Gemini settings file receives the threshold and keeps other keys', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pricing-tier-2771-'));
  try {
    const settingsPath = path.join(dir, 'settings.json');
    await writeFile(settingsPath, JSON.stringify({ ui: { theme: 'dark' } }));
    const { settings } = await applyGeminiFamilyPricingTier({ tool: 'gemini', argv: { subSessionSize: '150k' }, modelId: 'gemini-3-pro-preview', settingsPath });
    assert.deepEqual(settings, { model: { compressionThreshold: 0.1431 } });
    assert.deepEqual(JSON.parse(await readFile(settingsPath, 'utf-8')), { ui: { theme: 'dark' }, model: { compressionThreshold: 0.1431 } });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
