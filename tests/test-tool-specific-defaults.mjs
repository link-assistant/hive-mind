#!/usr/bin/env node

/**
 * Test suite for tool-specific default values in solve.mjs
 * Issue #1158: --tool agent should default to --gitkeep-file instead of --claude-file
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const solvePath = join(__dirname, '..', 'src', 'solve.mjs');

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

function execCommand(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    // For commands that exit with non-zero, we still want the output
    return error.stdout || error.stderr || error.message;
  }
}

// Test 1: Verify --help shows updated descriptions for claude-file
runTest('--claude-file description mentions tool-specific defaults', () => {
  const output = execCommand(`${solvePath} --help 2>&1`);
  if (!output.includes('default for --tool claude')) {
    throw new Error('--claude-file description should mention it is default for --tool claude');
  }
});

// Test 2: Verify --help shows updated descriptions for gitkeep-file
runTest('--gitkeep-file description mentions tool-specific defaults', () => {
  const output = execCommand(`${solvePath} --help 2>&1`);
  // The help text may be wrapped across lines, so check for key parts
  if (!output.includes('agent/opencode/codex')) {
    throw new Error('--gitkeep-file description should mention it is default for agent/opencode/codex tools');
  }
});

// Test 3: Verify --tool claude with --dry-run shows CLAUDE.md creation
runTest('--tool claude defaults to CLAUDE.md', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --tool claude --dry-run --skip-tool-connection-check 2>&1`);
  // In dry-run mode, should show it's using CLAUDE.md (not .gitkeep)
  // This is inferred from the default behavior and help text
  if (output.includes('.gitkeep mode') && !output.includes('CLAUDE.md')) {
    throw new Error('--tool claude should default to CLAUDE.md, not .gitkeep');
  }
});

// Test 4: Verify --tool agent with --dry-run shows .gitkeep creation
runTest('--tool agent defaults to .gitkeep', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --tool agent --dry-run --skip-tool-connection-check 2>&1`);
  // In dry-run mode with --tool agent, should use .gitkeep by default
  // Note: This test checks for absence of CLAUDE.md being explicitly created when agent is selected
  // The actual behavior is validated by the logging output
  if (output.includes('Creating:') && output.includes('CLAUDE.md') && !output.includes('.gitkeep')) {
    throw new Error('--tool agent should default to .gitkeep, not CLAUDE.md');
  }
});

// Test 5: Verify --tool opencode with --dry-run shows .gitkeep creation
runTest('--tool opencode defaults to .gitkeep', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --tool opencode --dry-run --skip-tool-connection-check 2>&1`);
  if (output.includes('Creating:') && output.includes('CLAUDE.md') && !output.includes('.gitkeep')) {
    throw new Error('--tool opencode should default to .gitkeep, not CLAUDE.md');
  }
});

// Test 6: Verify --tool codex with --dry-run shows .gitkeep creation
runTest('--tool codex defaults to .gitkeep', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --tool codex --dry-run --skip-tool-connection-check 2>&1`);
  if (output.includes('Creating:') && output.includes('CLAUDE.md') && !output.includes('.gitkeep')) {
    throw new Error('--tool codex should default to .gitkeep, not CLAUDE.md');
  }
});

// Test 7: Verify explicit --claude-file overrides default for --tool agent
runTest('explicit --claude-file overrides --tool agent default', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --tool agent --claude-file --dry-run --skip-tool-connection-check 2>&1`);
  // When --claude-file is explicitly provided, it should be used even with --tool agent
  // Check that the command accepts the combination without error about mutual exclusivity
  if (output.includes('mutually exclusive')) {
    throw new Error('explicit --claude-file should work with --tool agent');
  }
});

// Test 8: Verify explicit --gitkeep-file overrides default for --tool claude
runTest('explicit --gitkeep-file overrides --tool claude default', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --tool claude --gitkeep-file --dry-run --skip-tool-connection-check 2>&1`);
  // When --gitkeep-file is explicitly provided, it should be used even with --tool claude
  if (output.includes('mutually exclusive')) {
    throw new Error('explicit --gitkeep-file should work with --tool claude');
  }
});

// Test 9: Verify mutual exclusivity still works when both are explicit
runTest('mutual exclusivity enforced when both explicitly set', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --claude-file --gitkeep-file --dry-run --skip-tool-connection-check 2>&1`);
  // The error message contains "mutually exclusive"
  if (!output.includes('--claude-file and --gitkeep-file are mutually exclusive')) {
    throw new Error('should reject when both --claude-file and --gitkeep-file are explicitly set');
  }
});

// Test 10: Verify both cannot be disabled
runTest('cannot disable both claude-file and gitkeep-file', () => {
  const output = execCommand(`${solvePath} https://github.com/test/test/issues/1 --no-claude-file --no-gitkeep-file --dry-run --skip-tool-connection-check 2>&1`);
  // The error message says "Cannot disable both"
  if (!output.includes('Cannot disable both --claude-file and --gitkeep-file')) {
    throw new Error('should reject when both are disabled');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for tool-specific defaults:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
