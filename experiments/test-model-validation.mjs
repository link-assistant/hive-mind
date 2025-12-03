#!/usr/bin/env node
/**
 * Test script for model-validation.lib.mjs
 * Tests the validateModelName function and fuzzy matching suggestions
 *
 * Run: node experiments/test-model-validation.mjs
 */

import {
  validateModelName,
  levenshteinDistance,
  findSimilarModels,
  getAvailableModelNames,
  CLAUDE_MODELS,
  OPENCODE_MODELS,
  CODEX_MODELS
} from '../src/model-validation.lib.mjs';

let passed = 0;
let failed = 0;

function test(description, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`❌ FAIL: ${description}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected: ${expected}, Got: ${actual}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`${message} Expected truthy value, got: ${value}`);
  }
}

function assertFalse(value, message = '') {
  if (value) {
    throw new Error(`${message} Expected falsy value, got: ${value}`);
  }
}

function assertIncludes(text, substring, message = '') {
  if (!text.includes(substring)) {
    throw new Error(`${message} Expected "${substring}" to be in "${text}"`);
  }
}

console.log('🧪 Testing model-validation.lib.mjs\n');

// Test Levenshtein distance
console.log('📏 Testing Levenshtein distance...');

test('levenshteinDistance: identical strings have distance 0', () => {
  assertEqual(levenshteinDistance('sonnet', 'sonnet'), 0);
});

test('levenshteinDistance: single character difference', () => {
  assertEqual(levenshteinDistance('sonnet', 'sonned'), 1);
});

test('levenshteinDistance: case insensitive', () => {
  assertEqual(levenshteinDistance('SONNET', 'sonnet'), 0);
});

test('levenshteinDistance: typo detection (sonnt)', () => {
  assertEqual(levenshteinDistance('sonnt', 'sonnet'), 1);
});

test('levenshteinDistance: typo detection (opus vs opsu)', () => {
  assertEqual(levenshteinDistance('opsu', 'opus'), 2);
});

// Test getAvailableModelNames
console.log('\n📋 Testing getAvailableModelNames...');

test('getAvailableModelNames: claude includes sonnet, opus, haiku', () => {
  const names = getAvailableModelNames('claude');
  assertTrue(names.includes('sonnet'), 'sonnet');
  assertTrue(names.includes('opus'), 'opus');
  assertTrue(names.includes('haiku'), 'haiku');
});

test('getAvailableModelNames: opencode includes grok, gpt4o', () => {
  const names = getAvailableModelNames('opencode');
  assertTrue(names.includes('grok'), 'grok');
  assertTrue(names.includes('gpt4o'), 'gpt4o');
});

test('getAvailableModelNames: codex includes gpt5, o3', () => {
  const names = getAvailableModelNames('codex');
  assertTrue(names.includes('gpt5'), 'gpt5');
  assertTrue(names.includes('o3'), 'o3');
});

// Test findSimilarModels
console.log('\n🔍 Testing findSimilarModels...');

test('findSimilarModels: finds sonnet for "sonnt"', () => {
  const validModels = getAvailableModelNames('claude');
  const suggestions = findSimilarModels('sonnt', validModels);
  assertTrue(suggestions.includes('sonnet'), 'should include sonnet');
});

test('findSimilarModels: finds opus for "opsu"', () => {
  const validModels = getAvailableModelNames('claude');
  const suggestions = findSimilarModels('opsu', validModels);
  assertTrue(suggestions.includes('opus'), 'should include opus');
});

test('findSimilarModels: finds haiku for "haiku1"', () => {
  const validModels = getAvailableModelNames('claude');
  const suggestions = findSimilarModels('haiku1', validModels);
  assertTrue(suggestions.includes('haiku'), 'should include haiku');
});

// Test validateModelName for Claude
console.log('\n🤖 Testing validateModelName for Claude...');

test('validateModelName: valid model "sonnet"', () => {
  const result = validateModelName('sonnet', 'claude');
  assertTrue(result.valid, 'should be valid');
  assertEqual(result.mappedModel, CLAUDE_MODELS['sonnet']);
});

test('validateModelName: valid model "opus"', () => {
  const result = validateModelName('opus', 'claude');
  assertTrue(result.valid, 'should be valid');
  assertEqual(result.mappedModel, CLAUDE_MODELS['opus']);
});

test('validateModelName: valid model "haiku"', () => {
  const result = validateModelName('haiku', 'claude');
  assertTrue(result.valid, 'should be valid');
  assertEqual(result.mappedModel, CLAUDE_MODELS['haiku']);
});

test('validateModelName: valid model "haiku-3-5"', () => {
  const result = validateModelName('haiku-3-5', 'claude');
  assertTrue(result.valid, 'should be valid');
  assertEqual(result.mappedModel, CLAUDE_MODELS['haiku-3-5']);
});

test('validateModelName: valid model "haiku-3"', () => {
  const result = validateModelName('haiku-3', 'claude');
  assertTrue(result.valid, 'should be valid');
  assertEqual(result.mappedModel, CLAUDE_MODELS['haiku-3']);
});

test('validateModelName: case insensitive "SONNET"', () => {
  const result = validateModelName('SONNET', 'claude');
  assertTrue(result.valid, 'should be valid (case insensitive)');
});

test('validateModelName: case insensitive "Opus"', () => {
  const result = validateModelName('Opus', 'claude');
  assertTrue(result.valid, 'should be valid (case insensitive)');
});

test('validateModelName: invalid model "sonnt" (typo)', () => {
  const result = validateModelName('sonnt', 'claude');
  assertFalse(result.valid, 'should be invalid');
  assertIncludes(result.message, 'Unrecognized model', 'error message');
  assertIncludes(result.message, 'Did you mean', 'suggestion');
  assertTrue(result.suggestions.includes('sonnet'), 'should suggest sonnet');
});

test('validateModelName: invalid model "invalid-model-xyz"', () => {
  const result = validateModelName('invalid-model-xyz', 'claude');
  assertFalse(result.valid, 'should be invalid');
  assertIncludes(result.message, 'Unrecognized model', 'error message');
});

test('validateModelName: full model ID "claude-sonnet-4-5-20250929"', () => {
  const result = validateModelName('claude-sonnet-4-5-20250929', 'claude');
  assertTrue(result.valid, 'should accept full model ID');
});

// Test validateModelName for OpenCode
console.log('\n🌐 Testing validateModelName for OpenCode...');

test('validateModelName: valid opencode model "grok"', () => {
  const result = validateModelName('grok', 'opencode');
  assertTrue(result.valid, 'should be valid');
});

test('validateModelName: valid opencode model "gpt4o"', () => {
  const result = validateModelName('gpt4o', 'opencode');
  assertTrue(result.valid, 'should be valid');
});

// Test validateModelName for Codex
console.log('\n📝 Testing validateModelName for Codex...');

test('validateModelName: valid codex model "gpt5"', () => {
  const result = validateModelName('gpt5', 'codex');
  assertTrue(result.valid, 'should be valid');
});

test('validateModelName: valid codex model "o3"', () => {
  const result = validateModelName('o3', 'codex');
  assertTrue(result.valid, 'should be valid');
});

// Test edge cases
console.log('\n⚠️ Testing edge cases...');

test('validateModelName: empty string', () => {
  const result = validateModelName('', 'claude');
  assertFalse(result.valid, 'should be invalid for empty string');
});

test('validateModelName: null', () => {
  const result = validateModelName(null, 'claude');
  assertFalse(result.valid, 'should be invalid for null');
});

test('validateModelName: undefined', () => {
  const result = validateModelName(undefined, 'claude');
  assertFalse(result.valid, 'should be invalid for undefined');
});

test('validateModelName: default tool is claude', () => {
  const result = validateModelName('sonnet');
  assertTrue(result.valid, 'should default to claude tool');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
