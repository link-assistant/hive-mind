#!/usr/bin/env node
// Test that all solve options accepted in TELEGRAM_SOLVE_OVERRIDES are also
// accepted in TELEGRAM_HIVE_OVERRIDES (via hive config).
// This ensures issue #1209 doesn't regress: solve-passthrough options must
// be defined in hive.config.lib.mjs.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('Testing hive-solve option parity...\n');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

// Extract option names from a config file by matching .option('name', {
function extractOptionNames(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const optionRegex = /\.option\(\s*'([^']+)'/g;
  const options = new Set();
  let match;
  while ((match = optionRegex.exec(content)) !== null) {
    options.add(match[1]);
  }
  return options;
}

const solveConfigPath = join(projectRoot, 'src/solve.config.lib.mjs');
const hiveConfigPath = join(projectRoot, 'src/hive.config.lib.mjs');

const solveOptions = extractOptionNames(solveConfigPath);
const hiveOptions = extractOptionNames(hiveConfigPath);

// Options that are intentionally solve-only and should NOT be in hive config
// (they don't make sense as passthrough because they are session-specific)
const solveOnlyExceptions = new Set([
  'resume', // session-specific, not applicable to hive workflow
  'working-directory', // session-specific, hive manages its own directories
  'only-prepare-command', // debug option, solve-specific
  'session-type', // internal hidden option for session tracking
]);

// Test 1: All solve options (except exceptions) should be in hive config
runTest('all solve options are in hive config (or in exception list)', () => {
  const missing = [];
  for (const opt of solveOptions) {
    if (!hiveOptions.has(opt) && !solveOnlyExceptions.has(opt)) {
      missing.push(opt);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Solve options missing from hive config: ${missing.join(', ')}\nEither add them to hive.config.lib.mjs or to solveOnlyExceptions in this test.`);
  }
});

// Test 2: Verify solve options count is reasonable (guard against regex failure)
runTest('solve config has reasonable number of options', () => {
  if (solveOptions.size < 30) {
    throw new Error(`Expected at least 30 solve options, got ${solveOptions.size}. Regex may be broken.`);
  }
});

// Test 3: Verify hive options count is reasonable
runTest('hive config has reasonable number of options', () => {
  if (hiveOptions.size < 30) {
    throw new Error(`Expected at least 30 hive options, got ${hiveOptions.size}. Regex may be broken.`);
  }
});

// Test 4: Specific options from issue #1209 should be in hive config
runTest('--gitkeep-file is in hive config', () => {
  if (!hiveOptions.has('gitkeep-file')) {
    throw new Error('gitkeep-file not found in hive config');
  }
});

runTest('--claude-file is in hive config', () => {
  if (!hiveOptions.has('claude-file')) {
    throw new Error('claude-file not found in hive config');
  }
});

runTest('--auto-gitkeep-file is in hive config', () => {
  if (!hiveOptions.has('auto-gitkeep-file')) {
    throw new Error('auto-gitkeep-file not found in hive config');
  }
});

runTest('--tokens-budget-stats is in hive config', () => {
  if (!hiveOptions.has('tokens-budget-stats')) {
    throw new Error('tokens-budget-stats not found in hive config');
  }
});

runTest('--base-branch is in hive config', () => {
  if (!hiveOptions.has('base-branch')) {
    throw new Error('base-branch not found in hive config');
  }
});

// Summary
console.log(`\n=== Test Summary ===`);
console.log(`Total: ${testsPassed + testsFailed} | ✅ Passed: ${testsPassed} | ❌ Failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
}
