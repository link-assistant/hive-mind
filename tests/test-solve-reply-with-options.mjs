#!/usr/bin/env node

/**
 * Unit tests for /solve command reply feature with options (issue #1325)
 *
 * Tests the URL extraction logic when user replies to a message containing
 * a GitHub link AND provides additional options (e.g., "/solve --model opus")
 *
 * Run with: node tests/test-solve-reply-with-options.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1325
 */

const { parseGitHubUrl } = await import('../src/github.lib.mjs');
const { cleanNonPrintableChars } = await import('../src/telegram-markdown.lib.mjs');
const { extractGitHubUrl: _extractGitHubUrl } = await import('../src/telegram-message-filters.lib.mjs');

/** Bind extractGitHubUrl with its required dependencies */
const extractGitHubUrl = text => _extractGitHubUrl(text, { parseGitHubUrl, cleanNonPrintableChars });

/**
 * Minimal argument parser matching telegram-bot.mjs parseCommandArgs logic.
 * Handles em-dash → double-dash normalization and quoted strings.
 */
function parseCommandArgs(text) {
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+\s*/, '');
  if (!argsText.trim()) return [];
  const normalized = argsText.replace(/—/g, '--');
  const args = [];
  let cur = '';
  let inQ = false;
  let qc = null;
  for (const ch of normalized) {
    if (!inQ && (ch === '"' || ch === "'")) {
      inQ = true;
      qc = ch;
    } else if (inQ && ch === qc) {
      inQ = false;
      qc = null;
    } else if (!inQ && ch === ' ') {
      if (cur) {
        args.push(cur);
        cur = '';
      }
    } else {
      cur += ch;
    }
  }
  if (cur) args.push(cur);
  return args;
}

/**
 * Simulate the /solve reply logic from handleSolveCommand (issue #1325 fix).
 * Returns { success, args, extractedFromReply } or { success: false, error }.
 */
function simulateSolveReplyLogic(commandText, replyText) {
  const userArgs = parseCommandArgs(commandText);
  const firstArgIsUrl = userArgs.length > 0 && (userArgs[0].includes('github.com') || userArgs[0].match(/^https?:\/\//));
  const isReply = true;

  if (isReply && !firstArgIsUrl) {
    const extraction = extractGitHubUrl(replyText);
    if (extraction.error) return { success: false, error: extraction.error };
    if (extraction.url) return { success: true, args: [extraction.url, ...userArgs], extractedFromReply: true };
    return { success: false, error: 'No GitHub issue/PR link found in the replied message.' };
  }
  return { success: true, args: userArgs, extractedFromReply: false };
}

console.log('='.repeat(80));
console.log('Unit Tests: /solve Reply with Options (Issue #1325)');
console.log('='.repeat(80));

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    if (fn() === true) {
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } else {
      console.log(`  ❌ FAIL: ${name}`);
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// ===========================================================================
// parseCommandArgs tests
// ===========================================================================
console.log('\n--- parseCommandArgs() Tests ---\n');

runTest('Parses /solve with URL', () => {
  const args = parseCommandArgs('/solve https://github.com/owner/repo/issues/123');
  return args.length === 1 && args[0] === 'https://github.com/owner/repo/issues/123';
});

runTest('Parses /solve with em-dash --model opus (Telegram auto-replacement)', () => {
  const args = parseCommandArgs('/solve —model opus');
  return args.length === 2 && args[0] === '--model' && args[1] === 'opus';
});

runTest('Parses /solve with double-dash --model opus', () => {
  const args = parseCommandArgs('/solve --model opus');
  return args.length === 2 && args[0] === '--model' && args[1] === 'opus';
});

runTest('Parses /solve with URL and options', () => {
  const args = parseCommandArgs('/solve https://github.com/owner/repo/issues/123 --model opus');
  return args.length === 3 && args[0] === 'https://github.com/owner/repo/issues/123' && args[1] === '--model' && args[2] === 'opus';
});

runTest('Parses /solve with multiple options', () => {
  const args = parseCommandArgs('/solve --model opus --verbose');
  return args.length === 3 && args[0] === '--model' && args[1] === 'opus' && args[2] === '--verbose';
});

runTest('Parses /solve with no arguments', () => {
  return parseCommandArgs('/solve').length === 0;
});

// ===========================================================================
// Issue #1325 — Reply with options (URL extracted from reply)
// ===========================================================================
console.log('\n--- Issue #1325: Reply with Options (URL extracted from reply) ---\n');

runTest('Reply with just /solve extracts URL from replied message', () => {
  const r = simulateSolveReplyLogic('/solve', 'Check this issue: https://github.com/owner/repo/issues/123');
  return r.success && r.extractedFromReply && r.args.length === 1 && r.args[0] === 'https://github.com/owner/repo/issues/123';
});

runTest('Reply with /solve --model opus extracts URL and preserves options', () => {
  const r = simulateSolveReplyLogic('/solve --model opus', 'Check this issue: https://github.com/owner/repo/issues/123');
  return r.success && r.extractedFromReply && r.args.length === 3 && r.args[0] === 'https://github.com/owner/repo/issues/123' && r.args[1] === '--model' && r.args[2] === 'opus';
});

runTest('Reply with /solve —model opus (em-dash) extracts URL and preserves options', () => {
  const r = simulateSolveReplyLogic('/solve —model opus', 'Here: https://github.com/link-assistant/hive-mind/issues/1324');
  return r.success && r.extractedFromReply && r.args.length === 3 && r.args[0] === 'https://github.com/link-assistant/hive-mind/issues/1324' && r.args[1] === '--model' && r.args[2] === 'opus';
});

runTest('Reply with /solve --verbose --attach-logs extracts URL and preserves multiple options', () => {
  const r = simulateSolveReplyLogic('/solve --verbose --attach-logs', 'Issue: https://github.com/owner/repo/issues/456');
  return r.success && r.extractedFromReply && r.args.length === 3 && r.args[0] === 'https://github.com/owner/repo/issues/456' && r.args[1] === '--verbose' && r.args[2] === '--attach-logs';
});

runTest('Reply with /solve --model sonnet --think high extracts URL and preserves all options', () => {
  const r = simulateSolveReplyLogic('/solve --model sonnet --think high', 'PR: https://github.com/owner/repo/pull/789');
  return r.success && r.extractedFromReply && r.args.length === 5 && r.args[0] === 'https://github.com/owner/repo/pull/789' && r.args[1] === '--model' && r.args[2] === 'sonnet' && r.args[3] === '--think' && r.args[4] === 'high';
});

// ===========================================================================
// URL in command (no extraction from reply needed)
// ===========================================================================
console.log('\n--- URL provided in command (no extraction needed) ---\n');

runTest('Reply with /solve <URL> does NOT extract from reply', () => {
  const r = simulateSolveReplyLogic('/solve https://github.com/owner/repo/issues/111', 'Different issue: https://github.com/owner/repo/issues/999');
  return r.success && !r.extractedFromReply && r.args.length === 1 && r.args[0] === 'https://github.com/owner/repo/issues/111';
});

runTest('Reply with /solve <URL> --model opus does NOT extract from reply', () => {
  const r = simulateSolveReplyLogic('/solve https://github.com/owner/repo/issues/111 --model opus', 'Different issue: https://github.com/owner/repo/issues/999');
  return r.success && !r.extractedFromReply && r.args.length === 3 && r.args[0] === 'https://github.com/owner/repo/issues/111';
});

// ===========================================================================
// Error cases
// ===========================================================================
console.log('\n--- Error cases ---\n');

runTest('Reply with /solve --model opus to message with no URL returns error', () => {
  const r = simulateSolveReplyLogic('/solve --model opus', 'This message has no GitHub link');
  return !r.success && r.error.includes('No GitHub issue/PR link found');
});

runTest('Reply with /solve to message with multiple URLs returns error', () => {
  const r = simulateSolveReplyLogic('/solve', 'Issue 1: https://github.com/owner/repo/issues/1 Issue 2: https://github.com/owner/repo/issues/2');
  return !r.success && r.error.includes('Found 2 GitHub links');
});

runTest('Reply with /solve --model opus to message with multiple URLs returns error', () => {
  const r = simulateSolveReplyLogic('/solve --model opus', 'Issue 1: https://github.com/owner/repo/issues/1 Issue 2: https://github.com/owner/repo/issues/2');
  return !r.success && r.error.includes('Found 2 GitHub links');
});

// ===========================================================================
// Exact scenario from issue #1325
// ===========================================================================
console.log('\n--- Exact scenario from Issue #1325 ---\n');

runTest('Original bug scenario: /solve —model opus as reply to message with issue link', () => {
  const r = simulateSolveReplyLogic('/solve —model opus', 'Завёл тут: https://github.com/link-assistant/hive-mind/issues/1324');
  return r.success && r.extractedFromReply && r.args.length === 3 && r.args[0] === 'https://github.com/link-assistant/hive-mind/issues/1324' && r.args[1] === '--model' && r.args[2] === 'opus';
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
