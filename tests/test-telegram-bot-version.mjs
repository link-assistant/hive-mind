#!/usr/bin/env node

/**
 * Tests for hive-telegram-bot --version output
 * Verifies that --version displays cleanly without dotenvx warnings
 *
 * Run with: node tests/test-telegram-bot-version.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1318
 */

import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('='.repeat(80));
console.log('Unit Tests: Telegram Bot --version Output (Issue #1318)');
console.log('='.repeat(80));
console.log();

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    const result = fn();
    if (result === true) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name}`);
      console.log(`     Result: ${JSON.stringify(result)}`);
      failed++;
    }
  } catch (error) {
    console.log(`  ❌ FAIL: ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
}

/**
 * Execute telegram-bot.mjs with given args and return { stdout, stderr }
 */
function execTelegramBot(args, options = {}) {
  const cmd = `node ${join(projectRoot, 'src', 'telegram-bot.mjs')} ${args}`;
  const env = { ...process.env, ...options.env };

  // Run in a directory without .env file to simulate the issue
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      cwd: options.cwd || '/tmp',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });
    return { stdout: result.trim(), stderr: '' };
  } catch (error) {
    // execSync throws on non-zero exit code, but we still want stdout/stderr
    return {
      stdout: (error.stdout || '').trim(),
      stderr: (error.stderr || '').trim(),
      exitCode: error.status,
    };
  }
}

// ===========================================================================
// Tests for --version
// ===========================================================================
console.log('\n--- --version Output Tests ---\n');

runTest('--version returns version number', () => {
  const { stdout } = execTelegramBot('--version');
  // Version should be a semver string (possibly with git hash suffix)
  // e.g., "1.23.12" or "1.23.12.d84d6409"
  const versionPattern = /^\d+\.\d+\.\d+(\.[a-f0-9]+)?$/;
  return versionPattern.test(stdout);
});

runTest('--version output does not contain MISSING_ENV_FILE warning', () => {
  const { stdout, stderr } = execTelegramBot('--version');
  const combined = stdout + '\n' + stderr;
  return !combined.includes('MISSING_ENV_FILE');
});

runTest('--version output does not contain dotenvx error URLs', () => {
  const { stdout, stderr } = execTelegramBot('--version');
  const combined = stdout + '\n' + stderr;
  return !combined.includes('dotenvx/dotenvx/issues');
});

runTest('--version output does not contain [ERROR] markers', () => {
  const { stdout, stderr } = execTelegramBot('--version');
  const combined = stdout + '\n' + stderr;
  return !combined.includes('[ERROR]') && !combined.includes('[MISSING_');
});

runTest('--version does not print "unknown" as version', () => {
  const { stdout } = execTelegramBot('--version');
  return stdout !== 'unknown';
});

runTest('--version is a single line output', () => {
  const { stdout } = execTelegramBot('--version');
  const lines = stdout.split('\n').filter(line => line.trim());
  return lines.length === 1;
});

// ===========================================================================
// Tests in clean environment (no HOME .env)
// ===========================================================================
console.log('\n--- Clean Environment Tests ---\n');

runTest('--version works with non-existent HOME directory', () => {
  const { stdout, stderr } = execTelegramBot('--version', {
    env: { HOME: '/tmp/nonexistent-home-' + Date.now() },
  });
  const combined = stdout + '\n' + stderr;
  // Should not contain any dotenvx warnings
  const hasNoWarnings = !combined.includes('MISSING_ENV_FILE') && !combined.includes('dotenvx');
  // Should contain a valid version
  const versionPattern = /\d+\.\d+\.\d+/;
  return hasNoWarnings && versionPattern.test(stdout);
});

runTest('--version exits with code 0', () => {
  try {
    execSync(`node ${join(projectRoot, 'src', 'telegram-bot.mjs')} --version`, {
      encoding: 'utf8',
      cwd: '/tmp',
      timeout: 30000,
    });
    return true;
  } catch (error) {
    // If it throws, it means non-zero exit
    return error.status === 0;
  }
});

// ===========================================================================
// Summary
// ===========================================================================
console.log('\n' + '='.repeat(80));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(80));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
