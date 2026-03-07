#!/usr/bin/env node

/**
 * Experiment: Reproduce and verify the "no low surrogate in string" JSON error
 *
 * This script demonstrates how lone Unicode surrogates in JavaScript strings
 * cause JSON serialization failures with strict parsers, and verifies that
 * the sanitizeSurrogates() fix resolves the issue.
 *
 * Related: https://github.com/link-assistant/hive-mind/issues/1204
 * Related: https://github.com/anthropics/claude-code/issues/1709
 */

import { sanitizeSurrogates } from '../src/lib.mjs';

console.log('=== Issue #1204: Lone Surrogate Reproduction ===\n');

// --- Part 1: Demonstrate the problem ---

console.log('--- Part 1: Demonstrating the problem ---\n');

// Create a string with a lone high surrogate (U+D800)
// In JavaScript, this is a valid string but produces invalid JSON
const loneHighSurrogate = 'Hello \uD800 World';
const loneLowSurrogate = 'Hello \uDC00 World';
const validSurrogatePair = 'Hello \uD83D\uDE00 World'; // 😀

console.log('String with lone high surrogate:', JSON.stringify(loneHighSurrogate));
console.log('String with lone low surrogate:', JSON.stringify(loneLowSurrogate));
console.log('String with valid surrogate pair:', JSON.stringify(validSurrogatePair));

// JSON.stringify in JavaScript doesn't throw on lone surrogates,
// but produces invalid JSON that strict parsers reject
const jsonWithLoneSurrogate = JSON.stringify({ content: loneHighSurrogate });
console.log('\nJSON.stringify output (contains invalid escape):', jsonWithLoneSurrogate);

// Verify that JavaScript can parse its own invalid output (lenient parser)
try {
  JSON.parse(jsonWithLoneSurrogate);
  console.log('JavaScript JSON.parse: ACCEPTED (lenient parser)');
} catch (e) {
  console.log('JavaScript JSON.parse: REJECTED -', e.message);
}

// Simulate what a strict parser (like Anthropic's) would do
// A strict parser following RFC 8259 would reject lone surrogates
const hasLoneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(loneHighSurrogate);
console.log('Contains lone surrogate:', hasLoneSurrogate, '(strict parser would reject)');

// --- Part 2: Common sources of lone surrogates ---

console.log('\n--- Part 2: Common sources of lone surrogates ---\n');

// Source 1: Binary data interpreted as text
const binaryBytes = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xed, 0xa0, 0x80, 0x57, 0x6f, 0x72, 0x6c, 0x64]);
// Note: \xED\xA0\x80 is the UTF-8 encoding of U+D800 (lone high surrogate) - this is technically invalid UTF-8
const fromBinary = binaryBytes.toString('utf8');
console.log('Binary data as UTF-8 string:', JSON.stringify(fromBinary));
console.log('Has lone surrogates:', /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(fromBinary));

// Source 2: String.fromCharCode with surrogate values
const fromCharCode = String.fromCharCode(0xd800);
console.log('String.fromCharCode(0xD800):', JSON.stringify(fromCharCode));

// --- Part 3: Verify the fix ---

console.log('\n--- Part 3: Verifying sanitizeSurrogates() fix ---\n');

const testCases = [
  { name: 'Lone high surrogate', input: 'Hello \uD800 World', expected: 'Hello \uFFFD World' },
  { name: 'Lone low surrogate', input: 'Hello \uDC00 World', expected: 'Hello \uFFFD World' },
  { name: 'Valid surrogate pair (emoji)', input: 'Hello \uD83D\uDE00 World', expected: 'Hello \uD83D\uDE00 World' },
  { name: 'Multiple lone surrogates', input: '\uD800\uD801\uD802', expected: '\uFFFD\uFFFD\uFFFD' },
  { name: 'Mixed valid and invalid', input: '\uD83D\uDE00\uD800\uD83D\uDE00', expected: '\uD83D\uDE00\uFFFD\uD83D\uDE00' },
  { name: 'No surrogates', input: 'Normal ASCII text', expected: 'Normal ASCII text' },
  { name: 'Empty string', input: '', expected: '' },
  { name: 'High followed by non-low', input: '\uD800A', expected: '\uFFFDA' },
  { name: 'Lone low at start', input: '\uDC00Hello', expected: '\uFFFDHello' },
  { name: 'Lone high at end', input: 'Hello\uDBFF', expected: 'Hello\uFFFD' },
];

let passed = 0;
let failed = 0;

for (const { name, input, expected } of testCases) {
  const result = sanitizeSurrogates(input);
  const ok = result === expected;
  if (ok) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);

// --- Part 4: Verify JSON output is valid after sanitization ---

console.log('\n--- Part 4: JSON roundtrip after sanitization ---\n');

const problematicData = {
  content: loneHighSurrogate,
  nested: { value: loneLowSurrogate },
  array: [validSurrogatePair, loneHighSurrogate],
};

// Sanitize all string values
const sanitizeObject = obj => {
  if (typeof obj === 'string') return sanitizeSurrogates(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sanitizeObject(v)]));
  }
  return obj;
};

const sanitized = sanitizeObject(problematicData);
const jsonString = JSON.stringify(sanitized);

// Verify no lone surrogates remain
const hasLoneSurrogateAfter = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(jsonString);
console.log('JSON after sanitization contains lone surrogates:', hasLoneSurrogateAfter);
console.log('JSON roundtrip valid:', JSON.stringify(JSON.parse(jsonString)) === jsonString);

// Verify valid emoji survived
const parsed = JSON.parse(jsonString);
const emojiSurvived = parsed.array[0] === validSurrogatePair;
console.log('Valid emoji survived sanitization:', emojiSurvived);

console.log('\n=== Experiment complete ===');

process.exit(failed > 0 ? 1 : 0);
