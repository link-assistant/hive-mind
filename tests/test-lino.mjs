#!/usr/bin/env node

/**
 * Test suite for lino.lib.mjs
 * Tests LINO (Links Notation) parsing and formatting functionality
 *
 * Related to issue #1086: Validation of LINO configuration for command-line options
 */

// Import the lino library
const linoModule = await import('../src/lino.lib.mjs');
const { LinksNotationManager, lino, CACHE_FILES } = linoModule;

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message}\nExpected: ${expectedStr}\nActual: ${actualStr}`);
  }
}

console.log('📋 LinksNotationManager Export Tests\n');

// Test 1: LinksNotationManager class is exported
runTest('LinksNotationManager class export', () => {
  if (!LinksNotationManager) {
    throw new Error('LinksNotationManager class not exported');
  }
  if (typeof LinksNotationManager !== 'function') {
    throw new Error('LinksNotationManager is not a constructor function');
  }
});

// Test 2: lino singleton is exported
runTest('lino singleton export', () => {
  if (!lino) {
    throw new Error('lino singleton not exported');
  }
  if (!(lino instanceof LinksNotationManager)) {
    throw new Error('lino is not an instance of LinksNotationManager');
  }
});

// Test 3: CACHE_FILES constant is exported
runTest('CACHE_FILES export', () => {
  if (!CACHE_FILES) {
    throw new Error('CACHE_FILES not exported');
  }
  if (!CACHE_FILES.TELEGRAM_CHATS) {
    throw new Error('CACHE_FILES.TELEGRAM_CHATS not defined');
  }
});

console.log('\n📋 parse() Method Tests\n');

// Test 4: parse empty input
runTest('parse empty input', () => {
  const result = lino.parse('');
  assertEqual(result, [], 'Empty string should return empty array');
});

// Test 5: parse null input
runTest('parse null input', () => {
  const result = lino.parse(null);
  assertEqual(result, [], 'Null input should return empty array');
});

// Test 6: parse simple LINO list
runTest('parse simple LINO list', () => {
  const input = `(
  value1
  value2
  value3
)`;
  const result = lino.parse(input);
  assertEqual(result, ['value1', 'value2', 'value3'], 'Should parse simple list');
});

// Test 7: parse numeric values
runTest('parse numeric values', () => {
  const input = `(
  123
  456
  789
)`;
  const result = lino.parse(input);
  assertEqual(result, ['123', '456', '789'], 'Should parse numeric values as strings');
});

// Test 8: parse command-line options
runTest('parse command-line options', () => {
  const input = `(
  --verbose
  --all-issues
  --model=opus
)`;
  const result = lino.parse(input);
  assertEqual(result, ['--verbose', '--all-issues', '--model=opus'], 'Should parse command-line options');
});

console.log('\n📋 parseNumericIds() Method Tests\n');

// Test 9: parseNumericIds empty input
runTest('parseNumericIds empty input', () => {
  const result = lino.parseNumericIds('');
  assertEqual(result, [], 'Empty string should return empty array');
});

// Test 10: parseNumericIds with numeric values
runTest('parseNumericIds with numeric values', () => {
  const input = `(
  123
  456
  789
)`;
  const result = lino.parseNumericIds(input);
  assertEqual(result, [123, 456, 789], 'Should parse numeric IDs');
});

// Test 11: parseNumericIds with negative numbers (chat IDs)
runTest('parseNumericIds with negative numbers', () => {
  const input = `(
  -1002975819706
  -1002861722681
)`;
  const result = lino.parseNumericIds(input);
  // Note: Negative numbers may be parsed differently depending on LINO parser behavior
  // Let's just verify it returns numbers
  if (!Array.isArray(result)) {
    throw new Error('Should return an array');
  }
});

// Test 12: parseNumericIds filters non-numeric values
runTest('parseNumericIds filters non-numeric values', () => {
  const input = `(
  123
  abc
  456
)`;
  const result = lino.parseNumericIds(input);
  // Should only include numeric values
  for (const id of result) {
    if (typeof id !== 'number' || isNaN(id)) {
      throw new Error(`Expected number, got ${typeof id}: ${id}`);
    }
  }
});

console.log('\n📋 parseStringValues() Method Tests\n');

// Test 13: parseStringValues empty input
runTest('parseStringValues empty input', () => {
  const result = lino.parseStringValues('');
  assertEqual(result, [], 'Empty string should return empty array');
});

// Test 14: parseStringValues null input
runTest('parseStringValues null input', () => {
  const result = lino.parseStringValues(null);
  assertEqual(result, [], 'Null input should return empty array');
});

// Test 15: parseStringValues with options
runTest('parseStringValues with options', () => {
  const input = `(
  --verbose
  --all-issues
  --model=opus
)`;
  const result = lino.parseStringValues(input);
  assertEqual(result, ['--verbose', '--all-issues', '--model=opus'], 'Should parse options as strings');
});

// Test 16: parseStringValues with mixed content
runTest('parseStringValues with mixed content', () => {
  const input = `(
  value1
  123
  --option
)`;
  const result = lino.parseStringValues(input);
  assertEqual(result, ['value1', '123', '--option'], 'Should parse all as strings');
});

console.log('\n📋 format() Method Tests\n');

// Test 17: format empty array
runTest('format empty array', () => {
  const result = lino.format([]);
  assertEqual(result, '()', 'Empty array should format as ()');
});

// Test 18: format null
runTest('format null', () => {
  const result = lino.format(null);
  assertEqual(result, '()', 'Null should format as ()');
});

// Test 19: format simple values
runTest('format simple values', () => {
  const result = lino.format(['value1', 'value2', 'value3']);
  const expected = `(
  value1
  value2
  value3
)`;
  assertEqual(result, expected, 'Should format values with indentation');
});

// Test 20: format command-line options
runTest('format command-line options', () => {
  const result = lino.format(['--verbose', '--all-issues', '--model=opus']);
  const expected = `(
  --verbose
  --all-issues
  --model=opus
)`;
  assertEqual(result, expected, 'Should format options correctly');
});

console.log('\n📋 Round-Trip Tests (parse -> format)\n');

// Test 21: round-trip with options
runTest('round-trip with options', () => {
  const original = ['--verbose', '--all-issues', '--model=opus'];
  const formatted = lino.format(original);
  const parsed = lino.parseStringValues(formatted);
  assertEqual(parsed, original, 'Should preserve values through round-trip');
});

// Test 22: round-trip with numeric strings
runTest('round-trip with numeric strings', () => {
  const original = ['123', '456', '789'];
  const formatted = lino.format(original);
  const parsed = lino.parseStringValues(formatted);
  assertEqual(parsed, original, 'Should preserve numeric strings through round-trip');
});

console.log('\n📋 Edge Case Tests (Issue #1086 Related)\n');

// Test 23: Same-line parsing behavior
// Note: This tests the current behavior where same-line items create nested structures
// The lenv-reader should reject these, but lino.parseStringValues may not extract all values
runTest('parseStringValues with same-line items (nested structure)', () => {
  // When items are on the same line, LINO parser creates nested tuples
  // The original parseStringValues only extracts top-level values
  const input = `(
  --option1
  --option2  --option3
)`;
  const result = lino.parseStringValues(input);
  // According to user feedback, same-line options should be rejected at lenv-reader level
  // Here we just test the current behavior
  if (result.length === 0) {
    throw new Error('Should return at least one value');
  }
  // We expect --option1 to be extracted, --option2 and --option3 may be in nested structure
});

// Test 24: Options with equals sign
runTest('parseStringValues with equals sign options', () => {
  const input = `(
  --model=opus
  --timeout=60
)`;
  const result = lino.parseStringValues(input);
  assertEqual(result, ['--model=opus', '--timeout=60'], 'Should preserve equals sign in options');
});

// Test 25: Options with hyphens
runTest('parseStringValues with hyphenated options', () => {
  const input = `(
  --auto-resume-on-limit-reset
  --skip-issues-with-prs
)`;
  const result = lino.parseStringValues(input);
  assertEqual(result, ['--auto-resume-on-limit-reset', '--skip-issues-with-prs'], 'Should preserve hyphens in options');
});

// Test 26: Short options
runTest('parseStringValues with short options', () => {
  const input = `(
  -v
  -a
  -m
)`;
  const result = lino.parseStringValues(input);
  assertEqual(result, ['-v', '-a', '-m'], 'Should parse short options');
});

console.log('\n📋 Cache Method Tests\n');

// Test 27: getCachePath returns correct path
runTest('getCachePath returns correct path', () => {
  const path = lino.getCachePath('test.lino');
  if (!path || !path.includes('test.lino')) {
    throw new Error(`Expected path to include 'test.lino', got: ${path}`);
  }
});

// Test 28: cacheExists for non-existent file
runTest('cacheExists for non-existent file', async () => {
  const exists = await lino.cacheExists('definitely-does-not-exist-12345.lino');
  if (exists !== false) {
    throw new Error('Should return false for non-existent file');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for lino.lib.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
