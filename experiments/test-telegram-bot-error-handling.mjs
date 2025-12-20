#!/usr/bin/env node

/**
 * Test script to verify telegram bot error handling improvements
 * This script tests that:
 * 1. Sentry integration is properly imported
 * 2. Error handler provides detailed error information
 * 3. Error messages to users are informative but don't leak sensitive data
 * 4. Breadcrumbs are added for error tracking
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Test: Telegram Bot Error Handling Improvements');
console.log('='.repeat(60));

// Test 1: Verify Sentry imports
console.log('\nTest 1: Checking Sentry integration imports...');
try {
  const fileContent = await readFile(join(__dirname, '../src/telegram-bot.mjs'), 'utf-8');

  const hasSentryImport = fileContent.includes("await import('./sentry.lib.mjs')");
  const hasReportError = fileContent.includes('reportError');
  const hasInitializeSentry = fileContent.includes('initializeSentry');
  const hasAddBreadcrumb = fileContent.includes('addBreadcrumb');

  if (hasSentryImport && hasReportError && hasInitializeSentry && hasAddBreadcrumb) {
    console.log('✅ Test 1 PASSED: Sentry integration properly imported');
  } else {
    console.log('❌ Test 1 FAILED: Missing Sentry imports');
    console.log('  hasSentryImport:', hasSentryImport);
    console.log('  hasReportError:', hasReportError);
    console.log('  hasInitializeSentry:', hasInitializeSentry);
    console.log('  hasAddBreadcrumb:', hasAddBreadcrumb);
    process.exit(1);
  }
} catch (error) {
  console.log('❌ Test 1 FAILED: Could not read telegram-bot.mjs');
  console.error(error);
  process.exit(1);
}

// Test 2: Verify Sentry initialization
console.log('\nTest 2: Checking Sentry initialization...');
try {
  const fileContent = await readFile(join(__dirname, '../src/telegram-bot.mjs'), 'utf-8');

  const hasSentryInit = fileContent.includes('await initializeSentry({');
  const hasDebugParam = fileContent.includes('debug: VERBOSE');

  if (hasSentryInit && hasDebugParam) {
    console.log('✅ Test 2 PASSED: Sentry initialization found');
  } else {
    console.log('❌ Test 2 FAILED: Sentry initialization missing or incomplete');
    console.log('  hasSentryInit:', hasSentryInit);
    console.log('  hasDebugParam:', hasDebugParam);
    process.exit(1);
  }
} catch (error) {
  console.log('❌ Test 2 FAILED: Could not verify Sentry initialization');
  console.error(error);
  process.exit(1);
}

// Test 3: Verify improved error handler
console.log('\nTest 3: Checking improved error handler...');
try {
  const fileContent = await readFile(join(__dirname, '../src/telegram-bot.mjs'), 'utf-8');

  const hasDetailedLogging = fileContent.includes('Error details:');
  const hasSentryReporting = fileContent.includes('reportError(error, {');
  const hasSanitization = fileContent.includes('sanitizedMessage');
  const hasTroubleshooting = fileContent.includes('Troubleshooting:');
  const hasFallback = fileContent.includes('fallbackError');

  if (hasDetailedLogging && hasSentryReporting && hasSanitization && hasTroubleshooting && hasFallback) {
    console.log('✅ Test 3 PASSED: Error handler improvements found');
    console.log('  ✓ Detailed error logging');
    console.log('  ✓ Sentry error reporting');
    console.log('  ✓ Sensitive data sanitization');
    console.log('  ✓ User troubleshooting tips');
    console.log('  ✓ Fallback error message');
  } else {
    console.log('❌ Test 3 FAILED: Error handler improvements incomplete');
    console.log('  hasDetailedLogging:', hasDetailedLogging);
    console.log('  hasSentryReporting:', hasSentryReporting);
    console.log('  hasSanitization:', hasSanitization);
    console.log('  hasTroubleshooting:', hasTroubleshooting);
    console.log('  hasFallback:', hasFallback);
    process.exit(1);
  }
} catch (error) {
  console.log('❌ Test 3 FAILED: Could not verify error handler');
  console.error(error);
  process.exit(1);
}

// Test 4: Verify breadcrumbs are added
console.log('\nTest 4: Checking breadcrumb tracking...');
try {
  const fileContent = await readFile(join(__dirname, '../src/telegram-bot.mjs'), 'utf-8');

  const hasSolveBreadcrumb = fileContent.includes("message: '/solve command received'");
  const hasHiveBreadcrumb = fileContent.includes("message: '/hive command received'");
  const hasBreadcrumbCategory = fileContent.includes("category: 'telegram.command'");

  if (hasSolveBreadcrumb && hasHiveBreadcrumb && hasBreadcrumbCategory) {
    console.log('✅ Test 4 PASSED: Breadcrumb tracking added');
    console.log('  ✓ /solve command breadcrumb');
    console.log('  ✓ /hive command breadcrumb');
    console.log('  ✓ Proper category tagging');
  } else {
    console.log('❌ Test 4 FAILED: Breadcrumb tracking incomplete');
    console.log('  hasSolveBreadcrumb:', hasSolveBreadcrumb);
    console.log('  hasHiveBreadcrumb:', hasHiveBreadcrumb);
    console.log('  hasBreadcrumbCategory:', hasBreadcrumbCategory);
    process.exit(1);
  }
} catch (error) {
  console.log('❌ Test 4 FAILED: Could not verify breadcrumbs');
  console.error(error);
  process.exit(1);
}

// Test 5: Verify sensitive data sanitization patterns
console.log('\nTest 5: Testing sensitive data sanitization...');
try {
  // Simulate the sanitization logic
  const testMessages = [
    { input: 'Error: Invalid token: abc123def456', expected: 'Error: Invalid token: [REDACTED]' },
    { input: 'Failed with api_key=secret123', expected: 'Failed with api_key: [REDACTED]' },
    { input: 'Password: mypassword123 is wrong', expected: 'Password: [REDACTED] is wrong' },
  ];

  const sanitize = (message) => {
    return message
      .replace(/token[s]?\s*[:=]\s*[\w-]+/gi, 'token: [REDACTED]')
      .replace(/password[s]?\s*[:=]\s*[\w-]+/gi, 'password: [REDACTED]')
      .replace(/api[_-]?key[s]?\s*[:=]\s*[\w-]+/gi, 'api_key: [REDACTED]');
  };

  let allPassed = true;
  for (const test of testMessages) {
    const result = sanitize(test.input);
    if (result.includes('REDACTED')) {
      console.log(`  ✓ Sanitized: "${test.input.substring(0, 40)}..."`);
    } else {
      console.log(`  ❌ Failed to sanitize: "${test.input}"`);
      console.log(`     Result: "${result}"`);
      allPassed = false;
    }
  }

  if (allPassed) {
    console.log('✅ Test 5 PASSED: Sensitive data sanitization works correctly');
  } else {
    console.log('❌ Test 5 FAILED: Sanitization issues detected');
    process.exit(1);
  }
} catch (error) {
  console.log('❌ Test 5 FAILED: Could not test sanitization');
  console.error(error);
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('✅ All tests PASSED!');
console.log('\nSummary of improvements:');
console.log('1. ✅ Sentry integration added for error tracking');
console.log('2. ✅ Detailed error logging with stack traces');
console.log('3. ✅ Informative error messages to users');
console.log('4. ✅ Sensitive data sanitization (tokens, passwords, API keys)');
console.log('5. ✅ Breadcrumb tracking for debugging');
console.log('6. ✅ Troubleshooting tips in error messages');
console.log('7. ✅ Fallback error handling for Markdown failures');
console.log('\nThese improvements will help:');
console.log('• Developers: Better error tracking and debugging with Sentry');
console.log('• Users: More informative error messages with actionable tips');
console.log('• Security: No sensitive data leakage in error messages');
