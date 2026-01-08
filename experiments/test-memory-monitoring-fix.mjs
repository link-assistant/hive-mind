#!/usr/bin/env node

// Test script to verify the memory monitoring fix

import { getResourceSnapshot } from '../memory-check.mjs';

console.log('🧪 Testing memory monitoring fix for Issue #178');
console.log('='.repeat(50));

async function testMemoryMonitoringFix() {
  console.log('1. Testing getResourceSnapshot function...');

  const snapshot = await getResourceSnapshot();

  // Check that memory field exists and is not undefined
  if (!snapshot.memory) {
    console.log('❌ FAIL: Memory field is missing or undefined');
    return false;
  }

  // Check that memory field is not empty
  if (snapshot.memory.trim() === '') {
    console.log('❌ FAIL: Memory field is empty');
    return false;
  }

  // Check that memory field has multiple lines
  const memoryLines = snapshot.memory.split('\n');
  if (memoryLines.length < 2) {
    console.log('❌ FAIL: Memory field should have multiple lines');
    return false;
  }

  // Test the specific access pattern used in solve.mjs
  const secondLine = snapshot.memory.split('\n')[1];
  if (!secondLine || secondLine.trim() === '') {
    console.log('❌ FAIL: Second line of memory info is empty');
    return false;
  }

  console.log('✅ PASS: Memory field is properly populated');
  console.log(`   Memory (2nd line): ${secondLine}`);

  // Check load field
  if (!snapshot.load || snapshot.load.trim() === '') {
    console.log('❌ FAIL: Load field is missing or empty');
    return false;
  }

  console.log('✅ PASS: Load field is properly populated');
  console.log(`   Load: ${snapshot.load}`);

  // Simulate the exact logging from solve.mjs
  console.log('\n2. Testing exact solve.mjs output format:');
  console.log(`📈 System resources before execution:`);
  console.log(`   Memory: ${snapshot.memory.split('\n')[1]}`);
  console.log(`   Load: ${snapshot.load}`);

  console.log('\n✅ SUCCESS: Memory monitoring is working correctly!');
  console.log('   The fix resolves Issue #178 - memory no longer shows as "undefined"');

  return true;
}

const success = await testMemoryMonitoringFix();
process.exit(success ? 0 : 1);
