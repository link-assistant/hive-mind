#!/usr/bin/env node

/**
 * Unit Tests: ESLint rule no-leaked-child-processes (Issue #1493)
 *
 * Tests verify that the custom ESLint rule correctly:
 * 1. Flags bare spawn(), fork(), execFile() calls where the return value is discarded
 * 2. Allows captured calls (assigned to variable, returned, passed as argument, etc.)
 * 3. Handles member expression calls (child_process.spawn, cp.fork, etc.)
 *
 * Run with: node tests/test-no-leaked-child-processes-rule.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1493
 */

import { Linter } from 'eslint';
import rule from '../eslint-rules/no-leaked-child-processes.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Set up linter with our custom rule
const linter = new Linter();

const lint = code => {
  return linter.verify(code, {
    plugins: {
      'child-process': { rules: { 'no-leaked-child-processes': rule } },
    },
    rules: {
      'child-process/no-leaked-child-processes': 'error',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { spawn: 'readonly', fork: 'readonly', execFile: 'readonly', require: 'readonly', console: 'readonly' },
    },
  });
};

console.log('\n🧪 Testing ESLint rule: no-leaked-child-processes (Issue #1493)\n');

// ── Should flag (errors expected) ──────────────────────────────────────

console.log('  --- Should flag (bare calls) ---');

test('flags bare spawn() as expression statement', () => {
  const errors = lint(`spawn('ls', ['-la']);`);
  assert(errors.length === 1, `Expected 1 error, got ${errors.length}`);
  assert(errors[0].messageId === 'bareSpawn', `Expected bareSpawn, got ${errors[0].messageId}`);
});

test('flags bare fork() as expression statement', () => {
  const errors = lint(`fork('./worker.js');`);
  assert(errors.length === 1, `Expected 1 error, got ${errors.length}`);
});

test('flags bare execFile() as expression statement', () => {
  const errors = lint(`execFile('git', ['status']);`);
  assert(errors.length === 1, `Expected 1 error, got ${errors.length}`);
});

test('flags member expression: child_process.spawn()', () => {
  const code = `
    const child_process = require('child_process');
    child_process.spawn('ls');
  `;
  const errors = lint(code);
  assert(errors.length === 1, `Expected 1 error, got ${errors.length}`);
});

test('flags member expression: cp.fork()', () => {
  const code = `
    const cp = require('child_process');
    cp.fork('./worker.js');
  `;
  const errors = lint(code);
  assert(errors.length === 1, `Expected 1 error, got ${errors.length}`);
});

// ── Should NOT flag (no errors expected) ───────────────────────────────

console.log('\n  --- Should NOT flag (captured calls) ---');

test('allows const child = spawn(...)', () => {
  const errors = lint(`const child = spawn('ls', ['-la']);`);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('allows let proc; proc = spawn(...)', () => {
  const errors = lint(`let proc; proc = spawn('node', ['app']);`);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('allows return spawn(...)', () => {
  const code = `function createProc() { return spawn('ls'); }`;
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('allows spawn(...) passed as argument', () => {
  const code = `console.log(spawn('ls'));`;
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('allows spawn(...).on("close", handler) — member expression chain', () => {
  const code = `spawn('ls').on('close', () => {});`;
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('allows { proc: spawn(...) } — object property', () => {
  const code = `const obj = { proc: spawn('ls') };`;
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('allows [spawn(...)] — array element', () => {
  const code = `const arr = [spawn('ls')];`;
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('allows ternary: cond ? spawn(...) : null', () => {
  const code = `const x = true; const p = x ? spawn('ls') : null;`;
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

test('does not flag exec() — only flags spawn, fork, execFile', () => {
  const code = `exec('ls -la');`;
  // exec is not in the SPAWN_FUNCTIONS set, so no error expected
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}: exec() should not be flagged`);
});

test('allows await spawn(...) — unusual but captured', () => {
  const code = `async function f() { await spawn('ls'); }`;
  const errors = lint(code);
  assert(errors.length === 0, `Expected 0 errors, got ${errors.length}`);
});

// ── Summary ────────────────────────────────────────────────────────────

console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests passed!${RESET}\n`);
}
