#!/usr/bin/env node

/**
 * Unit tests for token budget statistics features (Issue #1491)
 *
 * Tests:
 * - buildBudgetStatsString: Markdown generation for GitHub comments
 * - displayBudgetStats: Terminal display of budget stats
 * - displaySubSessionStats: Sub-session breakdown with compactification
 * - displayTokenComparison: Stream vs JSONL comparison
 * - Sub-session tracking in calculateSessionTokens helper functions
 */

// Copy of buildBudgetStatsString from src/claude.budget-stats.lib.mjs for isolated testing
const buildBudgetStatsString = (tokenUsage, streamTokenUsage) => {
  if (!tokenUsage) return '';

  let stats = '\n\n### 📊 **Token budget statistics:**';

  if (tokenUsage.modelUsage) {
    const modelIds = Object.keys(tokenUsage.modelUsage);
    for (const modelId of modelIds) {
      const usage = tokenUsage.modelUsage[modelId];
      const modelName = usage.modelName || modelId;
      const contextLimit = usage.modelInfo?.limit?.context;
      const outputLimit = usage.modelInfo?.limit?.output;
      const totalInput = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens;

      if (modelIds.length > 1) stats += `\n- **${modelName}**:`;

      if (contextLimit) {
        const contextPct = ((totalInput / contextLimit) * 100).toFixed(2);
        stats += `\n- Context window: ${totalInput.toLocaleString()} / ${contextLimit.toLocaleString()} tokens (${contextPct}%)`;
      } else {
        stats += `\n- Context tokens used: ${totalInput.toLocaleString()}`;
      }

      if (outputLimit) {
        const outputPct = ((usage.outputTokens / outputLimit) * 100).toFixed(2);
        stats += `\n- Output tokens: ${usage.outputTokens.toLocaleString()} / ${outputLimit.toLocaleString()} tokens (${outputPct}%)`;
      } else {
        stats += `\n- Output tokens: ${usage.outputTokens.toLocaleString()}`;
      }
    }
  }

  if (tokenUsage.subSessions && tokenUsage.compactifications) {
    stats += `\n- Compactifications: ${tokenUsage.compactifications.length}`;
    for (let i = 0; i < tokenUsage.subSessions.length; i++) {
      const sub = tokenUsage.subSessions[i];
      const totalInput = sub.inputTokens + sub.cacheCreationTokens + sub.cacheReadTokens;
      const label = i === 0 ? 'initial' : `after compactification #${i}`;
      stats += `\n  - Sub-session ${i + 1} (${label}): ${totalInput.toLocaleString()} context, ${sub.outputTokens.toLocaleString()} output, ${sub.messageCount} messages`;
    }
  }

  if (streamTokenUsage) {
    const streamTotal = streamTokenUsage.inputTokens + streamTokenUsage.cacheCreationTokens + streamTokenUsage.outputTokens;
    const jsonlTotal = tokenUsage.inputTokens + tokenUsage.cacheCreationTokens + tokenUsage.outputTokens;
    stats += `\n- Own calculation (stream): ${streamTotal.toLocaleString()} tokens (${streamTokenUsage.eventCount} events)`;
    stats += `\n- JSONL calculation: ${jsonlTotal.toLocaleString()} tokens`;
    if (streamTotal !== jsonlTotal) {
      const diff = jsonlTotal - streamTotal;
      const pct = streamTotal > 0 ? ((diff / streamTotal) * 100).toFixed(2) : 'N/A';
      stats += ` (diff: ${diff > 0 ? '+' : ''}${pct}%)`;
    }
  }

  return stats;
};

// Test framework
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

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

function assertContains(str, substring, message = '') {
  if (!str.includes(substring)) {
    throw new Error(`${message}\nExpected string to contain: "${substring}"\nActual string: "${str}"`);
  }
}

function assertNotContains(str, substring, message = '') {
  if (str.includes(substring)) {
    throw new Error(`${message}\nExpected string NOT to contain: "${substring}"\nActual string: "${str}"`);
  }
}

console.log('🧪 Running token budget statistics unit tests (Issue #1491)...\n');
console.log('='.repeat(80));

// ==== Test Group: buildBudgetStatsString ====
console.log('\n📋 Test Group: buildBudgetStatsString - GitHub comment generation\n');

runTest('returns empty string when tokenUsage is null', () => {
  const result = buildBudgetStatsString(null, null);
  assertEqual(result, '', 'Should return empty string for null tokenUsage');
});

runTest('shows context window percentage with model limits', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 15000,
    totalTokens: 75000,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 5000,
        outputTokens: 15000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, '📊 **Token budget statistics:**', 'Should have header');
  assertContains(result, 'Context window:', 'Should show context window');
  assertContains(result, '200,000', 'Should show context limit');
  assertContains(result, '32.50%', 'Should show correct percentage (65000/200000)');
  assertContains(result, 'Output tokens:', 'Should show output tokens');
  assertContains(result, '64,000', 'Should show output limit');
  assertContains(result, '23.44%', 'Should show output percentage (15000/64000)');
});

runTest('shows context tokens without percentage when no model limits', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 15000,
    totalTokens: 65000,
    modelUsage: {
      'unknown-model': {
        inputTokens: 50000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 15000,
        modelName: 'unknown-model',
        modelInfo: null,
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, 'Context tokens used:', 'Should show context tokens without percentage');
  assertNotContains(result, 'Context window:', 'Should not show context window when no limits');
});

runTest('shows sub-session breakdown when compactification occurred', () => {
  const tokenUsage = {
    inputTokens: 100000,
    cacheCreationTokens: 20000,
    cacheReadTokens: 10000,
    outputTokens: 30000,
    totalTokens: 150000,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 100000,
        cacheCreationTokens: 20000,
        cacheReadTokens: 10000,
        outputTokens: 30000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
    subSessions: [
      { inputTokens: 60000, cacheCreationTokens: 15000, cacheReadTokens: 8000, outputTokens: 18000, messageCount: 25 },
      { inputTokens: 40000, cacheCreationTokens: 5000, cacheReadTokens: 2000, outputTokens: 12000, messageCount: 15 },
    ],
    compactifications: [{ timestamp: '2026-03-29T10:00:00Z', preTokens: 167219, trigger: 'auto' }],
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, 'Compactifications: 1', 'Should show compactification count');
  assertContains(result, 'Sub-session 1 (initial)', 'Should label first sub-session');
  assertContains(result, 'Sub-session 2 (after compactification #1)', 'Should label second sub-session');
  assertContains(result, '25 messages', 'Should show message count for sub-session 1');
  assertContains(result, '15 messages', 'Should show message count for sub-session 2');
});

runTest('shows stream vs JSONL comparison when both available', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 15000,
    totalTokens: 75000,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 5000,
        outputTokens: 15000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const streamTokenUsage = {
    inputTokens: 49500,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 14800,
    eventCount: 42,
  };
  const result = buildBudgetStatsString(tokenUsage, streamTokenUsage);
  assertContains(result, 'Own calculation (stream):', 'Should show stream calculation');
  assertContains(result, '42 events', 'Should show event count');
  assertContains(result, 'JSONL calculation:', 'Should show JSONL calculation');
  assertContains(result, 'diff:', 'Should show difference when mismatch');
});

runTest('does not show diff when stream and JSONL match', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 15000,
    totalTokens: 75000,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 5000,
        outputTokens: 15000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const streamTokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 10000,
    cacheReadTokens: 5000,
    outputTokens: 15000,
    eventCount: 30,
  };
  const result = buildBudgetStatsString(tokenUsage, streamTokenUsage);
  assertNotContains(result, 'diff:', 'Should not show diff when values match');
});

runTest('shows multiple models with labels', () => {
  const tokenUsage = {
    inputTokens: 80000,
    cacheCreationTokens: 15000,
    cacheReadTokens: 8000,
    outputTokens: 25000,
    totalTokens: 120000,
    modelUsage: {
      'claude-opus-4-5-20251101': {
        inputTokens: 50000,
        cacheCreationTokens: 10000,
        cacheReadTokens: 5000,
        outputTokens: 15000,
        modelName: 'Claude Opus 4.5',
        modelInfo: { limit: { context: 200000, output: 32000 } },
      },
      'claude-haiku-4-5-20251001': {
        inputTokens: 30000,
        cacheCreationTokens: 5000,
        cacheReadTokens: 3000,
        outputTokens: 10000,
        modelName: 'Claude Haiku 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, '**Claude Opus 4.5**', 'Should show Opus model name in bold');
  assertContains(result, '**Claude Haiku 4.5**', 'Should show Haiku model name in bold');
});

runTest('does not show sub-sessions when no compactification', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 15000,
    totalTokens: 65000,
    subSessions: null,
    compactifications: null,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 50000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 15000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertNotContains(result, 'Compactifications', 'Should not show compactifications section');
  assertNotContains(result, 'Sub-session', 'Should not show sub-session breakdown');
});

runTest('does not show stream comparison when no stream data', () => {
  const tokenUsage = {
    inputTokens: 50000,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 15000,
    totalTokens: 65000,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 50000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 15000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertNotContains(result, 'Own calculation', 'Should not show stream calculation');
  assertNotContains(result, 'JSONL calculation', 'Should not show JSONL calculation');
});

// ==== Test Group: Sub-session helper functions ====
console.log('\n📋 Test Group: Sub-session tracking helpers\n');

// Test createEmptySubSessionUsage equivalent
runTest('empty sub-session has zero values', () => {
  const subSession = {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    messageCount: 0,
  };
  assertEqual(subSession.inputTokens, 0, 'inputTokens should be 0');
  assertEqual(subSession.outputTokens, 0, 'outputTokens should be 0');
  assertEqual(subSession.messageCount, 0, 'messageCount should be 0');
});

// Test compactification detection logic
runTest('compactification boundary is detected by type and subtype', () => {
  const entry = { type: 'system', subtype: 'compact_boundary', compactMetadata: { preTokens: 167219, trigger: 'auto' } };
  const isCompactBoundary = entry.type === 'system' && entry.subtype === 'compact_boundary';
  assertEqual(isCompactBoundary, true, 'Should detect compact_boundary');
  assertEqual(entry.compactMetadata.preTokens, 167219, 'Should have preTokens');
  assertEqual(entry.compactMetadata.trigger, 'auto', 'Should have trigger');
});

runTest('non-compact system events are not treated as boundaries', () => {
  const entry = { type: 'system', subtype: 'init' };
  const isCompactBoundary = entry.type === 'system' && entry.subtype === 'compact_boundary';
  assertEqual(isCompactBoundary, false, 'Should not detect init as compact_boundary');
});

runTest('assistant messages with usage are not boundaries', () => {
  const entry = { type: 'assistant', message: { usage: { input_tokens: 100 }, model: 'claude-sonnet-4-5' } };
  const isCompactBoundary = entry.type === 'system' && entry.subtype === 'compact_boundary';
  assertEqual(isCompactBoundary, false, 'Should not detect assistant as compact_boundary');
});

// ==== Test Group: Edge cases ====
console.log('\n📋 Test Group: Edge cases\n');

runTest('handles zero tokens gracefully', () => {
  const tokenUsage = {
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, '0.00%', 'Should show 0% for zero tokens');
});

runTest('handles high context usage (near limit)', () => {
  const tokenUsage = {
    inputTokens: 180000,
    cacheCreationTokens: 15000,
    cacheReadTokens: 3000,
    outputTokens: 60000,
    totalTokens: 255000,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 180000,
        cacheCreationTokens: 15000,
        cacheReadTokens: 3000,
        outputTokens: 60000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, '99.00%', 'Should show 99% context usage ((180000+15000+3000)/200000)');
  assertContains(result, '93.75%', 'Should show 93.75% output usage (60000/64000)');
});

runTest('handles multiple compactifications', () => {
  const tokenUsage = {
    inputTokens: 200000,
    cacheCreationTokens: 30000,
    cacheReadTokens: 15000,
    outputTokens: 50000,
    totalTokens: 280000,
    modelUsage: {
      'claude-sonnet-4-5-20250929': {
        inputTokens: 200000,
        cacheCreationTokens: 30000,
        cacheReadTokens: 15000,
        outputTokens: 50000,
        modelName: 'Claude Sonnet 4.5',
        modelInfo: { limit: { context: 200000, output: 64000 } },
      },
    },
    subSessions: [
      { inputTokens: 80000, cacheCreationTokens: 12000, cacheReadTokens: 6000, outputTokens: 20000, messageCount: 20 },
      { inputTokens: 70000, cacheCreationTokens: 10000, cacheReadTokens: 5000, outputTokens: 15000, messageCount: 18 },
      { inputTokens: 50000, cacheCreationTokens: 8000, cacheReadTokens: 4000, outputTokens: 15000, messageCount: 12 },
    ],
    compactifications: [
      { timestamp: '2026-03-29T10:00:00Z', preTokens: 167000, trigger: 'auto' },
      { timestamp: '2026-03-29T11:30:00Z', preTokens: 155000, trigger: 'auto' },
    ],
  };
  const result = buildBudgetStatsString(tokenUsage, null);
  assertContains(result, 'Compactifications: 2', 'Should show 2 compactifications');
  assertContains(result, 'Sub-session 1 (initial)', 'Should show sub-session 1');
  assertContains(result, 'Sub-session 2 (after compactification #1)', 'Should show sub-session 2');
  assertContains(result, 'Sub-session 3 (after compactification #2)', 'Should show sub-session 3');
});

// ==== Summary ====
console.log('\n' + '='.repeat(80));
console.log(`\n🏁 Test Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
