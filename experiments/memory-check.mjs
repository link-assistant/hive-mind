#!/usr/bin/env node

// Use command-stream for consistent $ behavior across runtimes
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

// Function to check available memory
const checkMemory = async (minMemoryMB = 256) => {
  try {
    // Get memory info from /proc/meminfo
    const { stdout } = await $`grep -E "MemAvailable|MemFree|SwapFree" /proc/meminfo`;
    const memInfo = stdout.toString();

    // Parse memory values (they're in kB)
    const availableMatch = memInfo.match(/MemAvailable:\s+(\d+)/);
    const freeMatch = memInfo.match(/MemFree:\s+(\d+)/);
    const swapFreeMatch = memInfo.match(/SwapFree:\s+(\d+)/);

    const availableMB = availableMatch ? Math.floor(parseInt(availableMatch[1]) / 1024) : 0;
    const freeMB = freeMatch ? Math.floor(parseInt(freeMatch[1]) / 1024) : 0;
    const swapFreeMB = swapFreeMatch ? Math.floor(parseInt(swapFreeMatch[1]) / 1024) : 0;

    console.log(`🧠 Memory status:`);
    console.log(`   Available: ${availableMB}MB`);
    console.log(`   Free: ${freeMB}MB`);
    console.log(`   Swap Free: ${swapFreeMB}MB`);

    if (availableMB < minMemoryMB) {
      console.log(`❌ Insufficient memory: ${availableMB}MB available, ${minMemoryMB}MB required`);
      console.log(`   This may cause Claude command to be killed by the system`);

      // Check total swap
      const { stdout: swapInfo } = await $`grep -E "SwapTotal" /proc/meminfo`;
      const swapTotalMatch = swapInfo.toString().match(/SwapTotal:\s+(\d+)/);
      const swapTotalMB = swapTotalMatch ? Math.floor(parseInt(swapTotalMatch[1]) / 1024) : 0;

      console.log(`   Total Swap: ${swapTotalMB}MB`);

      if (swapTotalMB < 1024) {
        console.log(`\n💡 To increase swap space on Ubuntu 24.04:`);
        console.log(`   sudo fallocate -l 2G /swapfile`);
        console.log(`   sudo chmod 600 /swapfile`);
        console.log(`   sudo mkswap /swapfile`);
        console.log(`   sudo swapon /swapfile`);
        console.log(`   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`);
        console.log(`\n   After setting up swap, restart the system if needed.`);
      }

      return false;
    }

    console.log(`✅ Memory check passed: ${availableMB}MB available (${minMemoryMB}MB required)`);
    return true;
  } catch (error) {
    console.log(`⚠️  Could not check memory: ${error.message}`);
    console.log(`   Continuing anyway, but memory issues may occur.`);
    return true; // Continue on check failure to avoid blocking execution
  }
};

// Function to get system resource snapshot
const getResourceSnapshot = async () => {
  try {
    const memInfo = await $`cat /proc/meminfo | grep -E "MemTotal|MemAvailable|MemFree|SwapTotal|SwapFree"`;
    const loadAvg = await $`cat /proc/loadavg`;
    const uptime = await $`uptime`;

    return {
      timestamp: new Date().toISOString(),
      memory: memInfo.stdout.toString().trim(),
      load: loadAvg.stdout.toString().trim(),
      uptime: uptime.stdout.toString().trim(),
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      error: `Failed to get resource snapshot: ${error.message}`,
    };
  }
};

// Test both functions
console.log('Testing memory check and resource monitoring...\n');

await checkMemory(256);
console.log('\n');

const snapshot = await getResourceSnapshot();
console.log('Resource snapshot:');
console.log(JSON.stringify(snapshot, null, 2));
