#!/usr/bin/env node
/**
 * Test script for Sentry integration
 * This script validates that Sentry is properly integrated and can be disabled
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { execSync } from 'child_process';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

// Colors for output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function runTest(description, testFn) {
  testsRun++;
  process.stdout.write(`Testing: ${description}... `);

  try {
    const result = testFn();
    if (result) {
      console.log(`${GREEN}✓ PASSED${RESET}`);
      testsPassed++;
      return true;
    } else {
      console.log(`${RED}✗ FAILED${RESET}`);
      testsFailed++;
      return false;
    }
  } catch (error) {
    console.log(`${RED}✗ ERROR: ${error.message}${RESET}`);
    testsFailed++;
    return false;
  }
}

console.log('🧪 Running Sentry Integration Tests\n');

// Test 1: Check if instrument.mjs exists
runTest('instrument.mjs file exists', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  return fs.existsSync(instrumentPath);
});

// Test 2: Check if sentry.lib.mjs exists
runTest('sentry.lib.mjs file exists', () => {
  const sentryLibPath = join(projectRoot, 'src', 'sentry.lib.mjs');
  return fs.existsSync(sentryLibPath);
});

// Test 3: Check if Sentry packages are installed
runTest('Sentry packages in package.json', () => {
  const packagePath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  return (
    packageJson.dependencies &&
    packageJson.dependencies['@sentry/node'] &&
    packageJson.dependencies['@sentry/profiling-node']
  );
});

// Test 4: Test --no-sentry flag in hive.mjs
runTest('hive.mjs supports --no-sentry flag', () => {
  try {
    // Capture both stdout and stderr since yargs might output to stderr
    const output = execSync(`node ${join(projectRoot, 'src', 'hive.mjs')} --help 2>&1`, {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: 'pipe'
    });
    return output.includes('--no-sentry');
  } catch (error) {
    // Help command might exit with non-zero, but we got output
    if (error.stdout) {
      return error.stdout.includes('--no-sentry');
    }
    return false;
  }
});

// Test 5: Test --no-sentry flag in solve.mjs
runTest('solve.mjs supports --no-sentry flag', () => {
  try {
    // Capture both stdout and stderr since yargs might output to stderr
    const output = execSync(`node ${join(projectRoot, 'src', 'solve.mjs')} --help 2>&1`, {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: 'pipe'
    });
    return output.includes('--no-sentry');
  } catch (error) {
    // Help command might exit with non-zero, but we got output
    if (error.stdout) {
      return error.stdout.includes('--no-sentry');
    }
    return false;
  }
});

// Test 6: Check if instrument.mjs imports are correct
runTest('instrument.mjs has correct imports', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  const content = fs.readFileSync(instrumentPath, 'utf8');

  // Check for lazy/conditional imports (dynamic imports)
  return content.includes('import("@sentry/node")') && content.includes('import("@sentry/profiling-node")');
});

// Test 7: Check if DSN is configured
runTest('Sentry DSN is configured', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  const configPath = join(projectRoot, 'src', 'config.lib.mjs');
  const instrumentContent = fs.readFileSync(instrumentPath, 'utf8');
  const configContent = fs.readFileSync(configPath, 'utf8');

  // DSN should be in config.lib.mjs and referenced in instrument.mjs
  return (
    instrumentContent.includes('dsn:') &&
    configContent.includes(
      'https://77b711f23c84cbf74366df82090dc389@o4510072519983104.ingest.us.sentry.io/4510072523325440'
    )
  );
});

// Test 8: Check environment variable support
runTest('Supports HIVE_MIND_NO_SENTRY environment variable', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  const content = fs.readFileSync(instrumentPath, 'utf8');

  return content.includes('HIVE_MIND_NO_SENTRY');
});

// Test 9: Check CI environment detection
runTest('Disables Sentry in CI environment', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  const content = fs.readFileSync(instrumentPath, 'utf8');

  return content.includes("process.env.CI === 'true'");
});

// Test 10: Test that hive.mjs imports instrument.mjs
runTest('hive.mjs imports instrument.mjs', () => {
  const hivePath = join(projectRoot, 'src', 'hive.mjs');
  const content = fs.readFileSync(hivePath, 'utf8');

  return content.includes("import './instrument.mjs'");
});

// Test 11: Test that solve.mjs imports instrument.mjs
runTest('solve.mjs imports instrument.mjs', () => {
  const solvePath = join(projectRoot, 'src', 'solve.mjs');
  const content = fs.readFileSync(solvePath, 'utf8');

  return content.includes("import './instrument.mjs'");
});

// Test 12: Check privacy settings
runTest('Sentry has privacy protections', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  const content = fs.readFileSync(instrumentPath, 'utf8');

  return content.includes('sendDefaultPii: false') && content.includes('beforeSend');
});

// Test 13: Verify export functions in sentry.lib.mjs
runTest('sentry.lib.mjs exports required functions', () => {
  const sentryLibPath = join(projectRoot, 'src', 'sentry.lib.mjs');
  const content = fs.readFileSync(sentryLibPath, 'utf8');

  const requiredExports = [
    'export const initializeSentry',
    'export const withSentry',
    'export const reportError',
    'export const flushSentry',
    'export const closeSentry'
  ];

  return requiredExports.every(exp => content.includes(exp));
});

// Test 14: Check error filtering
runTest('Sentry filters common network errors', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  const content = fs.readFileSync(instrumentPath, 'utf8');

  return content.includes('ignoreErrors') && content.includes('ECONNRESET') && content.includes('ETIMEDOUT');
});

// Test 15: Test version configuration
runTest('Version is properly configured', () => {
  const instrumentPath = join(projectRoot, 'src', 'instrument.mjs');
  const content = fs.readFileSync(instrumentPath, 'utf8');

  return content.includes('release:') && content.includes('hive-mind@');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`${GREEN}✓ Passed: ${testsPassed}${RESET}`);
if (testsFailed > 0) {
  console.log(`${RED}✗ Failed: ${testsFailed}${RESET}`);
}
console.log(`Total Tests: ${testsRun}`);
console.log('='.repeat(50));

if (testsFailed === 0) {
  console.log(`\n${GREEN}🎉 All tests passed!${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${RED}❌ Some tests failed. Please review the failures above.${RESET}\n`);
  process.exit(1);
}
