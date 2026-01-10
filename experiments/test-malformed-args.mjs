#!/usr/bin/env node

/**
 * Experiment: Test malformed argument detection
 * Issue #1092: `-- model` does not produce error
 *
 * This script tests how different malformed arguments are parsed
 * and validates the actual detection function from option-suggestions.lib.mjs
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the actual detection function
const { detectMalformedFlags } = await import('../src/option-suggestions.lib.mjs');

// Test scenarios to validate malformed argument patterns
const testCases = [
  // Normal cases (should be accepted)
  { args: ['--model', 'opus'], shouldError: false, description: 'Valid: --model opus' },
  { args: ['-m', 'opus'], shouldError: false, description: 'Valid: -m opus' },
  { args: ['--verbose'], shouldError: false, description: 'Valid: --verbose' },
  { args: ['https://github.com/test/test/issues/1', '--model', 'opus'], shouldError: false, description: 'Valid: URL + --model opus' },

  // Malformed cases - single argument containing space after --
  { args: ['-- model', 'opus'], shouldError: true, description: 'Malformed: "-- model" as single arg (space after --)' },
  { args: ['-- verbose'], shouldError: true, description: 'Malformed: "-- verbose" as single arg (space after --)' },

  // Malformed cases - split by tokenizer (Issue #1092 exact scenario)
  { args: ['https://github.com/test/test/issues/1', '--', 'model', 'opus'], shouldError: true, description: 'Issue #1092: "--" followed by "model" (split by tokenizer)' },
  { args: ['https://github.com/test/test/issues/1', '--', 'verbose'], shouldError: true, description: 'Issue #1092: "--" followed by "verbose" (split by tokenizer)' },
  { args: ['https://github.com/test/test/issues/1', '--', 'tool', 'claude'], shouldError: true, description: 'Issue #1092: "--" followed by "tool" (split by tokenizer)' },

  // Other malformed patterns
  { args: ['- -model', 'opus'], shouldError: true, description: 'Malformed: "- -model" (space between dashes)' },
  { args: ['-model', 'opus'], shouldError: true, description: 'Malformed: "-model" (single dash for long option)' },
  { args: ['---model', 'opus'], shouldError: true, description: 'Malformed: "---model" (triple dash)' },

  // Edge cases that should NOT trigger error
  { args: ['https://github.com/test/test/issues/1', '--', 'someRandomText'], shouldError: false, description: 'Valid: "--" followed by non-option word' },
  { args: ['https://github.com/test/test/issues/1', '--'], shouldError: false, description: 'Valid: standalone "--" at end' },
];

// Run tests
console.log('='.repeat(70));
console.log('Experiment: Malformed Argument Detection');
console.log('Issue #1092: `-- model` does not produce error');
console.log('='.repeat(70));
console.log('');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  process.stdout.write(`Testing: ${testCase.description}... `);

  const result = detectMalformedFlags(testCase.args);
  const hasMalformed = result.malformed.length > 0;

  if (hasMalformed === testCase.shouldError) {
    console.log('PASSED');
    passed++;
  } else {
    console.log('FAILED');
    console.log(`  Expected shouldError=${testCase.shouldError}, got malformed=${hasMalformed}`);
    console.log(`  Args: ${JSON.stringify(testCase.args)}`);
    console.log(`  Detected: ${JSON.stringify(result)}`);
    failed++;
  }
}

console.log('');
console.log('='.repeat(70));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(70));

// Show sample error messages
console.log('');
console.log('Sample error messages:');
const sampleCases = [['https://github.com/test/test/issues/1', '--', 'model', 'opus'], ['-- verbose'], ['-model', 'opus']];
for (const args of sampleCases) {
  const result = detectMalformedFlags(args);
  if (result.errors.length > 0) {
    console.log(`\n  Input: ${JSON.stringify(args)}`);
    console.log(`  Error: ${result.errors[0]}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
