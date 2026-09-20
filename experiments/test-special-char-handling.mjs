#!/usr/bin/env node

/**
 * Test script for special character handling in telegram-markdown.lib.mjs
 * Tests cleanNonPrintableChars and makeSpecialCharsVisible functions
 */

import { cleanNonPrintableChars, makeSpecialCharsVisible } from '../src/telegram-markdown.lib.mjs';

console.log('Testing special character handling...\n');

const tests = [
  {
    name: 'Zero-width space removal',
    input: 'Hello\u200BWorld',
    expectedClean: 'HelloWorld',
    shouldHaveSpecialChars: true,
  },
  {
    name: 'Zero-width non-joiner removal',
    input: 'Test\u200CString',
    expectedClean: 'TestString',
    shouldHaveSpecialChars: true,
  },
  {
    name: 'Byte order mark removal',
    input: '\uFEFFStart of text',
    expectedClean: 'Start of text',
    shouldHaveSpecialChars: true,
  },
  {
    name: 'Soft hyphen removal',
    input: 'dis\u00ADconnect',
    expectedClean: 'disconnect',
    shouldHaveSpecialChars: true,
  },
  {
    name: 'Multiple spaces normalization',
    input: 'Too    many     spaces',
    expectedClean: 'Too many spaces',
    shouldHaveSpecialChars: false,
  },
  {
    name: 'Tab and newline preservation in visible',
    input: 'Line1\tTab\nLine2',
    expectedClean: 'Line1 Tab\nLine2',
    shouldHaveSpecialChars: true,
  },
  {
    name: 'Control character removal',
    input: 'Text\x00with\x01control\x02chars',
    expectedClean: 'Textwithcontrolchars',
    shouldHaveSpecialChars: true,
  },
  {
    name: 'Normal text unchanged',
    input: 'Normal text with no special characters',
    expectedClean: 'Normal text with no special characters',
    shouldHaveSpecialChars: false,
  },
  {
    name: 'URL with zero-width chars',
    input: 'https://github.com/owner/repo/\u200Bissues/123',
    expectedClean: 'https://github.com/owner/repo/issues/123',
    shouldHaveSpecialChars: true,
  },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  console.log(`\n📝 Test: ${test.name}`);
  console.log(`Input: "${test.input}"`);
  console.log(`Input length: ${test.input.length}`);

  // Test cleanNonPrintableChars
  const cleaned = cleanNonPrintableChars(test.input);
  console.log(`Cleaned: "${cleaned}"`);
  console.log(`Cleaned length: ${cleaned.length}`);

  if (cleaned === test.expectedClean) {
    console.log('✅ Clean test PASSED');
    passed++;
  } else {
    console.log(`❌ Clean test FAILED`);
    console.log(`  Expected: "${test.expectedClean}"`);
    console.log(`  Got: "${cleaned}"`);
    failed++;
  }

  // Test makeSpecialCharsVisible
  const visible = makeSpecialCharsVisible(test.input, { maxLength: 200 });
  console.log(`Visible: "${visible}"`);

  const hasSpecialMarkers = visible.includes('[') && visible.includes(']');
  if (test.shouldHaveSpecialChars) {
    if (hasSpecialMarkers) {
      console.log('✅ Visible test PASSED (special chars marked)');
      passed++;
    } else {
      console.log('❌ Visible test FAILED (expected special char markers)');
      failed++;
    }
  } else {
    if (hasSpecialMarkers || visible !== test.input) {
      console.log('❌ Visible test FAILED (should not have special char markers)');
      failed++;
    } else {
      console.log('✅ Visible test PASSED (no special chars to mark)');
      passed++;
    }
  }
}

// Test truncation
console.log('\n\n📝 Test: Truncation of long strings');
const longText = 'A'.repeat(300) + '\u200B' + 'B'.repeat(100);
const visibleLong = makeSpecialCharsVisible(longText, { maxLength: 200 });
if (visibleLong.length <= 220 && visibleLong.includes('truncated')) {
  console.log('✅ Truncation test PASSED');
  passed++;
} else {
  console.log('❌ Truncation test FAILED');
  console.log(`  Length: ${visibleLong.length}`);
  console.log(`  Includes 'truncated': ${visibleLong.includes('truncated')}`);
  failed++;
}

// Summary
console.log('\n\n' + '='.repeat(50));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
console.log('='.repeat(50));

if (failed === 0) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} test(s) failed`);
  process.exit(1);
}
