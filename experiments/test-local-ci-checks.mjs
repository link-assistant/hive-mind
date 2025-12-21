#!/usr/bin/env node

/**
 * Test script for local CI checks detection and execution
 */

import { detectCITools, runLocalCIChecks, generateCICheckReport } from '../src/local-ci-checks.lib.mjs';

console.log('🧪 Testing Local CI Checks Detection\n');

async function testCurrentRepo() {
  console.log('Testing current repository (hive-mind)...\n');

  const workDir = process.cwd();
  console.log('Working directory:', workDir);

  const tools = await detectCITools(workDir);

  console.log('\nDetected Tools:');
  console.log('  Python:');
  console.log('    - ruff:', tools.python.ruff);
  console.log('    - mypy:', tools.python.mypy);
  console.log('    - pytest:', tools.python.pytest);
  console.log('    - nox:', tools.python.nox);
  console.log('    - black:', tools.python.black);
  console.log('    - flake8:', tools.python.flake8);

  console.log('  JavaScript:');
  console.log('    - eslint:', tools.javascript.eslint);
  console.log('    - prettier:', tools.javascript.prettier);
  console.log('    - jest:', tools.javascript.jest);
  console.log('    - vitest:', tools.javascript.vitest);

  console.log('  Rust:');
  console.log('    - rustfmt:', tools.rust.rustfmt);
  console.log('    - clippy:', tools.rust.clippy);
  console.log('    - cargo test:', tools.rust.cargoTest);

  console.log('  General:');
  console.log('    - pre-commit:', tools.general.preCommit);

  // Only run checks if any are detected
  const hasAnyTool = Object.values(tools).some(category => Object.values(category).some(value => value === true));

  if (hasAnyTool) {
    console.log('\n--- Running Local CI Checks (dry run - will show what would run) ---');
    console.log('Note: Actual execution skipped in test mode');
  } else {
    console.log('\n--- No CI tools detected in this repository ---');
  }
}

// Run test
try {
  await testCurrentRepo();
  console.log('\n✅ Test completed successfully!');
} catch (err) {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
}
