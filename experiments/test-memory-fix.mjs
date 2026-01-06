#!/usr/bin/env node

// Test the memory monitoring fix in context

import { getResourceSnapshot } from '../memory-check.mjs';

async function testMemoryMonitoring() {
  console.log('Testing memory monitoring as used in solve.mjs...');

  const resourcesBefore = await getResourceSnapshot();

  // Simulate the log output from solve.mjs
  console.log(`📈 System resources before execution:`);

  if (resourcesBefore.memory && resourcesBefore.memory.split('\n').length > 1) {
    console.log(`   Memory: ${resourcesBefore.memory.split('\n')[1]}`);
  } else {
    console.log(`   Memory: undefined or invalid format`);
    console.log(`   Raw memory: ${JSON.stringify(resourcesBefore.memory)}`);
  }

  if (resourcesBefore.load) {
    console.log(`   Load: ${resourcesBefore.load}`);
  } else {
    console.log(`   Load: undefined`);
  }

  console.log('\nFull snapshot:', JSON.stringify(resourcesBefore, null, 2));
}

await testMemoryMonitoring();
