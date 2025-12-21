#!/usr/bin/env node

/**
 * Test script to verify links-notation package works correctly
 * This tests the migration from @linksplatform/protocols-lino to links-notation
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

console.log('Testing links-notation package...\n');

// Test 1: Import the package
console.log('Test 1: Importing links-notation package');
try {
  const linoModule = await use('links-notation');
  const LinoParser = linoModule.Parser || linoModule.default?.Parser;

  if (!LinoParser) {
    console.error('❌ Failed: Parser not found in module');
    process.exit(1);
  }
  console.log('✅ Passed: Successfully imported Parser\n');

  // Test 2: Parse simple links notation
  console.log('Test 2: Parsing simple links notation');
  const parser = new LinoParser();
  const testInput = '(value1 value2 value3)';
  const result = parser.parse(testInput);

  if (!result || result.length === 0) {
    console.error('❌ Failed: Parse result is empty');
    process.exit(1);
  }
  console.log('✅ Passed: Successfully parsed simple notation');
  console.log('   Input:', testInput);
  console.log('   Output:', JSON.stringify(result, null, 2));
  console.log();

  // Test 3: Parse multiline notation
  console.log('Test 3: Parsing multiline links notation');
  const multilineInput = `(
  value1
  value2
  value3
)`;
  const multilineResult = parser.parse(multilineInput);

  if (!multilineResult || multilineResult.length === 0) {
    console.error('❌ Failed: Multiline parse result is empty');
    process.exit(1);
  }
  console.log('✅ Passed: Successfully parsed multiline notation');
  console.log('   Output:', JSON.stringify(multilineResult, null, 2));
  console.log();

  // Test 4: Test with LinksNotationManager-like usage
  console.log('Test 4: Testing Parser with LinksNotationManager-like usage');
  const testData = '(123 456 789)';
  const parsed = parser.parse(testData);

  if (parsed && parsed.length > 0) {
    const link = parsed[0];
    const values = [];

    if (link.values && link.values.length > 0) {
      for (const value of link.values) {
        const val = value.id || value;
        values.push(val);
      }
    } else if (link.id) {
      values.push(link.id);
    }

    console.log('✅ Passed: Successfully extracted values using LinksNotationManager pattern');
    console.log('   Input:', testData);
    console.log('   Extracted values:', values);
  } else {
    console.error('❌ Failed: Could not extract values');
    process.exit(1);
  }

  console.log('\n🎉 All tests passed! The links-notation package is working correctly.');
  console.log('The migration from @linksplatform/protocols-lino to links-notation is successful.');

} catch (error) {
  console.error('❌ Test failed with error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
