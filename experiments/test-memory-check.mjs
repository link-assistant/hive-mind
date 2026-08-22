#!/usr/bin/env node

// Test script for memory check fix
import { $ } from 'zx';

// Mock log function for testing
const log = async (message, options = {}) => {
  const level = options.level || 'info';
  const prefix = level === 'error' ? '❌' : level === 'warning' ? '⚠️' : 'ℹ️';
  console.log(`${prefix} ${message}`);
};

// Copy of the fixed checkMemory function
const checkMemory = async (minMemoryMB = 256) => {
  try {
    // Get memory info from /proc/meminfo
    const { stdout } = await $`grep -E "MemAvailable|MemFree|SwapFree|SwapTotal" /proc/meminfo`;
    const memInfo = stdout.toString();

    // Parse memory values (they're in kB)
    const availableMatch = memInfo.match(/MemAvailable:\s+(\d+)/);
    const freeMatch = memInfo.match(/MemFree:\s+(\d+)/);
    const swapFreeMatch = memInfo.match(/SwapFree:\s+(\d+)/);
    const swapTotalMatch = memInfo.match(/SwapTotal:\s+(\d+)/);

    const availableMB = availableMatch ? Math.floor(parseInt(availableMatch[1]) / 1024) : 0;
    const freeMB = freeMatch ? Math.floor(parseInt(freeMatch[1]) / 1024) : 0;
    const swapFreeMB = swapFreeMatch ? Math.floor(parseInt(swapFreeMatch[1]) / 1024) : 0;
    const swapTotalMB = swapTotalMatch ? Math.floor(parseInt(swapTotalMatch[1]) / 1024) : 0;

    await log(`🧠 Memory check: ${availableMB}MB available, ${freeMB}MB free, ${swapFreeMB}MB swap free`);

    // Calculate effective available memory (RAM + swap)
    const effectiveAvailableMB = availableMB + swapFreeMB;

    if (availableMB < minMemoryMB) {
      if (effectiveAvailableMB >= minMemoryMB) {
        await log(`⚠️  Low RAM: ${availableMB}MB available, ${minMemoryMB}MB required, but ${swapFreeMB}MB swap available`, { level: 'warning' });
        await log('   Continuing with swap support (effective memory: ' + effectiveAvailableMB + 'MB)', {
          level: 'warning',
        });
      } else {
        await log(`❌ Insufficient memory: ${availableMB}MB available + ${swapFreeMB}MB swap = ${effectiveAvailableMB}MB total, ${minMemoryMB}MB required`, { level: 'error' });
        await log('   This may cause Claude command to be killed by the system.', { level: 'error' });

        if (swapTotalMB < 1024) {
          await log('', { level: 'error' });
          await log('💡 To increase swap space on Ubuntu 24.04:', { level: 'error' });
          await log('   sudo fallocate -l 2G /swapfile', { level: 'error' });
          await log('   sudo chmod 600 /swapfile', { level: 'error' });
          await log('   sudo mkswap /swapfile', { level: 'error' });
          await log('   sudo swapon /swapfile', { level: 'error' });
          await log("   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab", { level: 'error' });
          await log('   After setting up swap, restart the system if needed.', { level: 'error' });
        }

        return false;
      }
    }

    if (availableMB >= minMemoryMB) {
      await log(`✅ Memory check passed: ${availableMB}MB available (${minMemoryMB}MB required)`);
    }
    return true;
  } catch (error) {
    await log(`⚠️  Could not check memory: ${error.message}`, { level: 'warning' });
    await log('   Continuing anyway, but memory issues may occur.', { level: 'warning' });
    return true; // Continue on check failure to avoid blocking execution
  }
};

// Test with different scenarios
console.log('Testing memory check with 256MB requirement:');
const result = await checkMemory(256);
console.log('Result:', result);

console.log('\nTesting memory check with 512MB requirement:');
const result2 = await checkMemory(512);
console.log('Result:', result2);

console.log('\nTesting memory check with 4096MB requirement:');
const result3 = await checkMemory(4096);
console.log('Result:', result3);
