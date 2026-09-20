#!/usr/bin/env node

/**
 * Experiment: Test LINO parsing for issue #1086
 *
 * This experiment reproduces the issue where some hive override options
 * are not being displayed correctly when parsed from the TELEGRAM_HIVE_OVERRIDES
 * configuration.
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

const parser = new LinoParser();

// Test the configuration from the issue
const issueConfig = `TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats`;

console.log('=== Issue #1086 Reproduction Test ===\n');

console.log('Input configuration:');
console.log(issueConfig);
console.log('\n---\n');

// Parse just the overrides part (as it would be parsed after extracting from lenv)
const overridesInput = `  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats`;

console.log('Parsing overrides as a list...');
const parsed1 = parser.parse(`(\n${overridesInput}\n)`);
console.log('Parsed result:', JSON.stringify(parsed1, null, 2));

console.log('\n---\n');

// Parse with wrapping parentheses
const wrappedInput = `(
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
)`;

console.log('Parsing with explicit parentheses...');
const parsed2 = parser.parse(wrappedInput);
console.log('Parsed result:', JSON.stringify(parsed2, null, 2));

console.log('\n---\n');

// Test the parseStringValues function from lino.lib.mjs
function parseStringValues(input) {
  if (!input) return [];

  const parsed = parser.parse(input);

  if (parsed && parsed.length > 0) {
    const link = parsed[0];
    const links = [];

    if (link.values && link.values.length > 0) {
      for (const value of link.values) {
        const linkStr = value.id || value;
        if (typeof linkStr === 'string') {
          links.push(linkStr);
        }
      }
    } else if (link.id) {
      if (typeof link.id === 'string') {
        links.push(link.id);
      }
    }

    return links;
  }

  return [];
}

console.log('Testing parseStringValues with different inputs...\n');

// Test 1: Standard indented format (how it would come from lenv)
const test1 = `
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
`;
console.log('Test 1 - Indented without parentheses:');
console.log('Input:', JSON.stringify(test1));
console.log('Result:', parseStringValues(test1));

console.log('\n');

// Test 2: With parentheses
const test2 = `(
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
)`;
console.log('Test 2 - With parentheses:');
console.log('Input:', JSON.stringify(test2));
console.log('Result:', parseStringValues(test2));

console.log('\n');

// Test 3: Simple newline-separated
const test3 = `--all-issues
--once
--skip-issues-with-prs
--attach-logs
--verbose
--no-tool-check
--auto-resume-on-limit-reset
--tokens-budget-stats`;
console.log('Test 3 - Simple newline-separated:');
console.log('Input:', JSON.stringify(test3));
console.log('Result:', parseStringValues(test3));

console.log('\n---\n');

// Test 4: Check if the issue might be with special characters
const test4 = `(
  --auto-resume-on-limit-reset
  --tokens-budget-stats
)`;
console.log('Test 4 - Just the missing options:');
console.log('Input:', JSON.stringify(test4));
console.log('Result:', parseStringValues(test4));

console.log('\n');

// Test 5: All options including the ones mentioned in the issue
const test5 = `(
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-resume-on-limit-reset
  --tokens-budget-stats
)`;
console.log('Test 5 - All 8 options:');
console.log('Result:', parseStringValues(test5));
console.log('Count:', parseStringValues(test5).length);

console.log('\n=== Additional Edge Case Tests ===\n');

// Test with question mark (as seen in the issue log)
const test6 = `(
  --auto-resume-on-limit-reset?
  --tokens-budget-stats
)`;
console.log('Test 6 - With question mark (like in issue log):');
console.log('Input:', JSON.stringify(test6));
console.log('Result:', parseStringValues(test6));

// Test with multiple spaces (as seen in the issue log)
const test7 = `(
  --auto-resume-on-limit-reset?  --tokens-budget-stats
)`;
console.log('\nTest 7 - Options on same line with extra spaces:');
console.log('Input:', JSON.stringify(test7));
console.log('Result:', parseStringValues(test7));

console.log('\n=== Conclusion ===\n');
console.log('Check if the count matches expected (8 options in full config)');
