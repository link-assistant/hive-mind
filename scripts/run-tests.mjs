#!/usr/bin/env node

/**
 * Stable test-suite runner.
 *
 * New tests can join the default suite by adding this marker to the test file:
 *   @hive-mind-test-suite default
 *
 * This keeps package.json and CI workflows from changing every time a test file
 * is added.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DEFAULT_SUITE = 'default';
const SUITE_MARKER_PATTERN = /@hive-mind-test-suite\s+([A-Za-z0-9_, -]+)/g;

const LEGACY_DEFAULT_TESTS = [
  'tests/limits-display.test.mjs',
  'tests/solve-queue.test.mjs',
  'tests/test-agent-token-usage.mjs',
  'tests/test-auto-restart-limits-1664.mjs',
  'tests/test-branch-name-validation.mjs',
  'tests/test-build-cost-info-string.mjs',
  'tests/test-claude-code-install-method.mjs',
  'tests/test-claude-quiet-config.mjs',
  'tests/test-codex-support.mjs',
  'tests/test-configure-claude-bin.mjs',
  'tests/test-detect-code-changes-1528.mjs',
  'tests/test-docker-box-migration.mjs',
  'tests/test-docker-release-order.mjs',
  'tests/test-docs-options-sync.mjs',
  'tests/test-extract-isolation-from-args.mjs',
  'tests/test-feedback-lines-simple.mjs',
  'tests/test-fork-parent-validation.mjs',
  'tests/test-github-linking.mjs',
  'tests/test-hive-no-silent-failure.mjs',
  'tests/test-hive-screens.mjs',
  'tests/test-hive-solve-option-parity.mjs',
  'tests/test-hive.mjs',
  'tests/test-interactive-mode.mjs',
  'tests/test-isolation-runner.mjs',
  'tests/test-isolation-screen-fallback-1545.mjs',
  'tests/test-isolation-screen-integration-1545.mjs',
  'tests/test-issue-1337-stderr-warning-detection.mjs',
  'tests/test-issue-1616-pr-issue-link-preservation.mjs',
  'tests/test-issue-1670-screen-status-monitoring.mjs',
  'tests/test-issue-1680-session-monitoring.mjs',
  'tests/test-issue-1684-message-formatting.mjs',
  'tests/test-issue-1686-log-command.mjs',
  'tests/test-issue-1688-subscribe-and-pr-link.mjs',
  'tests/test-issue-1694-stabilized-defaults.mjs',
  'tests/test-lenv-reader.mjs',
  'tests/test-lino.mjs',
  'tests/test-log-upload-output-1678.mjs',
  'tests/test-log-upload-output-1682.mjs',
  'tests/test-memory-check.mjs',
  'tests/test-pre-pr-failure-notifier-1640.mjs',
  'tests/test-queue-display-1267.mjs',
  'tests/test-ready-to-merge-pagination-1645.mjs',
  'tests/test-require-gh-paginate-rule.mjs',
  'tests/test-sentry.mjs',
  'tests/test-session-monitor-isolation.mjs',
  'tests/test-solve-queue-command.mjs',
  'tests/test-solve.mjs',
  'tests/test-start-screen.mjs',
  'tests/test-telegram-bot-command-aliases.mjs',
  'tests/test-telegram-bot-configuration-isolation-links-notation.mjs',
  'tests/test-telegram-bot-dry-run.mjs',
  'tests/test-telegram-bot-hero-links-notation.mjs',
  'tests/test-telegram-bot-launcher.mjs',
  'tests/test-telegram-markdown-escaping.mjs',
  'tests/test-telegram-message-filters.mjs',
  'tests/test-telegram-options-before-url.mjs',
  'tests/test-telegram-special-char-handling.mjs',
  'tests/test-telegram-url-extraction.mjs',
  'tests/test-telegram-validate-url.mjs',
  'tests/test-token-sanitization.mjs',
  'tests/test-unicode-sanitization.mjs',
  'tests/test-usage-limit.mjs',
];

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
  --suite <name>          Run tests marked for a suite (default: default)
  --all                   Run every .mjs file under tests/
  --list                  Print selected test files without running them
  --continue-on-failure   Run all selected tests before exiting non-zero
  --node-bin <path>       Node executable to use for test files
  -h, --help              Show this help

Default-suite marker:
  @hive-mind-test-suite default`);
}

async function listMjsFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMjsFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
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

async function getMarkedTests(suite) {
  const files = await listMjsFiles('tests');
  const matches = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    if (parseSuites(content).has(suite)) {
      matches.push(file);
    }
  }

  return matches.sort();
}

async function getSelectedTests(options) {
  if (options.all) {
    return (await listMjsFiles('tests')).sort();
  }

  const selected = new Set();

  if (options.suite === DEFAULT_SUITE) {
    for (const file of LEGACY_DEFAULT_TESTS) {
      selected.add(file);
    }
  }

  for (const file of await getMarkedTests(options.suite)) {
    selected.add(file);
  }

  return [...selected].filter(file => existsSync(file)).sort();
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
