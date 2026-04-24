#!/usr/bin/env node

/**
 * Test suite for detect-code-changes.mjs
 * Issue #1528: CI/CD triggers on .gitkeep file
 *
 * Tests the positive-matching approach: only files matching codePattern
 * (after exclusion filtering) are considered code changes. Unknown file
 * types like .gitkeep are naturally excluded without explicit rules.
 */

import { isExcludedFromCodeChanges, matchesPattern } from '../scripts/detect-code-changes.mjs';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

let testsPassed = 0;
let testsFailed = 0;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const detectCodeChangesScript = join(repoRoot, 'scripts/detect-code-changes.mjs');

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

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(text, expected, message) {
  if (!text.includes(expected)) {
    throw new Error(message || `Expected output to include ${JSON.stringify(expected)}`);
  }
}

function assertNotIncludes(text, expected, message) {
  if (text.includes(expected)) {
    throw new Error(message || `Expected output not to include ${JSON.stringify(expected)}`);
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeRepoFile(repoDir, filePath, content) {
  const fullPath = join(repoDir, filePath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function runDetectCodeChanges(repoDir, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  delete env.GITHUB_OUTPUT;
  return execFileSync(process.execPath, [detectCodeChangesScript], {
    cwd: repoDir,
    env,
    encoding: 'utf8',
  });
}

// The code pattern used in detect-code-changes.mjs for positive matching
const codePattern = /\.(mjs|js|json|yml|yaml)$|\.github\/workflows\//;

/**
 * Helper: simulate the full two-step code detection pipeline.
 * 1. Filter out excluded files (isExcludedFromCodeChanges)
 * 2. Positively match remaining files against codePattern
 * Returns the list of files considered as code changes.
 */
function getCodeChangedFiles(changedFiles) {
  return changedFiles.filter(file => !isExcludedFromCodeChanges(file)).filter(file => codePattern.test(file));
}

console.log('🧪 Detect Code Changes Tests (Issue #1528)\n');

// === isExcludedFromCodeChanges tests ===

console.log('--- isExcludedFromCodeChanges ---\n');

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

// Files NOT excluded by isExcludedFromCodeChanges (but may or may not match codePattern)
runTest('.gitkeep is NOT excluded by isExcludedFromCodeChanges (handled by positive matching)', () => {
  assertEqual(isExcludedFromCodeChanges('.gitkeep'), false);
});

runTest('.gitkeep in subdirectory is NOT excluded by isExcludedFromCodeChanges', () => {
  assertEqual(isExcludedFromCodeChanges('some/path/.gitkeep'), false);
});

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

// === matchesPattern (codePattern) tests ===

console.log('\n--- matchesPattern (codePattern positive matching) ---\n');

runTest('.mjs files match code pattern', () => {
  assertEqual(matchesPattern('src/solve.mjs', codePattern), true);
});

runTest('.js files match code pattern', () => {
  assertEqual(matchesPattern('src/app.js', codePattern), true);
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

// Files that do NOT match codePattern (naturally excluded by positive matching)
runTest('.gitkeep does NOT match code pattern', () => {
  assertEqual(matchesPattern('.gitkeep', codePattern), false);
});

runTest('.gitkeep in subdirectory does NOT match code pattern', () => {
  assertEqual(matchesPattern('some/path/.gitkeep', codePattern), false);
});

runTest('Dockerfile does NOT match code pattern', () => {
  assertEqual(matchesPattern('Dockerfile', codePattern), false);
});

runTest('.sh files do NOT match code pattern', () => {
  assertEqual(matchesPattern('scripts/check-mjs-syntax.sh', codePattern), false);
});

runTest('.txt files do NOT match code pattern', () => {
  assertEqual(matchesPattern('notes.txt', codePattern), false);
});

runTest('.gitignore does NOT match code pattern', () => {
  assertEqual(matchesPattern('.gitignore', codePattern), false);
});

// === Integration: full pipeline (exclusion + positive matching) ===

console.log('\n--- Integration: full pipeline (exclusion + positive matching) ---\n');

runTest('.gitkeep-only change produces no code files (issue #1528)', () => {
  const codeFiles = getCodeChangedFiles(['.gitkeep']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}: ${codeFiles.join(', ')}`);
});

runTest('.gitkeep in subdirectory produces no code files', () => {
  const codeFiles = getCodeChangedFiles(['some/dir/.gitkeep']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}: ${codeFiles.join(', ')}`);
});

runTest('mixed .gitkeep + code change correctly detects code files', () => {
  const codeFiles = getCodeChangedFiles(['.gitkeep', 'src/solve.mjs', 'README.md']);
  assertEqual(codeFiles.length, 1, `Expected 1 code file, got ${codeFiles.length}: ${codeFiles.join(', ')}`);
  assertEqual(codeFiles[0], 'src/solve.mjs');
});

runTest('docs-only change produces no code files', () => {
  const codeFiles = getCodeChangedFiles(['docs/README.md', 'docs/case-studies/issue-1528/README.md']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}`);
});

runTest('markdown-only change produces no code files', () => {
  const codeFiles = getCodeChangedFiles(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}`);
});

runTest('changeset-only change produces no code files', () => {
  const codeFiles = getCodeChangedFiles(['.changeset/fix-something.md']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}`);
});

runTest('unknown file types (no extension, .txt, .log) produce no code files', () => {
  const codeFiles = getCodeChangedFiles(['LICENSE', 'notes.txt', 'debug.log', '.env']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}: ${codeFiles.join(', ')}`);
});

runTest('workflow file change is detected as code', () => {
  const codeFiles = getCodeChangedFiles(['.github/workflows/release.yml']);
  assertEqual(codeFiles.length, 1);
  assertEqual(codeFiles[0], '.github/workflows/release.yml');
});

runTest('package.json change is detected as code', () => {
  const codeFiles = getCodeChangedFiles(['package.json']);
  assertEqual(codeFiles.length, 1);
  assertEqual(codeFiles[0], 'package.json');
});

runTest('data/ .json files are excluded despite matching code pattern extension', () => {
  const codeFiles = getCodeChangedFiles(['data/records.json']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}: ${codeFiles.join(', ')}`);
});

runTest('experiments/ .mjs files are excluded despite matching code pattern extension', () => {
  const codeFiles = getCodeChangedFiles(['experiments/test.mjs']);
  assertEqual(codeFiles.length, 0, `Expected 0 code files, got ${codeFiles.length}: ${codeFiles.join(', ')}`);
});

runTest('realistic mixed change set is correctly classified', () => {
  const changedFiles = ['.gitkeep', 'src/solve.mjs', 'package.json', 'README.md', 'docs/guide.md', '.changeset/fix.md', 'data/records.json', 'experiments/spike.mjs', '.github/workflows/release.yml'];
  const codeFiles = getCodeChangedFiles(changedFiles);
  assertEqual(codeFiles.length, 3, `Expected 3 code files, got ${codeFiles.length}: ${codeFiles.join(', ')}`);
  assertEqual(codeFiles.includes('src/solve.mjs'), true, 'should include src/solve.mjs');
  assertEqual(codeFiles.includes('package.json'), true, 'should include package.json');
  assertEqual(codeFiles.includes('.github/workflows/release.yml'), true, 'should include workflow file');
});

runTest('pull_request synchronize synthetic merge uses only the latest PR head commit (issue #1665)', () => {
  const repoDir = mkdtempSync(join(tmpdir(), 'detect-code-changes-1665-'));

  try {
    git(repoDir, ['init', '--initial-branch=main']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test User']);

    writeRepoFile(repoDir, 'README.md', '# fixture\n');
    git(repoDir, ['add', '.']);
    git(repoDir, ['commit', '-m', 'base']);

    git(repoDir, ['checkout', '-b', 'feature']);
    writeRepoFile(repoDir, 'src/feature.mjs', 'export const feature = true;\n');
    git(repoDir, ['add', '.']);
    git(repoDir, ['commit', '-m', 'code change']);

    writeRepoFile(repoDir, '.gitkeep', '');
    git(repoDir, ['add', '.gitkeep']);
    git(repoDir, ['commit', '-m', 'metadata-only change']);

    git(repoDir, ['checkout', 'main']);
    git(repoDir, ['merge', '--no-ff', '--no-edit', 'feature']);

    const output = runDetectCodeChanges(repoDir, {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_ACTION: 'synchronize',
    });

    assertIncludes(output, '  .gitkeep');
    assertNotIncludes(output, '  src/feature.mjs', 'The latest PR-head commit did not change src/feature.mjs');
    assertIncludes(output, 'mjs=false');
    assertIncludes(output, 'code=false');
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
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
