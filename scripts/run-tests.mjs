#!/usr/bin/env node

/**
 * Folder-based test-suite runner.
 *
 * Every `*.mjs` / `*.test.mjs` / `*.test.js` under tests/ runs in the default
 * suite unless the file declares one of the following markers:
 *
 *   @hive-mind-test-suite <name>   — opt the test into a named suite
 *                                    (e.g. github-integration). When set to a
 *                                    value other than "default" the file is
 *                                    excluded from the default suite.
 *   @hive-mind-integration         — short-hand for an integration test that
 *                                    is skipped by default. Run via
 *                                    `--suite integration` or by setting the
 *                                    HIVE_MIND_RUN_INTEGRATION=1 environment
 *                                    variable.
 *
 * Files that declare neither marker are part of the default suite. This keeps
 * a single source of truth (the test file itself) and avoids the "silent
 * orphan" mode where new tests had to be added to a hard-coded list.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1758
 */

import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DEFAULT_SUITE = 'default';
const INTEGRATION_SUITE = 'integration';
// Markers must appear inside a comment line: optional ` *` JSDoc or `//`
// prefix, then the marker, then end-of-comment punctuation (newline, `*/`,
// or backtick). This keeps prose about the markers (e.g. backtick-quoted
// references in docstrings) from being treated as marker declarations.
const SUITE_MARKER_PATTERN = /(?:^|\n)\s*(?:\*|\/\/)\s*@hive-mind-test-suite\s+([A-Za-z0-9][A-Za-z0-9_,-]*)\s*(?:\n|\*\/|$)/g;
const INTEGRATION_MARKER_PATTERN = /(?:^|\n)\s*(?:\*|\/\/)\s*@hive-mind-integration\s*(?:\n|\*\/|$)/;
const SKIP_MARKER_PATTERN = /(?:^|\n)\s*(?:\*|\/\/)\s*@hive-mind-test-skip\s*(?:\n|\*\/|$)/;
const TEST_FILE_PATTERN = /\.(test\.mjs|test\.js|mjs)$/;

function parseArgs(argv) {
  const options = {
    suite: DEFAULT_SUITE,
    list: false,
    all: false,
    continueOnFailure: false,
    nodeBin: process.env.HIVE_MIND_TEST_NODE || process.execPath,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--suite') {
      options.suite = argv[++index] || DEFAULT_SUITE;
    } else if (arg.startsWith('--suite=')) {
      options.suite = arg.slice('--suite='.length) || DEFAULT_SUITE;
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--continue-on-failure') {
      options.continueOnFailure = true;
    } else if (arg === '--node-bin') {
      options.nodeBin = argv[++index] || options.nodeBin;
    } else if (arg.startsWith('--node-bin=')) {
      options.nodeBin = arg.slice('--node-bin='.length) || options.nodeBin;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/run-tests.mjs [options]

Options:
  --suite <name>          Run tests in the named suite (default: default)
  --all                   Run every test file under tests/ (ignoring markers)
  --list                  Print selected test files without running them
  --continue-on-failure   Run all selected tests before exiting non-zero
  --node-bin <path>       Node executable to use for test files
  -h, --help              Show this help

Markers (declared inside the test file):
  @hive-mind-test-suite <name>   Opt into a named suite (e.g. github-integration).
                                 Files marked with any non-default suite are
                                 excluded from the default suite.
  @hive-mind-integration          Skip in the default suite. Run via
                                 \`--suite integration\` or
                                 \`HIVE_MIND_RUN_INTEGRATION=1\`.
  @hive-mind-test-skip            Helper / fixture module — never run as a test.

Suites used today:
  default          Token-free / dry-run-safe tests run in CI and locally.
  github-integration  GitHub-API-touching tests run in their own CI step.
  integration      Hand-rolled @hive-mind-integration files; opt-in only.
  needs-triage     Pre-existing orphan tests parked while their failures are
                   investigated under the issue #1758 follow-up.

Notes:
  Files in tests/ matching *.mjs, *.test.mjs, *.test.js are discovered
  automatically; no allow-list is maintained.`);
}

async function listTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTestFiles(fullPath)));
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(relative(process.cwd(), fullPath));
    }
  }

  return files;
}

function parseSuites(content) {
  const suites = new Set();
  let match;

  while ((match = SUITE_MARKER_PATTERN.exec(content)) !== null) {
    for (const suite of match[1].split(/[,\s]+/)) {
      if (suite) {
        suites.add(suite);
      }
    }
  }

  SUITE_MARKER_PATTERN.lastIndex = 0;
  return suites;
}

function parseMarkers(content) {
  return {
    suites: parseSuites(content),
    integration: INTEGRATION_MARKER_PATTERN.test(content),
    skip: SKIP_MARKER_PATTERN.test(content),
  };
}

async function loadTestMarkers() {
  const files = await listTestFiles('tests');
  const records = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const markers = parseMarkers(content);
    if (markers.skip) continue;
    records.push({ file, ...markers });
  }

  return records;
}

function isIntegrationSuite(suite) {
  return suite === INTEGRATION_SUITE || process.env.HIVE_MIND_RUN_INTEGRATION === '1';
}

function shouldIncludeInDefault(record) {
  if (record.integration) return false;
  if (record.suites.size === 0) return true;
  if (record.suites.has(DEFAULT_SUITE)) return true;
  return false;
}

async function getSelectedTests(options) {
  const records = await loadTestMarkers();

  if (options.all) {
    return records.map(r => r.file).sort();
  }

  if (options.suite === DEFAULT_SUITE) {
    return records
      .filter(shouldIncludeInDefault)
      .map(r => r.file)
      .sort();
  }

  if (isIntegrationSuite(options.suite)) {
    return records
      .filter(r => r.integration || r.suites.has(INTEGRATION_SUITE))
      .map(r => r.file)
      .sort();
  }

  return records
    .filter(r => r.suites.has(options.suite))
    .map(r => r.file)
    .sort();
}

function runTestFile(file, nodeBin) {
  return new Promise(resolve => {
    const child = spawn(nodeBin, [file], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', error => {
      console.error(`Failed to start ${file}: ${error.message}`);
      resolve(1);
    });

    child.on('close', (code, signal) => {
      if (signal) {
        console.error(`${file} terminated with signal ${signal}`);
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tests = await getSelectedTests(options);

  if (tests.length === 0) {
    console.error(`No tests selected for suite "${options.suite}".`);
    process.exit(1);
  }

  if (options.list) {
    for (const testFile of tests) {
      console.log(testFile);
    }
    return;
  }

  const failures = [];

  console.log(`Running ${tests.length} ${options.suite} test file(s)...`);
  for (const [index, testFile] of tests.entries()) {
    console.log(`\n[${index + 1}/${tests.length}] ${testFile}`);
    const code = await runTestFile(testFile, options.nodeBin);
    if (code !== 0) {
      failures.push({ file: testFile, code });
      if (!options.continueOnFailure) {
        break;
      }
    }
  }

  if (failures.length > 0) {
    console.error('\nFailed test files:');
    for (const failure of failures) {
      console.error(`  - ${failure.file} (exit ${failure.code})`);
    }
    process.exit(1);
  }

  console.log(`\nAll ${tests.length} selected test file(s) passed.`);
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
