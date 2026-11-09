#!/usr/bin/env node
// @hive-mind-test-suite default,pr-essential

/**
 * Issue #4025: `github/codeql-action/analyze` passes even when it finds
 * problems, so 44 alerts piled up on main behind a green CodeQL check.
 * security.yml now writes the SARIF reports and runs
 * scripts/check-codeql-results.mjs on them. This file checks the gate and its
 * wiring.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCodeqlResults } from '../scripts/check-codeql-results.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const gateScript = join(repoRoot, 'scripts/check-codeql-results.mjs');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`  ✅ PASS: ${name}`);
}

const run = (overrides = {}) => ({
  tool: { driver: { name: 'CodeQL' } },
  invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }],
  results: [],
  ...overrides,
});
const sarif = runs => JSON.stringify({ version: '2.1.0', runs });

/** Write `reports` (name -> content) into a fresh directory and run the gate on it. */
function gate(reports) {
  const dir = mkdtempSync(join(tmpdir(), 'codeql-gate-4025-'));
  try {
    for (const [name, content] of Object.entries(reports)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), content);
    }
    const lines = [];
    try {
      return { count: checkCodeqlResults(dir, line => lines.push(line)), lines };
    } catch (error) {
      return { error: error.message, lines };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('scripts/check-codeql-results.mjs');

check('clean reports pass, including ones in subdirectories', () => {
  const r = gate({ 'javascript.sarif': sarif([run()]), 'nested/actions.sarif': sarif([run()]) });
  assert.equal(r.error, undefined, r.lines.join('\n'));
  assert.equal(r.count, 2);
});

check('a finding fails the gate and names the rule and location', () => {
  const finding = { ruleId: 'js/redos', level: 'error', message: { text: 'exponential backtracking' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.mjs' }, region: { startLine: 7 } } }] };
  const r = gate({ 'javascript.sarif': sarif([run({ results: [finding] })]) });
  assert.match(r.error, /rejected 1 finding/);
  assert.match(r.lines[0], /js\/redos \[error\] src\/a\.mjs:7 exponential backtracking/);
});

check('an extractor warning (for example an unparsable file) fails the gate', () => {
  const notification = { level: 'warning', descriptor: { id: 'js/diagnostics/extraction-errors' }, message: { text: 'Could not process some files due to syntax errors' } };
  const r = gate({ 'javascript.sarif': sarif([run({ invocations: [{ executionSuccessful: true, toolExecutionNotifications: [notification] }] })]) });
  assert.match(r.error, /rejected 1/);
  assert.match(r.lines[0], /extraction-errors .*\[warning\] Could not process/);
});

check('note-level notifications do not fail the gate', () => {
  const notification = { level: 'note', message: { text: 'Scanned 812 files' } };
  const r = gate({ 'javascript.sarif': sarif([run({ invocations: [{ executionSuccessful: true, toolExecutionNotifications: [notification] }] })]) });
  assert.equal(r.error, undefined, r.lines.join('\n'));
});

check('an unsuccessful invocation fails the gate', () => {
  const r = gate({ 'javascript.sarif': sarif([run({ invocations: [{ executionSuccessful: false }] })]) });
  assert.match(r.lines[0], /unsuccessful invocation in run 0/);
});

check('a missing, empty or malformed report fails the gate', () => {
  assert.match(gate({}).error, /Missing CodeQL SARIF reports/);
  assert.match(gate({ 'a.sarif': JSON.stringify({ version: '2.1.0', runs: [] }) }).lines[0], /missing runs/);
  assert.match(gate({ 'a.sarif': '{not json' }).lines[0], /a\.sarif: /);
  assert.match(gate({ 'a.sarif': sarif([{ tool: { driver: { name: 'CodeQL' } } }]) }).lines[0], /Invalid results/);
});

check('the CLI exits 1 with an error annotation on findings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'codeql-gate-4025-'));
  try {
    writeFileSync(join(dir, 'x.sarif'), sarif([run({ results: [{ ruleId: 'js/redos', message: { text: 'm' } }] })]));
    const r = spawnSync(process.execPath, [gateScript, dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /::error title=CodeQL findings::CodeQL result gate rejected 1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log('.github/workflows/security.yml');

check('the CodeQL job reports every result, writes SARIF and gates on it', () => {
  const workflow = readFileSync(join(repoRoot, '.github/workflows/security.yml'), 'utf8').replaceAll('\r\n', '\n');
  const job = workflow.slice(workflow.indexOf('\n  codeql:\n'), workflow.indexOf('\n  dependency-review:\n'));
  // Diff-informed analysis only reports results on changed lines in a pull
  // request, which would hide existing alerts from the gate.
  assert.match(job, /CODEQL_ACTION_DIFF_INFORMED_QUERIES: 'false'/);
  assert.match(job, /uses: github\/codeql-action\/analyze@v\d+\n {8}with:\n {10}output: codeql-results\n/);
  assert.match(job, /- name: Require clean CodeQL results\n {8}if: \$\{\{ !cancelled\(\) \}\}\n {8}run: node scripts\/check-codeql-results\.mjs codeql-results\n/);
  assert.match(job, /uses: actions\/upload-artifact@v\d+\n {8}with:\n {10}name: codeql-results-\$\{\{ matrix\.language \}\}\n {10}path: codeql-results\n/);
  assert.match(job, /- uses: actions\/checkout@v\d+\n {8}with:\n {10}persist-credentials: false\n/);
});

console.log(`\ncodeql-results-gate-4025.test.mjs: ${passed} checks passed`);
