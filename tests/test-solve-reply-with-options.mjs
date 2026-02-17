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

// Import the parseGitHubUrl function
const { parseGitHubUrl } = await import('../src/github.lib.mjs');
const { cleanNonPrintableChars } = await import('../src/telegram-markdown.lib.mjs');

/**
 * Parse command arguments from message text (copied from telegram-bot.mjs for testing)
 */
function parseCommandArgs(text) {
  // Use only first line and trim it
  const firstLine = text.split('\n')[0].trim();
  const argsText = firstLine.replace(/^\/\w+\s*/, '');

  if (!argsText.trim()) {
    return [];
  }

  // Replace em-dash (—) with double-dash (--) to fix Telegram auto-replacement
  const normalizedArgsText = argsText.replace(/—/g, '--');

  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < normalizedArgsText.length; i++) {
    const char = normalizedArgsText[i];

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuotes) {
      inQuotes = false;
      quoteChar = null;
    } else if (char === ' ' && !inQuotes) {
      if (currentArg) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg) {
    args.push(currentArg);
  }

  return args;
}

/**
 * Extract GitHub issue/PR URL from message text
 * (Copied from telegram-bot.mjs for testing)
 */
function extractGitHubUrl(text) {
  if (!text || typeof text !== 'string') {
    return { url: null, error: null, linkCount: 0 };
  }

  text = cleanNonPrintableChars(text); // Clean non-printable chars before processing
  const words = text.split(/\s+/);
  const foundUrls = [];

  for (const word of words) {
    // Try to parse as GitHub URL
    const parsed = parseGitHubUrl(word);

    // Accept issue or PR URLs
    if (parsed.valid && (parsed.type === 'issue' || parsed.type === 'pull')) {
      foundUrls.push(parsed.normalized);
    }
  }

  // Check if multiple links were found
  if (foundUrls.length === 0) {
    return { url: null, error: null, linkCount: 0 };
  } else if (foundUrls.length === 1) {
    return { url: foundUrls[0], error: null, linkCount: 1 };
  } else {
    return {
      url: null,
      error: `Found ${foundUrls.length} GitHub links in the message. Please reply to a message with only one GitHub issue or PR link.`,
      linkCount: foundUrls.length,
    };
  }
}

/**
 * Simulate the logic from handleSolveCommand for URL extraction
 * This tests the issue #1325 fix
 */
function simulateSolveReplyLogic(commandText, replyText) {
  const userArgs = parseCommandArgs(commandText);

  // Check if the first argument looks like a GitHub URL
  // If not, we should try to extract the URL from the replied message
  const firstArgIsUrl = userArgs.length > 0 && (userArgs[0].includes('github.com') || userArgs[0].match(/^https?:\/\//));

  // Simulate isReply = true (we always have a reply in this test)
  const isReply = true;

  if (isReply && !firstArgIsUrl) {
    // Try to extract URL from replied message
    const extraction = extractGitHubUrl(replyText);

    if (extraction.error) {
      return { success: false, error: extraction.error };
    } else if (extraction.url) {
      // Prepend the extracted URL to user's options
      const finalArgs = [extraction.url, ...userArgs];
      return { success: true, args: finalArgs, extractedFromReply: true };
    } else {
      return { success: false, error: 'No GitHub issue/PR link found in the replied message.' };
    }
  } else {
    // URL was provided in the command itself
    return { success: true, args: userArgs, extractedFromReply: false };
  }
}

console.log('='.repeat(80));
console.log('Unit Tests: /solve Reply with Options (Issue #1325)');
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

// ===========================================================================
// Tests for parseCommandArgs
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
  const args = parseCommandArgs('/solve');
  return args.length === 0;
});

// ===========================================================================
// Tests for issue #1325 - Reply with options (NO URL in command)
// ===========================================================================
console.log('\n--- Issue #1325: Reply with Options (URL extracted from reply) ---\n');

runTest('Reply with just /solve extracts URL from replied message', () => {
  const result = simulateSolveReplyLogic('/solve', 'Check this issue: https://github.com/owner/repo/issues/123');
  return result.success === true && result.extractedFromReply === true && result.args.length === 1 && result.args[0] === 'https://github.com/owner/repo/issues/123';
});

runTest('Reply with /solve --model opus extracts URL and preserves options', () => {
  const result = simulateSolveReplyLogic('/solve --model opus', 'Check this issue: https://github.com/owner/repo/issues/123');
  return result.success === true && result.extractedFromReply === true && result.args.length === 3 && result.args[0] === 'https://github.com/owner/repo/issues/123' && result.args[1] === '--model' && result.args[2] === 'opus';
});

runTest('Reply with /solve —model opus (em-dash) extracts URL and preserves options', () => {
  const result = simulateSolveReplyLogic('/solve —model opus', 'Here: https://github.com/link-assistant/hive-mind/issues/1324');
  return result.success === true && result.extractedFromReply === true && result.args.length === 3 && result.args[0] === 'https://github.com/link-assistant/hive-mind/issues/1324' && result.args[1] === '--model' && result.args[2] === 'opus';
});

runTest('Reply with /solve --verbose --attach-logs extracts URL and preserves multiple options', () => {
  const result = simulateSolveReplyLogic('/solve --verbose --attach-logs', 'Issue: https://github.com/owner/repo/issues/456');
  return result.success === true && result.extractedFromReply === true && result.args.length === 3 && result.args[0] === 'https://github.com/owner/repo/issues/456' && result.args[1] === '--verbose' && result.args[2] === '--attach-logs';
});

runTest('Reply with /solve --model sonnet --think high extracts URL and preserves all options', () => {
  const result = simulateSolveReplyLogic('/solve --model sonnet --think high', 'PR: https://github.com/owner/repo/pull/789');
  return result.success === true && result.extractedFromReply === true && result.args.length === 5 && result.args[0] === 'https://github.com/owner/repo/pull/789' && result.args[1] === '--model' && result.args[2] === 'sonnet' && result.args[3] === '--think' && result.args[4] === 'high';
});

// ===========================================================================
// Tests for URL in command (NO extraction from reply needed)
// ===========================================================================
console.log('\n--- URL provided in command (no extraction needed) ---\n');

runTest('Reply with /solve <URL> does NOT extract from reply', () => {
  const result = simulateSolveReplyLogic('/solve https://github.com/owner/repo/issues/111', 'Different issue: https://github.com/owner/repo/issues/999');
  return result.success === true && result.extractedFromReply === false && result.args.length === 1 && result.args[0] === 'https://github.com/owner/repo/issues/111';
});

runTest('Reply with /solve <URL> --model opus does NOT extract from reply', () => {
  const result = simulateSolveReplyLogic('/solve https://github.com/owner/repo/issues/111 --model opus', 'Different issue: https://github.com/owner/repo/issues/999');
  return result.success === true && result.extractedFromReply === false && result.args.length === 3 && result.args[0] === 'https://github.com/owner/repo/issues/111';
});

// ===========================================================================
// Tests for error cases
// ===========================================================================
console.log('\n--- Error cases ---\n');

runTest('Reply with /solve --model opus to message with no URL returns error', () => {
  const result = simulateSolveReplyLogic('/solve --model opus', 'This message has no GitHub link');
  return result.success === false && result.error.includes('No GitHub issue/PR link found');
});

runTest('Reply with /solve to message with multiple URLs returns error', () => {
  const result = simulateSolveReplyLogic('/solve', 'Issue 1: https://github.com/owner/repo/issues/1 Issue 2: https://github.com/owner/repo/issues/2');
  return result.success === false && result.error.includes('Found 2 GitHub links');
});

runTest('Reply with /solve --model opus to message with multiple URLs returns error', () => {
  const result = simulateSolveReplyLogic('/solve --model opus', 'Issue 1: https://github.com/owner/repo/issues/1 Issue 2: https://github.com/owner/repo/issues/2');
  return result.success === false && result.error.includes('Found 2 GitHub links');
});

// ===========================================================================
// Tests for the exact scenario from issue #1325
// ===========================================================================
console.log('\n--- Exact scenario from Issue #1325 ---\n');

runTest('Original bug scenario: /solve —model opus as reply to message with issue link', () => {
  // This is the exact scenario from the issue:
  // - User posts: "Завёл тут: https://github.com/link-assistant/hive-mind/issues/1324"
  // - User replies with: "/solve —model opus"
  const result = simulateSolveReplyLogic('/solve —model opus', 'Завёл тут: https://github.com/link-assistant/hive-mind/issues/1324');
  return result.success === true && result.extractedFromReply === true && result.args.length === 3 && result.args[0] === 'https://github.com/link-assistant/hive-mind/issues/1324' && result.args[1] === '--model' && result.args[2] === 'opus';
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
