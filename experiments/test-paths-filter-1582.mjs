#!/usr/bin/env node

/**
 * Test that the paths filter in release.yml covers all file types
 * that the CI pipeline cares about, and excludes non-code file types.
 *
 * Issue #1582: Verify paths filter correctness
 *
 * Uses simple glob matching that approximates GitHub Actions path matching:
 * - ** matches any path segment(s)
 * - * matches any characters within a segment
 */

// Paths filter from release.yml (must match exactly what's in the file)
const pathsFilter = ['**.mjs', '**.js', '**.sh', '**.json', '**.yml', '**.yaml', '**.md', '.changeset/**', '.github/**', 'Dockerfile', 'coolify/Dockerfile', '.dockerignore', 'helm/**', '.prettierrc', '.prettierignore', '.eslintrc*'];

/**
 * Simple glob matching that approximates GitHub Actions path matching.
 * ** matches zero or more path segments
 * * matches any characters except /
 */
function globMatch(pattern, filePath) {
  // Convert glob pattern to regex
  let regex = pattern
    .replace(/\./g, '\\.') // Escape dots
    .replace(/\*\*/g, '§§') // Temp placeholder for **
    .replace(/\*/g, '[^/]*') // * = any chars except /
    .replace(/§§/g, '.*') // ** = any path
    .replace(/\?/g, '[^/]'); // ? = single char
  return new RegExp(`^${regex}$`).test(filePath);
}

function matchesPathsFilter(filePath) {
  return pathsFilter.some(pattern => globMatch(pattern, filePath));
}

// === Files that SHOULD trigger the workflow ===
const shouldTrigger = [
  // Code files (.mjs)
  'src/solve.mjs',
  'tests/test-solve.mjs',
  'scripts/detect-code-changes.mjs',
  // JavaScript files (.js)
  'some-script.js',
  // Shell scripts (.sh)
  'scripts/check-mjs-syntax.sh',
  // Config files (.json)
  'package.json',
  'package-lock.json',
  // Workflow files (.yml/.yaml)
  '.github/workflows/release.yml',
  '.github/workflows/cleanup-test-repos.yml',
  // Documentation (.md)
  'README.md',
  'docs/case-studies/issue-1582/README.md',
  // Changesets
  '.changeset/my-changeset.md',
  '.changeset/config.json',
  // Docker files
  'Dockerfile',
  'coolify/Dockerfile',
  '.dockerignore',
  // Helm charts
  'helm/hive-mind/Chart.yaml',
  'helm/hive-mind/values.yaml',
  'helm/hive-mind/templates/deployment.yaml',
  // Prettier/ESLint config
  '.prettierrc',
  '.prettierignore',
  '.eslintrc.json',
];

// === Files that should NOT trigger the workflow ===
const shouldNotTrigger = ['.gitkeep', 'some-image.png', 'some-image.jpg', 'some-file.txt', 'some-file.log', 'LICENSE', 'some-archive.tar.gz', '.DS_Store', 'some-file.csv', 'some-binary.wasm', 'data.sqlite'];

let passed = 0;
let failed = 0;

console.log('=== Testing paths filter for release.yml (Issue #1582) ===\n');

console.log('--- Files that SHOULD trigger the workflow ---');
for (const file of shouldTrigger) {
  const matches = matchesPathsFilter(file);
  if (matches) {
    console.log(`  ✅ ${file}`);
    passed++;
  } else {
    console.log(`  ❌ ${file} — NOT matched (should be)`);
    failed++;
  }
}

console.log('\n--- Files that should NOT trigger the workflow ---');
for (const file of shouldNotTrigger) {
  const matches = matchesPathsFilter(file);
  if (!matches) {
    console.log(`  ✅ ${file} — correctly excluded`);
    passed++;
  } else {
    console.log(`  ❌ ${file} — MATCHED (should not be)`);
    failed++;
  }
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
