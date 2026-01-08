#!/usr/bin/env node

/**
 * Unit tests for Telegram special character handling functions
 * Tests cleanNonPrintableChars() and makeSpecialCharsVisible() functions
 * These functions help handle Telegram API parsing errors caused by invisible Unicode characters
 *
 * Related to Issue #1070 - Make error messages more user-friendly
 */

import { cleanNonPrintableChars, makeSpecialCharsVisible } from '../src/telegram-markdown.lib.mjs';

console.log('='.repeat(80));
console.log('Unit Tests: Telegram Special Character Handling (Issue #1070)');
console.log('='.repeat(80));
console.log();

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Result: ${JSON.stringify(result)}`);
      failed++;
    }
  } catch (error) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

// ===========================================================================
// Tests for cleanNonPrintableChars()
// ===========================================================================
console.log('\n--- cleanNonPrintableChars() Tests ---\n');

runTest('Remove zero-width space (U+200B)', () => {
  const input = 'Hello\u200BWorld';
  const output = cleanNonPrintableChars(input);
  return output === 'HelloWorld';
});

runTest('Remove zero-width non-joiner (U+200C)', () => {
  const input = 'Test\u200CString';
  const output = cleanNonPrintableChars(input);
  return output === 'TestString';
});

runTest('Remove zero-width joiner (U+200D)', () => {
  const input = 'Join\u200DText';
  const output = cleanNonPrintableChars(input);
  return output === 'JoinText';
});

runTest('Remove byte order mark (U+FEFF)', () => {
  const input = '\uFEFFStart of text';
  const output = cleanNonPrintableChars(input);
  return output === 'Start of text';
});

runTest('Remove soft hyphen (U+00AD)', () => {
  const input = 'dis\u00ADconnect';
  const output = cleanNonPrintableChars(input);
  return output === 'disconnect';
});

runTest('Remove null character (U+0000)', () => {
  const input = 'Text\x00with\x00nulls';
  const output = cleanNonPrintableChars(input);
  return output === 'Textwithnulls';
});

runTest('Remove control characters (U+0001 to U+001F except tab/newline)', () => {
  const input = 'Text\x01with\x02control\x1Fchars';
  const output = cleanNonPrintableChars(input);
  return output === 'Textwithcontrolchars';
});

runTest('Normalize multiple spaces to single space', () => {
  const input = 'Too    many     spaces';
  const output = cleanNonPrintableChars(input);
  return output === 'Too many spaces';
});

runTest('Preserve newlines while trimming whitespace from lines', () => {
  const input = '  Line1  \n  Line2  ';
  const output = cleanNonPrintableChars(input);
  return output === 'Line1\nLine2';
});

runTest('Clean URL with zero-width chars (real-world scenario)', () => {
  const input = 'https://github.com/owner/repo/\u200Bissues/123';
  const output = cleanNonPrintableChars(input);
  return output === 'https://github.com/owner/repo/issues/123';
});

runTest('Normal text unchanged', () => {
  const input = 'Normal text with no special characters';
  const output = cleanNonPrintableChars(input);
  return output === 'Normal text with no special characters';
});

runTest('Handle null input', () => {
  const output = cleanNonPrintableChars(null);
  return output === null;
});

runTest('Handle undefined input', () => {
  const output = cleanNonPrintableChars(undefined);
  return output === undefined;
});

runTest('Handle empty string', () => {
  const output = cleanNonPrintableChars('');
  return output === '';
});

runTest('Handle non-string input (number)', () => {
  const output = cleanNonPrintableChars(123);
  return output === 123;
});

// ===========================================================================
// Tests for makeSpecialCharsVisible()
// ===========================================================================
console.log('\n--- makeSpecialCharsVisible() Tests ---\n');

runTest('Make zero-width space visible as [ZWSP]', () => {
  const input = 'Hello\u200BWorld';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[ZWSP]') && output === 'Hello[ZWSP]World';
});

runTest('Make zero-width non-joiner visible as [ZWNJ]', () => {
  const input = 'Test\u200CString';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[ZWNJ]') && output === 'Test[ZWNJ]String';
});

runTest('Make zero-width joiner visible as [ZWJ]', () => {
  const input = 'Join\u200DText';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[ZWJ]') && output === 'Join[ZWJ]Text';
});

runTest('Make byte order mark visible as [BOM]', () => {
  const input = '\uFEFFStart';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[BOM]') && output === '[BOM]Start';
});

runTest('Make soft hyphen visible as [SHY]', () => {
  const input = 'dis\u00ADconnect';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[SHY]') && output === 'dis[SHY]connect';
});

runTest('Make tab visible as [TAB]', () => {
  const input = 'col1\tcol2';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[TAB]') && output === 'col1[TAB]col2';
});

runTest('Make newline visible as [LF]', () => {
  const input = 'line1\nline2';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[LF]') && output === 'line1[LF]line2';
});

runTest('Make carriage return visible as [CR]', () => {
  const input = 'text\rmore';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[CR]') && output === 'text[CR]more';
});

runTest('Show control characters as [U+XXXX]', () => {
  const input = 'text\x01char';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[U+0001]') && output === 'text[U+0001]char';
});

runTest('Normal text unchanged', () => {
  const input = 'Normal text';
  const output = makeSpecialCharsVisible(input);
  return output === 'Normal text';
});

runTest('Truncate long strings with default maxLength', () => {
  const longText = 'A'.repeat(300);
  const output = makeSpecialCharsVisible(longText);
  // Default maxLength is 200, so output should be truncated
  return output.length <= 220 && output.includes('truncated');
});

runTest('Truncate long strings with custom maxLength', () => {
  const longText = 'A'.repeat(100);
  const output = makeSpecialCharsVisible(longText, { maxLength: 50 });
  return output.length <= 70 && output.includes('truncated');
});

runTest('Handle null input', () => {
  const output = makeSpecialCharsVisible(null);
  return output === null;
});

runTest('Handle undefined input', () => {
  const output = makeSpecialCharsVisible(undefined);
  return output === undefined;
});

runTest('Handle empty string', () => {
  const output = makeSpecialCharsVisible('');
  return output === '';
});

runTest('Handle non-string input (number)', () => {
  const output = makeSpecialCharsVisible(123);
  return output === 123;
});

runTest('URL with multiple special chars (real-world scenario)', () => {
  const input = 'https://github.com/\u200Bowner\u200C/repo\u200D/issues/123';
  const output = makeSpecialCharsVisible(input);
  return output.includes('[ZWSP]') && output.includes('[ZWNJ]') && output.includes('[ZWJ]') && output === 'https://github.com/[ZWSP]owner[ZWNJ]/repo[ZWJ]/issues/123';
});

// ===========================================================================
// Integration test: Both functions together
// ===========================================================================
console.log('\n--- Integration Tests ---\n');

runTest('Clean then make visible (verifies cleaning removes all special chars)', () => {
  const input = 'https://github.com/\u200Bowner/\u200Crepo/\u200Dissues/123';
  const cleaned = cleanNonPrintableChars(input);
  const visible = makeSpecialCharsVisible(cleaned);
  // After cleaning, there should be no special char markers
  return !visible.includes('[') && visible === 'https://github.com/owner/repo/issues/123';
});

runTest('Make visible without cleaning (for debugging)', () => {
  const input = 'https://github.com/\u200Bowner/\u200Crepo/issues/123';
  const visible = makeSpecialCharsVisible(input);
  // Before cleaning, we should see the markers
  return visible.includes('[ZWSP]') && visible.includes('[ZWNJ]');
});

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n' + '='.repeat(80));
console.log('Test Summary');
console.log('='.repeat(80));
console.log(`Total tests:  ${passed + failed}`);
console.log(`Passed:       ${passed} ${passed > 0 ? '✅' : ''}`);
console.log(`Failed:       ${failed} ${failed > 0 ? '❌' : ''}`);
console.log('='.repeat(80));
console.log();

if (failed === 0) {
  console.log('🎉 All tests passed!');
  console.log();
  console.log('📝 Coverage:');
  console.log('   ✅ cleanNonPrintableChars() - Zero-width chars, control chars, normalization');
  console.log('   ✅ makeSpecialCharsVisible() - All special char markers, truncation');
  console.log('   ✅ Edge cases (null, undefined, empty, non-string)');
  console.log('   ✅ Real-world URL scenarios');
  console.log('   ✅ Integration of both functions');
  console.log();
  process.exit(0);
} else {
  console.log(`❌ ${failed} test(s) failed!`);
  console.log();
  process.exit(1);
}
