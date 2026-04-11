#!/usr/bin/env node

/**
 * Unit tests for Issue #1572 fixes:
 * 1. Multi-line log messages get timestamps on each line
 * 2. All git push commands include 2>&1 for stderr capture
 * 3. Auto-restart and cleanup flows include git pull before push
 *
 * References:
 * - Issue #1572: https://github.com/link-assistant/hive-mind/issues/1572
 * - Root cause: auto-restart-until-mergeable mode didn't sync local branch
 *   with remote before launching new sessions, causing push failures
 */

// Use use-m to dynamically import modules
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const fs = (await use('fs')).promises;
const path = (await use('path')).default;

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`✅ PASS: ${testName}`);
    testsPassed++;
  } else {
    console.log(`❌ FAIL: ${testName}`);
    if (details) {
      console.log(`   Details: ${details}`);
    }
    testsFailed++;
  }
}

// ============================================================
// Test 1: Multi-line log messages get timestamps on each line
// ============================================================

console.log('\n--- Test: Multi-line log message formatting ---');

{
  const { log, setLogFile, getLogFile } = await import('../src/lib.mjs');
  const os = (await use('os')).default;

  const tempLogFile = path.join(os.tmpdir(), `test-log-1572-${Date.now()}.log`);
  setLogFile(tempLogFile);

  // Write a multi-line message
  await log('Line 1\nLine 2\nLine 3');

  // Wait a moment for async file write
  await new Promise(resolve => setTimeout(resolve, 100));

  const logContent = await fs.readFile(tempLogFile, 'utf8');
  const lines = logContent.trim().split('\n');

  assert(lines.length === 3, 'Multi-line message produces 3 log lines', `Got ${lines.length} lines: ${JSON.stringify(lines)}`);

  for (let i = 0; i < lines.length; i++) {
    const hasTimestamp = /^\[\d{4}-\d{2}-\d{2}T/.test(lines[i]);
    assert(hasTimestamp, `Line ${i + 1} has timestamp prefix`, `Line content: "${lines[i]}"`);
  }

  assert(lines[0].includes('Line 1'), 'First line contains "Line 1"');
  assert(lines[1].includes('Line 2'), 'Second line contains "Line 2"');
  assert(lines[2].includes('Line 3'), 'Third line contains "Line 3"');

  // Clean up
  await fs.unlink(tempLogFile).catch(() => {});
}

// ============================================================
// Test 2: All git push commands in source files include 2>&1
// ============================================================

console.log('\n--- Test: git push commands include 2>&1 ---');

{
  const srcDir = path.join(import.meta.dirname, '..', 'src');
  const files = await fs.readdir(srcDir);
  const jsFiles = files.filter(f => f.endsWith('.mjs') || f.endsWith('.js'));

  let totalPushCommands = 0;
  let pushCommandsMissing2and1 = [];

  for (const file of jsFiles) {
    const content = await fs.readFile(path.join(srcDir, file), 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match template literal git push commands in $() calls
      // Pattern: `git push ... ` (template literal with git push, executed via $)
      // Exclude: string variables (= `git push...`), comments, log statements
      if (line.includes('`git push') && line.includes('$') && !line.includes('//') && !line.includes('log(') && !line.match(/const \w+ = `git push/)) {
        totalPushCommands++;
        if (!line.includes('2>&1')) {
          pushCommandsMissing2and1.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      }
    }
  }

  assert(totalPushCommands > 0, `Found git push commands in source (${totalPushCommands} total)`);
  assert(
    pushCommandsMissing2and1.length === 0,
    'All git push template commands include 2>&1',
    pushCommandsMissing2and1.length > 0
      ? `Missing 2>&1 in:\n${pushCommandsMissing2and1.map(l => `      ${l}`).join('\n')}`
      : '',
  );
}

// ============================================================
// Test 3: Auto-merge restart includes git pull
// ============================================================

console.log('\n--- Test: Auto-restart includes git pull before restart ---');

{
  const autoMergeContent = await fs.readFile(path.join(import.meta.dirname, '..', 'src', 'solve.auto-merge.lib.mjs'), 'utf8');

  // Find the RESTART TRIGGERED section and check that git pull appears before executeToolIteration
  const restartTriggeredIdx = autoMergeContent.indexOf('RESTART TRIGGERED');
  const executeToolIterationIdx = autoMergeContent.indexOf('executeToolIteration({', restartTriggeredIdx);
  const gitPullIdx = autoMergeContent.indexOf('git pull --rebase origin', restartTriggeredIdx);

  assert(restartTriggeredIdx > 0, 'Found RESTART TRIGGERED in auto-merge code');
  assert(executeToolIterationIdx > 0, 'Found executeToolIteration call after restart trigger');
  assert(gitPullIdx > 0, 'Found git pull --rebase in auto-merge restart path');
  assert(
    gitPullIdx < executeToolIterationIdx,
    'git pull appears BEFORE executeToolIteration in restart path',
    `git pull at index ${gitPullIdx}, executeToolIteration at index ${executeToolIterationIdx}`,
  );
}

// ============================================================
// Test 4: Auto-ensure includes git pull
// ============================================================

console.log('\n--- Test: Auto-ensure includes git pull before iterations ---');

{
  const autoEnsureContent = await fs.readFile(path.join(import.meta.dirname, '..', 'src', 'solve.auto-ensure.lib.mjs'), 'utf8');

  const forLoopIdx = autoEnsureContent.indexOf('for (let ensureIteration');
  const executeToolIterationIdx = autoEnsureContent.indexOf('executeToolIteration({', forLoopIdx);
  const gitPullIdx = autoEnsureContent.indexOf('git pull --rebase origin', forLoopIdx);

  assert(forLoopIdx > 0, 'Found finalize loop in auto-ensure code');
  assert(executeToolIterationIdx > 0, 'Found executeToolIteration call in finalize loop');
  assert(gitPullIdx > 0, 'Found git pull --rebase in auto-ensure path');
  assert(
    gitPullIdx < executeToolIterationIdx,
    'git pull appears BEFORE executeToolIteration in finalize path',
    `git pull at index ${gitPullIdx}, executeToolIteration at index ${executeToolIterationIdx}`,
  );
}

// ============================================================
// Test 5: Cleanup includes git pull before revert
// ============================================================

console.log('\n--- Test: Cleanup includes git pull before revert ---');

{
  const resultsContent = await fs.readFile(path.join(import.meta.dirname, '..', 'src', 'solve.results.lib.mjs'), 'utf8');

  const cleanupFnIdx = resultsContent.indexOf('export const cleanupClaudeFile');
  const gitRevertIdx = resultsContent.indexOf('git revert', cleanupFnIdx);
  const gitPullIdx = resultsContent.indexOf('git pull --rebase origin', cleanupFnIdx);

  assert(cleanupFnIdx > 0, 'Found cleanupClaudeFile function');
  assert(gitRevertIdx > 0, 'Found git revert in cleanup');
  assert(gitPullIdx > 0, 'Found git pull --rebase in cleanup');
  assert(
    gitPullIdx < gitRevertIdx,
    'git pull appears BEFORE git revert in cleanup',
    `git pull at index ${gitPullIdx}, git revert at index ${gitRevertIdx}`,
  );
}

// ============================================================
// Summary
// ============================================================

console.log('\n' + '='.repeat(50));
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
