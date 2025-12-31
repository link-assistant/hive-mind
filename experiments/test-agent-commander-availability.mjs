#!/usr/bin/env node
/**
 * Experiment: Test agent-commander availability detection
 *
 * This script tests whether the agent-commander library can be detected
 * and its availability is properly reported.
 *
 * Usage:
 *   node experiments/test-agent-commander-availability.mjs
 */

import { isAgentCommanderAvailable } from '../src/agent-commander.lib.mjs';

async function main() {
  console.log('Testing agent-commander availability...\n');

  const isAvailable = await isAgentCommanderAvailable();

  if (isAvailable) {
    console.log('✅ agent-commander is AVAILABLE');
    console.log('   The --use-agent-commander flag will work.');

    // Try to get more info
    try {
      const agentCommander = await import('agent-commander');
      console.log('\n   Exported functions:');
      for (const key of Object.keys(agentCommander)) {
        console.log(`   - ${key}`);
      }
    } catch (e) {
      console.log(`   Warning: Could not inspect exports: ${e.message}`);
    }
  } else {
    console.log('❌ agent-commander is NOT AVAILABLE');
    console.log('   Install it with: npm install agent-commander');
    console.log('   Or the --use-agent-commander flag will fail gracefully.');
  }

  console.log('\nDone.');
}

main().catch(console.error);
