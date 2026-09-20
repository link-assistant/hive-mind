#!/usr/bin/env node

// Test with lower memory threshold to see our memory check working
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

// Function to check available memory (copied from our implementation)
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

    console.log(`🧠 Memory check: ${availableMB}MB available, ${freeMB}MB free, ${swapFreeMB}MB swap free`);

    if (availableMB < minMemoryMB) {
      console.log(`❌ Insufficient memory: ${availableMB}MB available, ${minMemoryMB}MB required`);
      console.log('   This may cause Claude command to be killed by the system.');

      if (swapTotalMB < 1024) {
        console.log('');
        console.log('💡 To increase swap space on Ubuntu 24.04:');
        console.log('   sudo fallocate -l 2G /swapfile');
        console.log('   sudo chmod 600 /swapfile');
        console.log('   sudo mkswap /swapfile');
        console.log('   sudo swapon /swapfile');
        console.log("   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab");
        console.log('   After setting up swap, restart the system if needed.');
      }

      return false;
    }

    console.log(`✅ Memory check passed: ${availableMB}MB available (${minMemoryMB}MB required)`);
    return true;
  } catch (error) {
    console.log(`⚠️  Could not check memory: ${error.message}`);
    console.log('   Continuing anyway, but memory issues may occur.');
    return true; // Continue on check failure to avoid blocking execution
  }
};

console.log('Testing memory check with different thresholds:\n');

console.log('Test 1: Check with 128MB threshold (should pass)');
await checkMemory(128);

console.log('\nTest 2: Check with 256MB threshold (might fail)');
await checkMemory(256);

console.log('\nTest 3: Check with 512MB threshold (should fail)');
await checkMemory(512);
