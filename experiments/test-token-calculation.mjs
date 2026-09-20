#!/usr/bin/env node

globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;

import { calculateSessionTokens } from '../src/claude.lib.mjs';

async function testTokenCalculation() {
  console.log('Testing token calculation from session JSONL file...\n');

  // Use an existing session from the actual files
  const sessionId = 'cc0c1ceb-c4d2-4af8-8e40-1c99ef293291';
  const tempDir = '/tmp/gh-issue-solver-1759418350957';

  // Debug: show what path we're looking for
  const os = await use('os');
  const path = await use('path');
  const homeDir = os.homedir();
  const projectDirName = path.basename(tempDir);
  const sessionFile = path.join(homeDir, '.claude', 'projects', projectDirName, `${sessionId}.jsonl`);
  console.log(`Looking for session file at: ${sessionFile}\n`);

  try {
    const tokenUsage = await calculateSessionTokens(sessionId, tempDir);

    if (tokenUsage) {
      console.log('✅ Token calculation successful!\n');
      console.log('Token Usage Summary:');
      console.log(`  Input tokens: ${tokenUsage.inputTokens.toLocaleString()}`);
      if (tokenUsage.cacheCreationTokens > 0) {
        console.log(`  Cache creation tokens: ${tokenUsage.cacheCreationTokens.toLocaleString()}`);
      }
      if (tokenUsage.cacheReadTokens > 0) {
        console.log(`  Cache read tokens: ${tokenUsage.cacheReadTokens.toLocaleString()}`);
      }
      console.log(`  Output tokens: ${tokenUsage.outputTokens.toLocaleString()}`);
      console.log(`  Total tokens: ${tokenUsage.totalTokens.toLocaleString()}`);
    } else {
      console.log('⚠️ No token data found (session file may not exist yet)');
    }
  } catch (error) {
    console.error('❌ Error calculating tokens:', error.message);
    process.exit(1);
  }
}

testTokenCalculation();
