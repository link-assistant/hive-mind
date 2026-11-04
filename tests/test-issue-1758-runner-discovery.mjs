#!/usr/bin/env node
// @hive-mind-test-suite default,pr-essential
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

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, cpSync, readFileSync, existsSync } from 'node:fs';
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
  writeTest(
    'test-integration-env.mjs',
    `#!/usr/bin/env node
// ${INTEGRATION_MARKER}
if (process.env.HIVE_MIND_RUN_INTEGRATION !== '1') {
  console.error('HIVE_MIND_RUN_INTEGRATION was not set for integration suite child process');
  process.exit(17);
}
console.log('integration env enabled');
`
  );
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
  assert(integrationTests.includes('tests/test-integration-env.mjs'), 'integration env probe is selected under --suite integration');
  assert(!integrationTests.includes('tests/test-helper-skip.mjs'), 'skip-marked helper is excluded from integration suite');

  const integrationRun = spawnSync(process.execPath, [runnerPath, '--suite', 'integration'], {
    cwd: work,
    encoding: 'utf-8',
  });
  assert(integrationRun.status === 0, '--suite integration enables HIVE_MIND_RUN_INTEGRATION for child tests');

  const ghTests = listTests(work, 'github-integration');
  assert(ghTests.includes('tests/test-other-suite.mjs'), 'github-integration suite finds matching test');
  assert(!ghTests.includes('tests/test-plain.mjs'), 'plain test is not selected for github-integration suite');

  // The reviewed PR profile is metadata owned by each existing test file.
  // Exercise the actual selection CLI against only these files plus the old
  // synthetic cases; no selected test body is executed by --list.
  const profileFiles = ['tests/e2e-hello-world-matrix-2319.test.mjs', 'tests/agent-default-free-model-2625.test.mjs', 'tests/test-issue-2187-current-dependency-pins.mjs', 'tests/test-docker-release-order.mjs', 'tests/prompt-catalogues-3837.test.mjs', 'tests/formal-ai-tool-parity-3279.test.mjs', 'tests/formal-ai-attribution-generation-identity-2317.test.mjs', 'tests/formal-ai-draft-3248.test.mjs', 'tests/formal-ai-draft-checks-3248.test.mjs', 'tests/formal-ai-no-change-ready-3330.test.mjs', 'tests/test-issue-1758-runner-discovery.mjs', 'tests/test-test-runner-1698.test.mjs'];
  assert(profileFiles.length <= 32 && new Set(profileFiles).size === profileFiles.length, 'the reviewed PR profile is bounded and has no duplicate paths');
  for (const file of profileFiles) cpSync(join(repoRoot, file), join(work, file));
  const essentialTests = listTests(work, 'pr-essential');
  const expectedEssential = [...profileFiles].sort();
  assert(JSON.stringify(essentialTests) === JSON.stringify(expectedEssential), 'the real named selector returns exactly the reviewed PR files');
  const fullAfterProfile = listTests(work, 'default');
  assert(
    expectedEssential.every(file => fullAfterProfile.includes(file)),
    'every PR-essential test remains in the full default suite'
  );
  assert(JSON.stringify(fullAfterProfile.filter(file => !expectedEssential.includes(file))) === JSON.stringify(defaultTests), 'all pre-existing default fixture members remain selected');

  const releaseWorkflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
  const jobStart = releaseWorkflow.indexOf('  test-suites:\n');
  const nextJob = /\n {2}[A-Za-z0-9_-]+:\n/.exec(releaseWorkflow.slice(jobStart + 1));
  assert(jobStart >= 0, 'the source test job exists');
  const jobSource = releaseWorkflow.slice(jobStart, nextJob ? jobStart + 1 + nextJob.index : undefined);
  const stepSource = name => {
    const header = '      - name: ' + name + '\n';
    const start = jobSource.indexOf(header);
    if (start < 0) throw new Error('Missing workflow step: ' + name);
    const end = jobSource.indexOf('\n      - ', start + header.length);
    return jobSource.slice(start, end < 0 ? undefined : end);
  };
  const selectorStep = stepSource('Select source test profile');
  const expression = value => '$' + '{{ ' + value + ' }}';
  for (const [name, value] of [
    ['EVENT_NAME', 'github.event_name'],
    ['CURRENT_REF', 'github.ref'],
    ['DEFAULT_BRANCH', 'github.event.repository.default_branch'],
  ])
    assert(selectorStep.includes('          ' + name + ': ' + expression(value)), 'profile selection binds trusted workflow context: ' + name);
  assert(!selectorStep.includes('REQUESTED_PR') && !selectorStep.includes('inputs'), 'profile selection adds no PR-number source-admission shortcut');
  const commandMarker = '        run: |\n';
  const commandStart = selectorStep.indexOf(commandMarker);
  if (commandStart < 0) throw new Error('Missing source profile command');
  const selectorScript =
    selectorStep
      .slice(commandStart + commandMarker.length)
      .split('\n')
      .filter(Boolean)
      .map(line => {
        if (!line.startsWith(' '.repeat(10))) throw new Error('Profile command escaped its YAML block');
        return line.slice(10);
      })
      .join('\n') + '\n';
  const outputPath = join(work, 'profile-output');
  const contexts = [
    ['pull_request', 'refs/pull/17/merge', 'main', 'pr-essential'],
    ['workflow_dispatch', 'refs/heads/feature/example', 'main', 'pr-essential'],
    ['push', 'refs/heads/main', 'main', 'default'],
    ['workflow_dispatch', 'refs/heads/main', 'main', 'default'],
    ['push', 'refs/heads/trunk', 'trunk', 'default'],
    ['workflow_dispatch', 'refs/heads/trunk', 'trunk', 'default'],
    ['pull_request_target', 'refs/heads/main', 'main', 'default'],
    ['workflow_dispatch', 'refs/tags/v1.0.0', 'main', 'default'],
  ];
  for (const [event, ref, defaultBranch, expected] of contexts) {
    rmSync(outputPath, { force: true });
    const selected = spawnSync('bash', ['-eu'], { input: selectorScript, cwd: work, encoding: 'utf8', timeout: 2000, maxBuffer: 65536, env: { ...process.env, EVENT_NAME: event, CURRENT_REF: ref, DEFAULT_BRANCH: defaultBranch, GITHUB_OUTPUT: outputPath } });
    assert(selected.status === 0 && existsSync(outputPath) && readFileSync(outputPath, 'utf8') === 'suite=' + expected + '\n', 'actual workflow selector chooses ' + expected + ' for ' + event + ' ' + ref);
  }
  const gate = "steps.test-profile.outputs.suite == 'default' && vars.ENABLE_REAL_GITHUB_E2E == 'true'";
  for (const name of ['Resolve GitHub credentials', 'Run GitHub integration test suite', 'Upload integration evidence']) assert(stepSource(name).includes(gate), 'real integration remains full-branch and explicitly opt-in: ' + name);
  const runSource = stepSource('Run selected source test suite');
  assert(runSource.includes('npm test') && runSource.includes('node scripts/run-tests.mjs --suite "$TEST_SUITE"'), 'both lanes retain the existing shared test entrypoints');
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log('='.repeat(70));
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
