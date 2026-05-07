#!/usr/bin/env node
/**
 * Regression tests for the folder-based test discovery introduced in #1758.
 *
 * Verifies that scripts/run-tests.mjs:
 *   1. Picks up an arbitrary new *.mjs file under tests/ in the default suite
 *      without requiring an allow-list update.
 *   2. Excludes files marked with `@hive-mind-test-suite <other>`.
 *   3. Excludes files marked with `@hive-mind-integration` from the default
 *      suite, and includes them under `--suite integration`.
 *   4. Excludes files marked with `@hive-mind-test-skip` from every suite.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1758
 * @hive-mind-test-suite default
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');
const runnerPath = join(repoRoot, 'scripts', 'run-tests.mjs');

let passed = 0;
let failed = 0;

function assert(cond, message) {
  if (cond) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ ${message}`);
    failed++;
  }
}

/**
 * Run the runner with --list against a synthetic tests/ directory and return
 * the list of selected files.
 */
function listTests(workDir, suite) {
  const args = ['--list'];
  if (suite) args.push('--suite', suite);
  try {
    const out = execFileSync(process.execPath, [runnerPath, ...args], {
      cwd: workDir,
      encoding: 'utf-8',
    });
    return out
      .trim()
      .split('\n')
      .filter(line => line.length > 0);
  } catch (err) {
    if (err.status === 1 && err.stderr?.includes('No tests selected')) {
      return [];
    }
    throw err;
  }
}

// Marker strings are assembled at runtime so this test file itself is not
// classified by the runner as anything other than default.
const AT = '@';
const SUITE_MARKER = `${AT}hive-mind-test-suite`;
const INTEGRATION_MARKER = `${AT}hive-mind-integration`;
const SKIP_MARKER = `${AT}hive-mind-test-skip`;

function setupSyntheticRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'hive-mind-runner-test-'));
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  cpSync(runnerPath, join(dir, 'scripts', 'run-tests.mjs'));
  mkdirSync(join(dir, 'tests'));

  const writeTest = (name, body) => writeFileSync(join(dir, 'tests', name), body);

  writeTest('test-plain.mjs', `#!/usr/bin/env node\nconsole.log('plain');\n`);
  writeTest('test-explicit-default.mjs', `#!/usr/bin/env node\n// ${SUITE_MARKER} default\nconsole.log('explicit');\n`);
  writeTest('test-other-suite.mjs', `#!/usr/bin/env node\n// ${SUITE_MARKER} github-integration\nconsole.log('gh');\n`);
  writeTest('test-integration-marker.mjs', `#!/usr/bin/env node\n// ${INTEGRATION_MARKER}\nconsole.log('integration');\n`);
  writeTest('test-helper-skip.mjs', `// ${SKIP_MARKER}\nexport const helper = true;\n`);

  return dir;
}

console.log('Issue #1758 — folder-based runner discovery');
console.log('='.repeat(70));

const work = setupSyntheticRepo();
try {
  const defaultTests = listTests(work, 'default');
  assert(defaultTests.includes('tests/test-plain.mjs'), 'plain test (no marker) is included in default suite');
  assert(defaultTests.includes('tests/test-explicit-default.mjs'), 'explicit default-suite marker is included');
  assert(!defaultTests.includes('tests/test-other-suite.mjs'), 'github-integration-marked test is excluded from default');
  assert(!defaultTests.includes('tests/test-integration-marker.mjs'), 'integration-marked test is excluded from default');
  assert(!defaultTests.includes('tests/test-helper-skip.mjs'), 'skip-marked helper is excluded from default');

  const integrationTests = listTests(work, 'integration');
  assert(integrationTests.includes('tests/test-integration-marker.mjs'), 'integration-marked test is selected under --suite integration');
  assert(!integrationTests.includes('tests/test-helper-skip.mjs'), 'skip-marked helper is excluded from integration suite');

  const ghTests = listTests(work, 'github-integration');
  assert(ghTests.includes('tests/test-other-suite.mjs'), 'github-integration suite finds matching test');
  assert(!ghTests.includes('tests/test-plain.mjs'), 'plain test is not selected for github-integration suite');
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log('='.repeat(70));
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
