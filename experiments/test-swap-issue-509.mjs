#!/usr/bin/env node

/**
 * Experiment script to test swap detection for issue #509
 * Tests that swap memory is properly detected and included in memory checks
 */

import { readFile } from 'fs/promises';

async function testSwapDetection() {
  console.log('Testing swap detection...\n');

  // Read /proc/meminfo
  const meminfoContent = await readFile('/proc/meminfo', 'utf8');
  const lines = meminfoContent.split('\n');

  const getValue = key => {
    const line = lines.find(l => l.startsWith(key));
    if (!line) return 0;
    const match = line.match(/(\d+)/);
    return match ? parseInt(match[1]) : 0;
  };

  // Get memory values in KB
  const memFree = getValue('MemFree:');
  const buffers = getValue('Buffers:');
  const cached = getValue('Cached:');
  const sReclaimable = getValue('SReclaimable:');
  const swapTotal = getValue('SwapTotal:');
  const swapFree = getValue('SwapFree:');

  console.log('Raw values from /proc/meminfo:');
  console.log(`  MemFree: ${memFree} KB`);
  console.log(`  Buffers: ${buffers} KB`);
  console.log(`  Cached: ${cached} KB`);
  console.log(`  SReclaimable: ${sReclaimable} KB`);
  console.log(`  SwapTotal: ${swapTotal} KB`);
  console.log(`  SwapFree: ${swapFree} KB\n`);

  // Calculate available memory (similar to 'free' command)
  const availableKB = memFree + buffers + cached + sReclaimable;
  const availableMB = Math.floor(availableKB / 1024);

  // Calculate swap info
  const swapUsedKB = swapTotal - swapFree;
  const swapMB = Math.floor(swapTotal / 1024);
  const swapUsedMB = Math.floor(swapUsedKB / 1024);
  const swapAvailableMB = Math.floor(swapFree / 1024);

  console.log('Calculated values:');
  console.log(`  Available RAM: ${availableMB} MB`);
  console.log(`  Swap Total: ${swapMB} MB`);
  console.log(`  Swap Used: ${swapUsedMB} MB`);
  console.log(`  Swap Available: ${swapAvailableMB} MB`);

  const totalAvailable = availableMB + swapAvailableMB;
  console.log(`  Total Available (RAM + Swap): ${totalAvailable} MB\n`);

  // Test with requirement of 256MB
  const minMemoryMB = 256;
  console.log(`Testing with requirement: ${minMemoryMB} MB`);

  if (availableMB >= minMemoryMB) {
    console.log('✅ RAM alone is sufficient');
  } else if (totalAvailable >= minMemoryMB) {
    console.log('⚠️  RAM + Swap is sufficient');
  } else {
    console.log('❌ Not enough memory even with swap');
  }

  console.log('\nProblem: When check fails, error message shows:');
  console.log(`  ❌ Insufficient memory: ${availableMB}MB available, ${minMemoryMB}MB required`);
  console.log('\nBut it should show swap information too!');
  console.log(`  Suggestion: ❌ Insufficient memory: ${availableMB}MB RAM available (${swapAvailableMB}MB swap available), ${minMemoryMB}MB required`);
  console.log(`  Or: ❌ Insufficient memory: ${availableMB}MB available (${totalAvailable}MB total with ${swapAvailableMB}MB swap), ${minMemoryMB}MB required`);
}

testSwapDetection().catch(console.error);
