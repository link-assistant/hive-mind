#!/usr/bin/env node

/**
 * Tests for issue #1706: --sub-session-size and --disable-1m-context.
 *
 * Covers:
 *   - parseSubSessionSize: tokens (150k, 1m, 200000), percentages (50%), default/auto/off
 *   - applySubSessionSizeToClaudeEnv: env vars set for tokens/percent, none for default
 *   - applyDisable1mContextToClaudeEnv: env var set when disabled
 *   - buildCodexSubSessionSizeConfigArgs: -c model_auto_compact_token_limit=...
 *   - buildCodexDisable1mContextConfigArgs: -c model_context_window=...
 *   - SOLVE_OPTION_DEFINITIONS: defaults are 150k and true (disable-1m-context)
 *   - getClaudeEnv: integration via config.lib.mjs
 *
 * @hive-mind-test-suite default
 */

import { parseSubSessionSize, applySubSessionSizeToClaudeEnv, applyDisable1mContextToClaudeEnv, buildCodexSubSessionSizeConfigArgs, buildCodexDisable1mContextConfigArgs } from '../src/sub-session-size.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getClaudeEnv } from '../src/config.lib.mjs';

let passed = 0;
let failed = 0;

const pass = name => {
  console.log(`✅ ${name}`);
  passed++;
};

const fail = (name, detail) => {
  console.log(`❌ ${name}`);
  if (detail) console.log(`   ${detail}`);
  failed++;
};

const assertEqual = (name, actual, expected) => {
  const ok = actual === expected;
  if (ok) pass(name);
  else fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const assertDeep = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass(name);
  else fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

const assertThrows = (name, fn, messageMatch) => {
  try {
    fn();
    fail(name, 'expected throw');
  } catch (e) {
    if (!messageMatch || e.message.includes(messageMatch)) pass(name);
    else fail(name, `expected message containing "${messageMatch}", got "${e.message}"`);
  }
};

console.log('\n=== parseSubSessionSize ===\n');

{
  const r = parseSubSessionSize('150k');
  assertEqual('parses "150k" → kind=tokens', r.kind, 'tokens');
  assertEqual('parses "150k" → tokens=150000', r.tokens, 150_000);
}
{
  const r = parseSubSessionSize('150K');
  assertEqual('parses "150K" → tokens=150000 (case-insensitive)', r.tokens, 150_000);
}
{
  const r = parseSubSessionSize('150000');
  assertEqual('parses "150000" → tokens=150000', r.tokens, 150_000);
}
{
  const r = parseSubSessionSize('1m');
  assertEqual('parses "1m" → tokens=1000000', r.tokens, 1_000_000);
}
{
  const r = parseSubSessionSize('1.5M');
  assertEqual('parses "1.5M" → tokens=1500000', r.tokens, 1_500_000);
}
{
  const r = parseSubSessionSize('50%');
  assertEqual('parses "50%" → kind=percent', r.kind, 'percent');
  assertEqual('parses "50%" → percent=50', r.percent, 50);
}
{
  const r = parseSubSessionSize('50%', { contextWindow: 200_000 });
  assertEqual('parses "50%" with contextWindow=200000 → tokens=100000', r.tokens, 100_000);
}
{
  const r = parseSubSessionSize('default');
  assertEqual('parses "default" → kind=default', r.kind, 'default');
  assertEqual('parses "default" → tokens=null', r.tokens, null);
}
{
  const r = parseSubSessionSize('auto');
  assertEqual('parses "auto" → kind=default', r.kind, 'default');
}
{
  const r = parseSubSessionSize('off');
  assertEqual('parses "off" → kind=default', r.kind, 'default');
}
{
  const r = parseSubSessionSize('');
  assertEqual('parses "" → kind=default', r.kind, 'default');
}
{
  const r = parseSubSessionSize(undefined);
  assertEqual('parses undefined → kind=default', r.kind, 'default');
}

assertThrows('rejects garbage value "abc"', () => parseSubSessionSize('abc'), '--sub-session-size');
assertThrows('rejects negative percentage', () => parseSubSessionSize('-10%'), '--sub-session-size');
assertThrows('rejects percentage > 100', () => parseSubSessionSize('150%'), '--sub-session-size');

console.log('\n=== applySubSessionSizeToClaudeEnv ===\n');

{
  const env = {};
  const r = applySubSessionSizeToClaudeEnv(env, parseSubSessionSize('150k'), { contextWindow: 200_000 });
  assertEqual('tokens=150k sets CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000', env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '150000');
  assertEqual('tokens=150k sets CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75 (150/200)', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '75');
  assertEqual('tokens=150k → applied=true', r.applied, true);
}
{
  const env = {};
  applySubSessionSizeToClaudeEnv(env, parseSubSessionSize('1m'), { contextWindow: 200_000 });
  // tokens=1000000 / window=200000 → ratio=500% → clamped to 95
  assertEqual('tokens=1m clamps PCT_OVERRIDE to 95 (lower-only semantics)', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '95');
}
{
  const env = {};
  applySubSessionSizeToClaudeEnv(env, parseSubSessionSize('150k'), { contextWindow: null });
  assertEqual('tokens=150k with null contextWindow falls back to PCT=95', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '95');
  assertEqual('tokens=150k with null contextWindow keeps WINDOW=150000', env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '150000');
}
{
  const env = {};
  applySubSessionSizeToClaudeEnv(env, parseSubSessionSize('50%'), { contextWindow: 200_000 });
  assertEqual('percent=50 sets CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '50');
  assertEqual('percent=50 sets CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000', env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '200000');
}
{
  const env = {};
  const r = applySubSessionSizeToClaudeEnv(env, parseSubSessionSize('default'));
  assertEqual('default → no env vars set', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, undefined);
  assertEqual('default → applied=false', r.applied, false);
}

console.log('\n=== applyDisable1mContextToClaudeEnv ===\n');

{
  const env = {};
  applyDisable1mContextToClaudeEnv(env, true);
  assertEqual('disabled=true sets CLAUDE_CODE_DISABLE_1M_CONTEXT=1', env.CLAUDE_CODE_DISABLE_1M_CONTEXT, '1');
}
{
  const env = {};
  applyDisable1mContextToClaudeEnv(env, false);
  assertEqual('disabled=false leaves env untouched', env.CLAUDE_CODE_DISABLE_1M_CONTEXT, undefined);
}

console.log('\n=== buildCodexSubSessionSizeConfigArgs ===\n');

assertDeep('tokens=150k → -c model_auto_compact_token_limit=150000', buildCodexSubSessionSizeConfigArgs(parseSubSessionSize('150k')), ['-c', 'model_auto_compact_token_limit=150000']);
assertDeep('tokens=1m → -c model_auto_compact_token_limit=1000000', buildCodexSubSessionSizeConfigArgs(parseSubSessionSize('1m')), ['-c', 'model_auto_compact_token_limit=1000000']);
assertDeep('default → []', buildCodexSubSessionSizeConfigArgs(parseSubSessionSize('default')), []);
assertDeep('percent without contextWindow → []', buildCodexSubSessionSizeConfigArgs(parseSubSessionSize('50%')), []);
assertDeep('percent=50 with contextWindow=200000 → -c ...=100000', buildCodexSubSessionSizeConfigArgs(parseSubSessionSize('50%'), { contextWindow: 200_000 }), ['-c', 'model_auto_compact_token_limit=100000']);

console.log('\n=== buildCodexDisable1mContextConfigArgs ===\n');

assertDeep('disabled=true → -c model_context_window=200000', buildCodexDisable1mContextConfigArgs(true), ['-c', 'model_context_window=200000']);
assertDeep('disabled=false → []', buildCodexDisable1mContextConfigArgs(false), []);
assertDeep('custom fallbackTokens', buildCodexDisable1mContextConfigArgs(true, { fallbackTokens: 400_000 }), ['-c', 'model_context_window=400000']);

console.log('\n=== SOLVE_OPTION_DEFINITIONS ===\n');

assertEqual('sub-session-size default = "150k"', SOLVE_OPTION_DEFINITIONS['sub-session-size']?.default, '150k');
assertEqual('sub-session-size type = "string"', SOLVE_OPTION_DEFINITIONS['sub-session-size']?.type, 'string');
assertEqual('disable-1m-context default = true', SOLVE_OPTION_DEFINITIONS['disable-1m-context']?.default, true);
assertEqual('disable-1m-context type = "boolean"', SOLVE_OPTION_DEFINITIONS['disable-1m-context']?.type, 'boolean');

console.log('\n=== getClaudeEnv integration ===\n');

{
  const env = getClaudeEnv({
    model: 'claude-sonnet-4-6',
    disable1mContext: true,
    subSessionSize: parseSubSessionSize('150k'),
    contextWindowTokens: 200_000,
  });
  assertEqual('getClaudeEnv: CLAUDE_CODE_DISABLE_1M_CONTEXT=1', env.CLAUDE_CODE_DISABLE_1M_CONTEXT, '1');
  assertEqual('getClaudeEnv: CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000', env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '150000');
  assertEqual('getClaudeEnv: CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '75');
}
{
  const env = getClaudeEnv({
    model: 'claude-sonnet-4-6',
    disable1mContext: false,
    subSessionSize: parseSubSessionSize('default'),
  });
  assertEqual('getClaudeEnv: no DISABLE_1M_CONTEXT when disabled=false', env.CLAUDE_CODE_DISABLE_1M_CONTEXT, undefined);
  assertEqual('getClaudeEnv: no AUTO_COMPACT_WINDOW when sub-session-size=default', env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, undefined);
  assertEqual('getClaudeEnv: no PCT_OVERRIDE when sub-session-size=default', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, undefined);
}
{
  const env = getClaudeEnv({
    model: 'claude-sonnet-4-6',
    disable1mContext: true,
    subSessionSize: parseSubSessionSize('50%'),
    contextWindowTokens: 200_000,
  });
  assertEqual('getClaudeEnv: percent=50 → PCT_OVERRIDE=50', env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE, '50');
  assertEqual('getClaudeEnv: percent=50 → AUTO_COMPACT_WINDOW=200000', env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '200000');
}

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================\n');

process.exit(failed > 0 ? 1 : 0);
