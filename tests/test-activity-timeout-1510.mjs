#!/usr/bin/env node

/**
 * Tests for issue #1510: Activity timeout too short, lastEventTime bug, and graceful kill improvements
 *
 * Verifies that:
 * 1. Activity timeout increased from 300s (5 min) to 3600s (1 hour)
 * 2. lastEventTime is set outside interactiveHandler block (fixes 'unknowns' bug)
 * 3. Idle seconds display correctly handles unknown case (no 'unknowns' concatenation)
 * 4. Graceful kill sends SIGTERM first with 5s window before SIGKILL
 * 5. Stream processing continues after SIGTERM to capture final output
 * 6. PR comment posted on force-kill and auto-resume
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  \u2705 PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  \u274c FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 1: Activity timeout configuration
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 1: Activity timeout configuration (Issue #1510)');
console.log('\u2500'.repeat(60));

{
  const configLib = await import(join(__dirname, '..', 'src', 'config.lib.mjs'));

  // Test: streamActivityMs exists and is a number
  assert(typeof configLib.timeouts.streamActivityMs === 'number', 'timeouts.streamActivityMs is a number', `Got: ${typeof configLib.timeouts.streamActivityMs}`);

  // Test: Default value increased to 3600000ms (1 hour) from 300000ms (5 minutes)
  assert(configLib.timeouts.streamActivityMs === 3600000, 'Default streamActivityMs is 3600000ms (1 hour)', `Got: ${configLib.timeouts.streamActivityMs}ms (${configLib.timeouts.streamActivityMs / 1000}s)`);

  // Test: Timeout is at least 1 hour (issue requirement)
  assert(configLib.timeouts.streamActivityMs >= 3600000, 'Activity timeout is at least 1 hour', `Got: ${configLib.timeouts.streamActivityMs / 1000}s`);

  // Test: streamStartupMs still unchanged
  assert(configLib.timeouts.streamStartupMs === 120000, 'streamStartupMs unchanged at 120000ms', `Got: ${configLib.timeouts.streamStartupMs}`);

  // Test: resultStreamCloseMs still unchanged
  assert(configLib.timeouts.resultStreamCloseMs === 30000, 'resultStreamCloseMs unchanged at 30000ms', `Got: ${configLib.timeouts.resultStreamCloseMs}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: lastEventTime fix (moved outside interactiveHandler)
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 2: lastEventTime tracking fix (Issue #1510)');
console.log('\u2500'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: lastEventTime is set before/outside the interactiveHandler block
  // The fix moves lastEventTime = Date.now() to before the if (interactiveHandler) check
  const dataParseSection = claudeLibContent.substring(claudeLibContent.indexOf('const data = sanitizeObjectStrings(JSON.parse(line))'), claudeLibContent.indexOf('if (interactiveHandler) {', claudeLibContent.indexOf('const data = sanitizeObjectStrings(JSON.parse(line))')));
  assert(dataParseSection.includes('lastEventTime = Date.now()'), 'lastEventTime is set BEFORE interactiveHandler check (fixes unknowns bug)', 'lastEventTime should be set outside the interactiveHandler block');

  // Test: lastEventTime is NOT inside the interactiveHandler block anymore
  const interactiveBlock = claudeLibContent.substring(claudeLibContent.indexOf('if (interactiveHandler) {', claudeLibContent.indexOf('const data = sanitizeObjectStrings(JSON.parse(line))')), claudeLibContent.indexOf('await log(JSON.stringify(data, null, 2))'));
  assert(!interactiveBlock.includes('lastEventTime = Date.now()'), 'lastEventTime is NOT inside interactiveHandler block', 'Found lastEventTime assignment still inside interactiveHandler');

  // Test: Issue #1510 comment present
  assert(claudeLibContent.includes('Issue #1510'), 'claude.lib.mjs references Issue #1510 in comments');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: Idle seconds display fix ('unknowns' → 'unknown')
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 3: Idle seconds display fix (Issue #1510)');
console.log('\u2500'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: The idle seconds formatting avoids 'unknowns' concatenation
  // Old code: `idle: ${idleSeconds}s` where idleSeconds='unknown' → 'idle: unknowns'
  // New code: `idle: ${idleSeconds}` where idleSeconds='unknown' or '300s' → 'idle: unknown' or 'idle: 300s'
  const idlePattern = /idle: \$\{idleSeconds\}\)/;
  assert(idlePattern.test(claudeLibContent), 'Idle seconds uses format without extra "s" suffix (prevents "unknowns")', 'Expected: idle: ${idleSeconds}) without trailing s');

  // Test: The seconds suffix is now part of the variable value, not appended
  const idleSecondsFormat = /idleSeconds = lastEventTime \? `\$\{.*\}s` : 'unknown'/;
  assert(idleSecondsFormat.test(claudeLibContent), 'idleSeconds includes "s" suffix in numeric value and plain "unknown" for fallback');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 4: Graceful kill improvements (SIGTERM → SIGKILL)
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 4: Graceful kill improvements (Issue #1510)');
console.log('\u2500'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: SIGTERM is sent first (graceful shutdown)
  assert(claudeLibContent.includes("execCommand.kill('SIGTERM')"), 'SIGTERM is sent first for graceful shutdown');

  // Test: SIGKILL follows after delay
  assert(claudeLibContent.includes("execCommand.kill('SIGKILL')"), 'SIGKILL is sent as fallback after delay');

  // Test: SIGKILL delay increased to 5s (from 2s) for better final output capture
  assert(claudeLibContent.includes('5000'), 'SIGKILL delay is 5000ms (5s) for better output capture');

  // Test: Stream processing continues after SIGTERM (no immediate break)
  // The old `if (forceExitTriggered) break;` is replaced with a comment about continuing
  assert(!claudeLibContent.includes('if (forceExitTriggered) break'), 'Stream does NOT break immediately on forceExitTriggered (allows final output capture)');

  // Test: Comment about continuing stream after SIGTERM
  assert(claudeLibContent.includes('Continue processing stream after SIGTERM'), 'Comment documents stream continuation after SIGTERM');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 5: PR comment on force-kill and auto-resume
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 5: PR comment on force-kill (Issue #1510)');
console.log('\u2500'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: PR comment is posted on activity timeout
  assert(claudeLibContent.includes('Session Force-Killed'), 'Force-kill PR comment contains "Session Force-Killed" header');

  // Test: Comment includes timeout type (activity/startup)
  assert(claudeLibContent.includes('activity timeout'), 'Force-kill comment mentions activity timeout type');
  assert(claudeLibContent.includes('startup timeout'), 'Force-kill comment mentions startup timeout type');

  // Test: Comment includes auto-resume information
  assert(claudeLibContent.includes('Auto-resuming'), 'Force-kill comment mentions auto-resuming');

  // Test: Comment includes session ID for traceability
  assert(claudeLibContent.includes('Session ID:'), 'Force-kill comment includes session ID');

  // Test: Error handling for comment posting
  assert(claudeLibContent.includes('Could not post force-kill comment'), 'Error handling exists for failed comment posting');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 6: config.lib.mjs has Issue #1510 reference
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 6: Config documentation (Issue #1510)');
console.log('\u2500'.repeat(60));

{
  const configContent = await readFile(join(__dirname, '..', 'src', 'config.lib.mjs'), 'utf-8');

  // Test: Issue #1510 reference in config
  assert(configContent.includes('Issue #1510'), 'config.lib.mjs references Issue #1510');

  // Test: Documentation mentions the reason for increase
  assert(configContent.includes('docker builds') || configContent.includes('CI polls') || configContent.includes('long-running'), 'config.lib.mjs documents reason for timeout increase');

  // Test: Documentation mentions previous value
  assert(configContent.includes('300000ms') || configContent.includes('5 min'), 'config.lib.mjs documents previous timeout value');
}

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '\u2550'.repeat(60));
console.log(`\ud83d\udcca Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('\u2550'.repeat(60));

if (failed > 0) {
  console.error(`\n\u274c ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('\n\u2705 All tests passed!');
}
