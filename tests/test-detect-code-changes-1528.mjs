#!/usr/bin/env node

/**
 * Test suite for detect-code-changes.mjs
 * Issue #1528: CI/CD triggers on .gitkeep file
 *
 * Tests the isExcludedFromCodeChanges() function to ensure .gitkeep and other
 * non-code files are properly excluded from code change detection.
 */

import { isExcludedFromCodeChanges, matchesPattern } from '../scripts/detect-code-changes.mjs';

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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log('🧪 Detect Code Changes Tests (Issue #1528)\n');

// === isExcludedFromCodeChanges tests ===

console.log('--- isExcludedFromCodeChanges ---\n');

// .gitkeep exclusion tests
runTest('.gitkeep at root is excluded', () => {
  assertEqual(isExcludedFromCodeChanges('.gitkeep'), true);
});

runTest('.gitkeep in subdirectory is excluded', () => {
  assertEqual(isExcludedFromCodeChanges('some/path/.gitkeep'), true);
});

runTest('.gitkeep in nested subdirectory is excluded', () => {
  assertEqual(isExcludedFromCodeChanges('a/b/c/.gitkeep'), true);
});

// Markdown exclusion tests
runTest('README.md is excluded', () => {
  assertEqual(isExcludedFromCodeChanges('README.md'), true);
});

runTest('docs/analysis.md is excluded', () => {
  assertEqual(isExcludedFromCodeChanges('docs/analysis.md'), true);
});

runTest('CHANGELOG.md is excluded', () => {
  assertEqual(isExcludedFromCodeChanges('CHANGELOG.md'), true);
});

// Folder exclusion tests
runTest('.changeset/ files are excluded', () => {
  assertEqual(isExcludedFromCodeChanges('.changeset/some-changeset.md'), true);
});

runTest('data/ files are excluded', () => {
  assertEqual(isExcludedFromCodeChanges('data/some-file.json'), true);
});

runTest('docs/ files are excluded', () => {
  assertEqual(isExcludedFromCodeChanges('docs/case-studies/issue-1528/README.md'), true);
});

runTest('experiments/ files are excluded', () => {
  assertEqual(isExcludedFromCodeChanges('experiments/test.mjs'), true);
});

// Non-excluded files (should return false)
runTest('src/*.mjs files are NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('src/solve.mjs'), false);
});

runTest('tests/*.mjs files are NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('tests/test-detect-code-changes-1528.mjs'), false);
});

runTest('package.json is NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('package.json'), false);
});

runTest('.github/workflows/release.yml is NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('.github/workflows/release.yml'), false);
});

runTest('Dockerfile is NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('Dockerfile'), false);
});

runTest('eslint.config.mjs is NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('eslint.config.mjs'), false);
});

runTest('scripts/detect-code-changes.mjs is NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('scripts/detect-code-changes.mjs'), false);
});

runTest('helm/Chart.yaml is NOT excluded', () => {
  assertEqual(isExcludedFromCodeChanges('helm/Chart.yaml'), false);
});

// === matchesPattern tests ===

console.log('\n--- matchesPattern ---\n');

const codePattern = /\.(mjs|json|yml|yaml)$|\.github\/workflows\//;

runTest('.mjs files match code pattern', () => {
  assertEqual(matchesPattern('src/solve.mjs', codePattern), true);
});

runTest('.json files match code pattern', () => {
  assertEqual(matchesPattern('package.json', codePattern), true);
});

runTest('.yml files match code pattern', () => {
  assertEqual(matchesPattern('.github/workflows/release.yml', codePattern), true);
});

runTest('.yaml files match code pattern', () => {
  assertEqual(matchesPattern('helm/Chart.yaml', codePattern), true);
});

runTest('workflow files match code pattern', () => {
  assertEqual(matchesPattern('.github/workflows/cleanup-test-repos.yml', codePattern), true);
});

runTest('.gitkeep does NOT match code pattern', () => {
  assertEqual(matchesPattern('.gitkeep', codePattern), false);
});

runTest('Dockerfile does NOT match code pattern', () => {
  assertEqual(matchesPattern('Dockerfile', codePattern), false);
});

runTest('.sh files do NOT match code pattern', () => {
  assertEqual(matchesPattern('scripts/check-mjs-syntax.sh', codePattern), false);
});

// === Integration: .gitkeep-only scenario ===

console.log('\n--- Integration: .gitkeep-only scenario ---\n');

runTest('.gitkeep-only change produces no code files', () => {
  const changedFiles = ['.gitkeep'];
  const codeChangedFiles = changedFiles.filter(file => !isExcludedFromCodeChanges(file));
  assertEqual(codeChangedFiles.length, 0, `Expected 0 code files, got ${codeChangedFiles.length}: ${codeChangedFiles.join(', ')}`);

  const codeChanged = codeChangedFiles.some(file => codePattern.test(file));
  assertEqual(codeChanged, false, 'code should be false for .gitkeep-only changes');
});

runTest('mixed .gitkeep + code change produces correct code files', () => {
  const changedFiles = ['.gitkeep', 'src/solve.mjs', 'README.md'];
  const codeChangedFiles = changedFiles.filter(file => !isExcludedFromCodeChanges(file));
  assertEqual(codeChangedFiles.length, 1, `Expected 1 code file, got ${codeChangedFiles.length}: ${codeChangedFiles.join(', ')}`);
  assertEqual(codeChangedFiles[0], 'src/solve.mjs');

  const codeChanged = codeChangedFiles.some(file => codePattern.test(file));
  assertEqual(codeChanged, true, 'code should be true when .mjs files changed');
});

runTest('docs-only change produces no code files', () => {
  const changedFiles = ['docs/README.md', 'docs/case-studies/issue-1528/README.md'];
  const codeChangedFiles = changedFiles.filter(file => !isExcludedFromCodeChanges(file));
  assertEqual(codeChangedFiles.length, 0, `Expected 0 code files, got ${codeChangedFiles.length}`);
});

// === Summary ===

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} tests`);

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
