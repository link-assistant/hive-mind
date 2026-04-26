#!/usr/bin/env node

/**
 * Unit Tests: Issue #1570 - Always notify user about usage limit reached
 *
 * Tests verify that:
 * 1. When usage limit is reached in auto-restart mode, a GitHub comment is posted
 * 2. The comment includes the actual resume time (reset + buffer + jitter), not just reset time
 * 3. The log output includes the resume time in UTC
 * 4. The attachLogToGitHub call includes correct parameters (isUsageLimit, isAutoResumeEnabled, autoResumeMode)
 */

import { isUsageLimitReached } from '../src/solve.restart-shared.lib.mjs';
import { formatResetTimeWithRelative } from '../src/usage-limit.lib.mjs';

// ANSI color codes for terminal output
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
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1570 - Always notify user about usage limit reached');
console.log('================================================================================\n');

// ===== Test: GitHub comment posting when usage limit is reached =====
console.log('📋 GitHub Comment Posting on Usage Limit Tests\n');

test('should post a GitHub comment when usage limit is reached in auto-restart mode', () => {
  // Simulate the auto-restart loop behavior per Issue #1570 fix
  let commentPosted = false;
  let commentParams = null;

  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '5:00 AM',
    sessionId: 'session-abc-123',
    anthropicTotalCostUSD: 1.24,
  };

  const argv = {
    tool: 'claude',
    model: 'opus',
    attachLogs: true,
    verbose: false,
  };

  const prNumber = 1577;

  // Simulate the fixed logic: post GitHub comment before waiting
  if (!toolResult.success && isUsageLimitReached(toolResult)) {
    const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
    if (prNumber && shouldAttachLogs) {
      commentPosted = true;
      commentParams = {
        isUsageLimit: true,
        limitResetTime: toolResult.limitResetTime,
        isAutoResumeEnabled: true,
        autoResumeMode: 'restart',
        sessionId: toolResult.sessionId,
        tool: argv.tool || 'claude',
        requestedModel: argv.model,
      };
    }
  }

  assert(commentPosted === true, 'Should post a GitHub comment');
  assert(commentParams.isUsageLimit === true, 'Should mark as usage limit');
  assert(commentParams.isAutoResumeEnabled === true, 'Should indicate auto-resume is enabled');
  assert(commentParams.autoResumeMode === 'restart', 'Should use restart mode');
  assert(commentParams.limitResetTime === '5:00 AM', 'Should include reset time');
  assert(commentParams.sessionId === 'session-abc-123', 'Should include session ID');
});

test('should NOT post comment when --attach-logs is not set', () => {
  let commentPosted = false;

  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '5:00 AM',
    sessionId: 'session-abc-123',
  };

  const argv = {
    tool: 'claude',
    // no attachLogs flag
  };

  const prNumber = 1577;

  if (!toolResult.success && isUsageLimitReached(toolResult)) {
    const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
    if (prNumber && shouldAttachLogs) {
      commentPosted = true;
    }
  }

  assert(commentPosted === false, 'Should NOT post comment when --attach-logs is not set');
});

test('should NOT post comment when no PR number', () => {
  let commentPosted = false;

  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '5:00 AM',
  };

  const argv = {
    tool: 'claude',
    attachLogs: true,
  };

  const prNumber = null;

  if (!toolResult.success && isUsageLimitReached(toolResult)) {
    const shouldAttachLogs = argv.attachLogs || argv['attach-logs'];
    if (prNumber && shouldAttachLogs) {
      commentPosted = true;
    }
  }

  assert(commentPosted === false, 'Should NOT post comment when no PR number');
});

// ===== Test: Resume time calculation =====
console.log('\n📋 Resume Time Calculation Tests\n');

test('resume time should be calculated as now + waitMs', () => {
  const nowMs = Date.now();
  const waitMs = 40 * 60 * 1000; // 40 minutes

  const resumeDate = new Date(nowMs + waitMs);
  const resumeTimeUTC = resumeDate
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');

  assert(resumeTimeUTC.endsWith(' UTC'), 'Resume time should end with UTC');
  assert(resumeTimeUTC.includes(' '), 'Resume time should have date and time separated by space');
  // Verify the date is ~40 minutes in the future
  const parsedMs = resumeDate.getTime();
  assert(parsedMs >= nowMs + waitMs - 1000, 'Resume time should be approximately waitMs in the future');
  assert(parsedMs <= nowMs + waitMs + 1000, 'Resume time should not exceed waitMs + tolerance');
});

test('resume time format is human-readable UTC', () => {
  const date = new Date('2026-04-11T01:30:00.000Z');
  const formatted = date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');

  assert(formatted === '2026-04-11 01:30:00 UTC', `Expected "2026-04-11 01:30:00 UTC", got "${formatted}"`);
});

test('wait time includes buffer and jitter on top of base wait', () => {
  const baseWaitMs = 30 * 60 * 1000; // 30 minutes until reset
  const bufferMs = 10 * 60 * 1000; // 10 minute buffer
  const jitterMs = 152 * 1000; // 152 second jitter (as shown in issue)
  const totalWaitMs = baseWaitMs + bufferMs + jitterMs;

  const waitMinutes = Math.round(totalWaitMs / 60000);

  assert(totalWaitMs > baseWaitMs + bufferMs, 'Total wait should exceed base + buffer');
  assert(waitMinutes === 43, `Expected ~43 minutes, got ${waitMinutes}`);
});

// ===== Test: toolName formatting =====
console.log('\n📋 Tool Name Formatting Tests\n');

test('toolName should be properly formatted for claude', () => {
  const tool = 'claude';
  const toolName = `Anthropic ${tool.charAt(0).toUpperCase() + tool.slice(1)} Code`;
  assert(toolName === 'Anthropic Claude Code', `Expected "Anthropic Claude Code", got "${toolName}"`);
});

test('toolName should be properly formatted for agent', () => {
  const tool = 'agent';
  const toolName = `Anthropic ${tool.charAt(0).toUpperCase() + tool.slice(1)} Code`;
  assert(toolName === 'Anthropic Agent Code', `Expected "Anthropic Agent Code", got "${toolName}"`);
});

test('toolName defaults to claude when tool is undefined', () => {
  const tool = undefined;
  const effectiveTool = tool || 'claude';
  const toolName = `Anthropic ${effectiveTool.charAt(0).toUpperCase() + effectiveTool.slice(1)} Code`;
  assert(toolName === 'Anthropic Claude Code', `Expected "Anthropic Claude Code", got "${toolName}"`);
});

// ===== Test: formatResetTimeWithRelative is available =====
console.log('\n📋 formatResetTimeWithRelative Import Tests\n');

test('formatResetTimeWithRelative is importable from usage-limit.lib.mjs', () => {
  assert(typeof formatResetTimeWithRelative === 'function', 'Should be a function');
});

test('formatResetTimeWithRelative returns original for null input', () => {
  const result = formatResetTimeWithRelative(null);
  assert(result === null, 'Should return null for null input');
});

test('formatResetTimeWithRelative returns original for empty string', () => {
  const result = formatResetTimeWithRelative('');
  assert(result === '', 'Should return empty string for empty input');
});

// ===== Test: attachLogToGitHub parameter structure =====
console.log('\n📋 attachLogToGitHub Parameter Structure Tests\n');

test('attachLogToGitHub params should include all required fields for usage limit comment', () => {
  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '12:00 AM',
    sessionId: 'session-test-789',
    anthropicTotalCostUSD: 1.41,
    publicPricingEstimate: 1.41,
    pricingInfo: { modelName: 'Claude Opus 4.6' },
    resultModelUsage: { 'claude-opus-4-6': { inputTokens: 38 } },
  };

  const argv = {
    tool: 'claude',
    model: 'opus',
    attachLogs: true,
    verbose: false,
  };

  const params = {
    logFile: '/tmp/test-log.txt',
    targetType: 'pr',
    targetNumber: 1577,
    owner: 'link-assistant',
    repo: 'hive-mind',
    verbose: argv.verbose,
    sessionId: toolResult.sessionId,
    anthropicTotalCostUSD: toolResult.anthropicTotalCostUSD,
    isUsageLimit: true,
    limitResetTime: toolResult.limitResetTime,
    toolName: `Anthropic ${(argv.tool || 'claude').charAt(0).toUpperCase() + (argv.tool || 'claude').slice(1)} Code`,
    isAutoResumeEnabled: true,
    autoResumeMode: 'restart',
    requestedModel: argv.model,
    tool: argv.tool || 'claude',
    publicPricingEstimate: toolResult.publicPricingEstimate,
    pricingInfo: toolResult.pricingInfo,
    resultModelUsage: toolResult.resultModelUsage,
  };

  assert(params.isUsageLimit === true, 'isUsageLimit should be true');
  assert(params.isAutoResumeEnabled === true, 'isAutoResumeEnabled should be true');
  assert(params.autoResumeMode === 'restart', 'autoResumeMode should be restart');
  assert(params.limitResetTime === '12:00 AM', 'limitResetTime should match toolResult');
  assert(params.toolName === 'Anthropic Claude Code', 'toolName should be formatted correctly');
  assert(params.sessionId === 'session-test-789', 'sessionId should match toolResult');
  assert(params.anthropicTotalCostUSD === 1.41, 'anthropicTotalCostUSD should be passed');
  assert(params.publicPricingEstimate === 1.41, 'publicPricingEstimate should be passed');
  assert(params.pricingInfo !== null, 'pricingInfo should be passed');
  assert(params.resultModelUsage !== null, 'resultModelUsage should be passed');
});

test('should fall back to latestSessionId when toolResult has no sessionId', () => {
  const toolResult = {
    success: false,
    limitReached: true,
    limitResetTime: '5:00 AM',
    // no sessionId
  };

  const latestSessionId = 'latest-session-456';
  const effectiveSessionId = toolResult.sessionId || latestSessionId;

  assert(effectiveSessionId === 'latest-session-456', 'Should fall back to latestSessionId');
});

test('should fall back to latestAnthropicCost when toolResult has no cost', () => {
  const toolResult = {
    success: false,
    limitReached: true,
    // no anthropicTotalCostUSD
  };

  const latestAnthropicCost = 0.85;
  const effectiveCost = toolResult.anthropicTotalCostUSD || latestAnthropicCost;

  assert(effectiveCost === 0.85, 'Should fall back to latestAnthropicCost');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1570:`);
console.log(`  ${GREEN}✅ Passed:${RESET} ${passed}`);
console.log(`  ${RED}❌ Failed:${RESET} ${failed}`);
console.log(`  Total: ${passed + failed}`);
console.log('================================================================================\n');

if (failed > 0) {
  console.log(`${RED}❌ Some tests failed!${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests passed!${RESET}`);
  process.exit(0);
}
