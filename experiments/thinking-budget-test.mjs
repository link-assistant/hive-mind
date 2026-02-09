#!/usr/bin/env node
/**
 * Test script for thinking budget translation (issue #1146)
 * Tests the bidirectional translation between --think and --thinking-budget options
 */

// Test config.lib.mjs exports
import { DEFAULT_MAX_THINKING_BUDGET, DEFAULT_MAX_THINKING_BUDGET_OPUS_46, getThinkingLevelToTokens, getTokensToThinkingLevel, thinkingLevelToTokens, tokensToThinkingLevel, supportsThinkingBudget, getClaudeEnv, thinkLevelToEffortLevel, thinkingBudgetToEffortLevel, OPUS_46_EFFORT_LEVELS } from '../src/config.lib.mjs';

console.log('=== Testing Thinking Budget Translation (Issue #1146) ===\n');

// Test 1: Default max thinking budget
console.log('1. DEFAULT_MAX_THINKING_BUDGET:', DEFAULT_MAX_THINKING_BUDGET);
console.log('   Expected: 31999');
console.log('   Status:', DEFAULT_MAX_THINKING_BUDGET === 31999 ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 2: Default thinking level to tokens mapping
console.log('2. Default thinkingLevelToTokens mapping:');
console.log('   off:', thinkingLevelToTokens.off, '(expected: 0)');
console.log('   low:', thinkingLevelToTokens.low, '(expected: 7999)');
console.log('   medium:', thinkingLevelToTokens.medium, '(expected: 15999)');
console.log('   high:', thinkingLevelToTokens.high, '(expected: 23999)');
console.log('   max:', thinkingLevelToTokens.max, '(expected: 31999)');
const test2Pass = thinkingLevelToTokens.off === 0 && thinkingLevelToTokens.low === 7999 && thinkingLevelToTokens.medium === 15999 && thinkingLevelToTokens.high === 23999 && thinkingLevelToTokens.max === 31999;
console.log('   Status:', test2Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 3: Tokens to thinking level (default)
console.log('3. Default tokensToThinkingLevel function:');
const test3Cases = [
  { tokens: 0, expected: 'off' },
  { tokens: 5000, expected: 'low' },
  { tokens: 8000, expected: 'low' },
  { tokens: 12000, expected: 'medium' },
  { tokens: 16000, expected: 'medium' },
  { tokens: 20000, expected: 'high' },
  { tokens: 24000, expected: 'high' },
  { tokens: 28000, expected: 'max' },
  { tokens: 31999, expected: 'max' },
];
let test3Pass = true;
for (const { tokens, expected } of test3Cases) {
  const result = tokensToThinkingLevel(tokens);
  const pass = result === expected;
  console.log(`   ${tokens} → ${result} (expected: ${expected}) ${pass ? '✅' : '❌'}`);
  if (!pass) test3Pass = false;
}
console.log('   Status:', test3Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 4: Custom max budget
console.log('4. Custom max budget (63999 for 64K output models):');
const customMax = 63999;
const customLevels = getThinkingLevelToTokens(customMax);
console.log('   off:', customLevels.off, '(expected: 0)');
console.log('   low:', customLevels.low, '(expected:', Math.floor(customMax / 4), ')');
console.log('   medium:', customLevels.medium, '(expected:', Math.floor(customMax / 2), ')');
console.log('   high:', customLevels.high, '(expected:', Math.floor((customMax * 3) / 4), ')');
console.log('   max:', customLevels.max, '(expected:', customMax, ')');
const test4Pass = customLevels.off === 0 && customLevels.low === Math.floor(customMax / 4) && customLevels.medium === Math.floor(customMax / 2) && customLevels.high === Math.floor((customMax * 3) / 4) && customLevels.max === customMax;
console.log('   Status:', test4Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 5: Custom tokens to thinking level
console.log('5. Custom tokensToThinkingLevel with max=63999:');
const customTokensToLevel = getTokensToThinkingLevel(customMax);
const test5Cases = [
  { tokens: 0, expected: 'off' },
  { tokens: 16000, expected: 'low' },
  { tokens: 32000, expected: 'medium' },
  { tokens: 48000, expected: 'high' },
  { tokens: 63999, expected: 'max' },
];
let test5Pass = true;
for (const { tokens, expected } of test5Cases) {
  const result = customTokensToLevel(tokens);
  const pass = result === expected;
  console.log(`   ${tokens} → ${result} (expected: ${expected}) ${pass ? '✅' : '❌'}`);
  if (!pass) test5Pass = false;
}
console.log('   Status:', test5Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 6: Version comparison using semver
console.log('6. Version comparison (supportsThinkingBudget):');
const test6Cases = [
  { version: '2.1.12', minVersion: '2.1.12', expected: true },
  { version: '2.1.13', minVersion: '2.1.12', expected: true },
  { version: '2.2.0', minVersion: '2.1.12', expected: true },
  { version: '3.0.0', minVersion: '2.1.12', expected: true },
  { version: '2.1.11', minVersion: '2.1.12', expected: false },
  { version: '2.0.0', minVersion: '2.1.12', expected: false },
  { version: '1.9.0', minVersion: '2.1.12', expected: false },
  { version: 'v2.1.12', minVersion: '2.1.12', expected: true }, // handles 'v' prefix
  { version: '2.1.12-beta', minVersion: '2.1.12', expected: false }, // prerelease is less than release
];
let test6Pass = true;
for (const { version, minVersion, expected } of test6Cases) {
  const result = supportsThinkingBudget(version, minVersion);
  const pass = result === expected;
  console.log(`   ${version} >= ${minVersion}? ${result} (expected: ${expected}) ${pass ? '✅' : '❌'}`);
  if (!pass) test6Pass = false;
}
console.log('   Status:', test6Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 7: Opus 4.6 max thinking budget should equal standard models (Issue #1238)
console.log('7. DEFAULT_MAX_THINKING_BUDGET_OPUS_46 equals DEFAULT_MAX_THINKING_BUDGET:');
console.log('   DEFAULT_MAX_THINKING_BUDGET_OPUS_46:', DEFAULT_MAX_THINKING_BUDGET_OPUS_46);
console.log('   DEFAULT_MAX_THINKING_BUDGET:', DEFAULT_MAX_THINKING_BUDGET);
console.log('   Expected: both should be 31999');
const test7Pass = DEFAULT_MAX_THINKING_BUDGET_OPUS_46 === 31999 && DEFAULT_MAX_THINKING_BUDGET_OPUS_46 === DEFAULT_MAX_THINKING_BUDGET;
console.log('   Status:', test7Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 8: Default thinking budget should be 0 when not specified (Issue #1238)
console.log('8. getClaudeEnv() sets MAX_THINKING_TOKENS=0 by default:');
const envDefault = getClaudeEnv();
const envDefaultValue = envDefault.MAX_THINKING_TOKENS;
console.log('   MAX_THINKING_TOKENS (no options):', envDefaultValue, '(expected: "0")');
const test8aPass = envDefaultValue === '0';
console.log('   Status:', test8aPass ? '✅ PASS' : '❌ FAIL');

console.log('   getClaudeEnv({ thinkingBudget: 16000 }) sets MAX_THINKING_TOKENS=16000:');
const envExplicit = getClaudeEnv({ thinkingBudget: 16000 });
const envExplicitValue = envExplicit.MAX_THINKING_TOKENS;
console.log('   MAX_THINKING_TOKENS (explicit 16000):', envExplicitValue, '(expected: "16000")');
const test8bPass = envExplicitValue === '16000';
console.log('   Status:', test8bPass ? '✅ PASS' : '❌ FAIL');

console.log('   getClaudeEnv({ thinkingBudget: 0 }) sets MAX_THINKING_TOKENS=0:');
const envZero = getClaudeEnv({ thinkingBudget: 0 });
const envZeroValue = envZero.MAX_THINKING_TOKENS;
console.log('   MAX_THINKING_TOKENS (explicit 0):', envZeroValue, '(expected: "0")');
const test8cPass = envZeroValue === '0';
console.log('   Status:', test8cPass ? '✅ PASS' : '❌ FAIL');

const test8Pass = test8aPass && test8bPass && test8cPass;
console.log('   Overall Test 8 Status:', test8Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 9: thinkLevelToEffortLevel conversion (Issue #1238)
console.log('9. thinkLevelToEffortLevel conversion for Opus 4.6:');
const test9Cases = [
  { thinkLevel: undefined, expected: undefined },
  { thinkLevel: 'off', expected: undefined },
  { thinkLevel: 'low', expected: 'low' },
  { thinkLevel: 'medium', expected: 'medium' },
  { thinkLevel: 'high', expected: 'high' },
  { thinkLevel: 'max', expected: 'high' }, // 'max' maps to 'high' (highest Opus 4.6 level)
];
let test9Pass = true;
for (const { thinkLevel, expected } of test9Cases) {
  const result = thinkLevelToEffortLevel(thinkLevel);
  const pass = result === expected;
  const thinkLevelStr = thinkLevel === undefined ? 'undefined' : `'${thinkLevel}'`;
  const expectedStr = expected === undefined ? 'undefined' : `'${expected}'`;
  const resultStr = result === undefined ? 'undefined' : `'${result}'`;
  console.log(`   ${thinkLevelStr} → ${resultStr} (expected: ${expectedStr}) ${pass ? '✅' : '❌'}`);
  if (!pass) test9Pass = false;
}
console.log('   Status:', test9Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 10: thinkingBudgetToEffortLevel conversion (Issue #1238)
console.log('10. thinkingBudgetToEffortLevel conversion for Opus 4.6:');
const test10Cases = [
  { budget: undefined, expected: undefined },
  { budget: 0, expected: undefined },
  { budget: 5000, expected: 'low' },
  { budget: 8000, expected: 'low' },
  { budget: 12000, expected: 'medium' },
  { budget: 16000, expected: 'medium' },
  { budget: 20000, expected: 'high' },
  { budget: 24000, expected: 'high' },
  { budget: 28000, expected: 'high' }, // 'max' maps to 'high'
  { budget: 31999, expected: 'high' }, // 'max' maps to 'high'
];
let test10Pass = true;
for (const { budget, expected } of test10Cases) {
  const result = thinkingBudgetToEffortLevel(budget);
  const pass = result === expected;
  const budgetStr = budget === undefined ? 'undefined' : String(budget);
  const expectedStr = expected === undefined ? 'undefined' : `'${expected}'`;
  const resultStr = result === undefined ? 'undefined' : `'${result}'`;
  console.log(`   ${budgetStr} → ${resultStr} (expected: ${expectedStr}) ${pass ? '✅' : '❌'}`);
  if (!pass) test10Pass = false;
}
console.log('   Status:', test10Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 11: getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL for Opus 4.6 (Issue #1238)
console.log('11. getClaudeEnv sets CLAUDE_CODE_EFFORT_LEVEL for Opus 4.6:');

console.log('   getClaudeEnv({ model: "opus-4-6", thinkLevel: "medium" }):');
const envOpus46Medium = getClaudeEnv({ model: 'opus-4-6', thinkLevel: 'medium' });
const test11aPass = envOpus46Medium.CLAUDE_CODE_EFFORT_LEVEL === 'medium';
console.log(`      CLAUDE_CODE_EFFORT_LEVEL: "${envOpus46Medium.CLAUDE_CODE_EFFORT_LEVEL}" (expected: "medium") ${test11aPass ? '✅' : '❌'}`);

console.log('   getClaudeEnv({ model: "opus-4-6", thinkLevel: "max" }):');
const envOpus46Max = getClaudeEnv({ model: 'opus-4-6', thinkLevel: 'max' });
const test11bPass = envOpus46Max.CLAUDE_CODE_EFFORT_LEVEL === 'high';
console.log(`      CLAUDE_CODE_EFFORT_LEVEL: "${envOpus46Max.CLAUDE_CODE_EFFORT_LEVEL}" (expected: "high") ${test11bPass ? '✅' : '❌'}`);

console.log('   getClaudeEnv({ model: "opus-4-6", thinkLevel: "off" }):');
const envOpus46Off = getClaudeEnv({ model: 'opus-4-6', thinkLevel: 'off' });
const test11cPass = envOpus46Off.CLAUDE_CODE_EFFORT_LEVEL === undefined;
console.log(`      CLAUDE_CODE_EFFORT_LEVEL: ${envOpus46Off.CLAUDE_CODE_EFFORT_LEVEL} (expected: undefined) ${test11cPass ? '✅' : '❌'}`);

console.log('   getClaudeEnv({ model: "opus-4-6", thinkingBudget: 16000 }):');
const envOpus46Budget = getClaudeEnv({ model: 'opus-4-6', thinkingBudget: 16000 });
const test11dPass = envOpus46Budget.CLAUDE_CODE_EFFORT_LEVEL === 'medium';
console.log(`      CLAUDE_CODE_EFFORT_LEVEL: "${envOpus46Budget.CLAUDE_CODE_EFFORT_LEVEL}" (expected: "medium") ${test11dPass ? '✅' : '❌'}`);

console.log('   getClaudeEnv({ model: "sonnet", thinkLevel: "high" }): (non-Opus 4.6)');
const envSonnet = getClaudeEnv({ model: 'sonnet', thinkLevel: 'high' });
const test11ePass = envSonnet.CLAUDE_CODE_EFFORT_LEVEL === undefined;
console.log(`      CLAUDE_CODE_EFFORT_LEVEL: ${envSonnet.CLAUDE_CODE_EFFORT_LEVEL} (expected: undefined) ${test11ePass ? '✅' : '❌'}`);

console.log('   getClaudeEnv({ model: "opus" }): (now Opus 4.5, no effort level)');
const envOpus = getClaudeEnv({ model: 'opus' });
const test11fPass = envOpus.CLAUDE_CODE_EFFORT_LEVEL === undefined;
console.log(`      CLAUDE_CODE_EFFORT_LEVEL: ${envOpus.CLAUDE_CODE_EFFORT_LEVEL} (expected: undefined) ${test11fPass ? '✅' : '❌'}`);

console.log('   getClaudeEnv({ model: "claude-opus-4-6", thinkLevel: "low" }):');
const envOpus46Full = getClaudeEnv({ model: 'claude-opus-4-6', thinkLevel: 'low' });
const test11gPass = envOpus46Full.CLAUDE_CODE_EFFORT_LEVEL === 'low';
console.log(`      CLAUDE_CODE_EFFORT_LEVEL: "${envOpus46Full.CLAUDE_CODE_EFFORT_LEVEL}" (expected: "low") ${test11gPass ? '✅' : '❌'}`);

const test11Pass = test11aPass && test11bPass && test11cPass && test11dPass && test11ePass && test11fPass && test11gPass;
console.log('   Overall Test 11 Status:', test11Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Test 12: OPUS_46_EFFORT_LEVELS constant (Issue #1238)
console.log('12. OPUS_46_EFFORT_LEVELS constant:');
const test12Pass = OPUS_46_EFFORT_LEVELS.length === 3 && OPUS_46_EFFORT_LEVELS.includes('low') && OPUS_46_EFFORT_LEVELS.includes('medium') && OPUS_46_EFFORT_LEVELS.includes('high');
console.log('   OPUS_46_EFFORT_LEVELS:', JSON.stringify(OPUS_46_EFFORT_LEVELS));
console.log('   Expected: ["low", "medium", "high"]');
console.log('   Status:', test12Pass ? '✅ PASS' : '❌ FAIL');
console.log();

// Summary
console.log('=== Test Summary ===');
const allPass = test2Pass && test3Pass && test4Pass && test5Pass && test6Pass && test7Pass && test8Pass && test9Pass && test10Pass && test11Pass && test12Pass;
console.log('Overall:', allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED');

process.exit(allPass ? 0 : 1);
