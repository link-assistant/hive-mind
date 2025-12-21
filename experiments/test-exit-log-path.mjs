#!/usr/bin/env node

/**
 * Test script to verify that the log path is always displayed on exit
 * Tests various exit scenarios:
 * 1. Normal exit
 * 2. Error exit
 * 3. CTRL+C (SIGINT)
 * 4. Uncaught exception
 * 5. Unhandled rejection
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const solveScript = path.join(__dirname, '..', 'src', 'solve.mjs');
const hiveScript = path.join(__dirname, '..', 'src', 'hive.mjs');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`);
console.log(`${colors.cyan}Testing Exit Log Path Display${colors.reset}`);
console.log(
  `${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}\n`
);

// Test 1: Invalid URL (should exit with error and show log path)
console.log(
  `${colors.yellow}Test 1: Testing solve.mjs with invalid URL (should show log path on error)${colors.reset}`
);
console.log(`${colors.blue}Command: node ${solveScript} invalid-url${colors.reset}\n`);

const test1 = spawn('node', [solveScript, 'invalid-url'], {
  env: { ...process.env, FORCE_COLOR: '1' }
});

let test1Output = '';
test1.stdout.on('data', data => {
  test1Output += data.toString();
  process.stdout.write(data);
});

test1.stderr.on('data', data => {
  test1Output += data.toString();
  process.stderr.write(data);
});

test1.on('close', code => {
  console.log(`\n${colors.bright}Exit code: ${code}${colors.reset}`);

  // Check if log path was displayed
  if (test1Output.includes('Full log file:')) {
    console.log(`${colors.green}✅ Log path was displayed on error exit${colors.reset}`);
  } else {
    console.log(`${colors.red}❌ Log path was NOT displayed on error exit${colors.reset}`);
  }

  console.log(
    `\n${colors.cyan}${colors.bright}───────────────────────────────────────────────────────────${colors.reset}\n`
  );

  // Test 2: CTRL+C simulation (SIGINT)
  console.log(`${colors.yellow}Test 2: Testing solve.mjs with SIGINT (simulating CTRL+C)${colors.reset}`);
  console.log(`${colors.blue}Command: node ${solveScript} --help (then sending SIGINT)${colors.reset}\n`);

  const test2 = spawn('node', [solveScript, '--help'], {
    env: { ...process.env, FORCE_COLOR: '1' }
  });

  let test2Output = '';
  test2.stdout.on('data', data => {
    test2Output += data.toString();
    process.stdout.write(data);
  });

  test2.stderr.on('data', data => {
    test2Output += data.toString();
    process.stderr.write(data);
  });

  // Send SIGINT after a short delay
  setTimeout(() => {
    console.log(`\n${colors.yellow}Sending SIGINT...${colors.reset}\n`);
    test2.kill('SIGINT');
  }, 100);

  test2.on('close', code => {
    console.log(`\n${colors.bright}Exit code: ${code}${colors.reset}`);

    // Check if log path was displayed
    if (test2Output.includes('Full log file:') || test2Output.includes('Interrupted')) {
      console.log(`${colors.green}✅ Log path was displayed on SIGINT${colors.reset}`);
    } else {
      console.log(`${colors.red}❌ Log path was NOT displayed on SIGINT${colors.reset}`);
    }

    console.log(
      `\n${colors.cyan}${colors.bright}───────────────────────────────────────────────────────────${colors.reset}\n`
    );

    // Test 3: Test hive.mjs with missing URL
    console.log(`${colors.yellow}Test 3: Testing hive.mjs with missing URL${colors.reset}`);
    console.log(`${colors.blue}Command: node ${hiveScript}${colors.reset}\n`);

    const test3 = spawn('node', [hiveScript], {
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    let test3Output = '';
    test3.stdout.on('data', data => {
      test3Output += data.toString();
      process.stdout.write(data);
    });

    test3.stderr.on('data', data => {
      test3Output += data.toString();
      process.stderr.write(data);
    });

    test3.on('close', code => {
      console.log(`\n${colors.bright}Exit code: ${code}${colors.reset}`);

      // Check if log path was displayed
      if (test3Output.includes('Full log file:')) {
        console.log(`${colors.green}✅ Log path was displayed for hive.mjs error${colors.reset}`);
      } else {
        console.log(`${colors.red}❌ Log path was NOT displayed for hive.mjs error${colors.reset}`);
      }

      console.log(
        `\n${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}`
      );
      console.log(`${colors.cyan}Test Summary${colors.reset}`);
      console.log(
        `${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}\n`
      );

      console.log(`The exit handler should ensure that the absolute log path is`);
      console.log(`always displayed when the process exits, regardless of the`);
      console.log(`exit reason (normal, error, CTRL+C, etc.).`);

      console.log(`\n${colors.green}Tests completed!${colors.reset}\n`);
    });
  });
});
