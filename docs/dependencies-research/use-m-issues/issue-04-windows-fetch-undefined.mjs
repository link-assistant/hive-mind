#!/usr/bin/env node
// Issue: use-m fails on Windows because fetch is not defined in Node.js < 18
// Windows GitHub Actions runners may have older Node.js versions or different global context

console.log('=== Issue #4: use-m fails on Windows - fetch is not defined ===\n');

console.log('Environment:');
console.log('  Node version:', process.version);
console.log('  Platform:', process.platform);
console.log('  Fetch available:', typeof fetch !== 'undefined');
console.log();

// Problem: This line fails on Windows in GitHub Actions
// globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;

// Test 1: Check if fetch is available
console.log('1. Testing fetch availability:');
if (typeof fetch === 'undefined') {
  console.log('   ❌ fetch is not defined');
  console.log('   This is the root cause of use-m failure on Windows');
  console.log('   Node.js added fetch in v17.5.0 (experimental) and v18.0.0 (stable)');
} else {
  console.log('   ✅ fetch is available');
}

// Test 2: Try to load use-m with error handling
console.log('\n2. Attempting to load use-m:');
try {
  if (typeof fetch === 'undefined') {
    throw new Error('fetch is not defined - cannot load use-m from CDN');
  }

  const useScript = await (await fetch('https://unpkg.com/use-m/use.js')).text();
  const { use } = eval(useScript);
  console.log('   ✅ use-m loaded successfully');
} catch (error) {
  console.log('   ❌ Failed to load use-m:', error.message);

  if (error.message.includes('fetch is not defined')) {
    console.log('\n   Stack trace shows the error originates from:');
    console.log('   globalThis.use = (await eval(await (await fetch(...)).text())).use;');
  }
}

// Workaround options
console.log('\n=== Workarounds ===\n');
console.log('1. Use Node.js 18+ which has built-in fetch');
console.log('2. Polyfill fetch before loading use-m:');
console.log('   import fetch from "node-fetch";');
console.log('   globalThis.fetch = fetch;');
console.log('3. Use dynamic import() instead of use-m for known packages');
console.log('4. Check Node version and skip use-m on older versions');

// Example workaround
console.log('\n=== Example Workaround ===\n');
console.log(`
// Add fetch polyfill for Node < 18
if (typeof fetch === 'undefined') {
  try {
    const { default: fetch } = await import('node-fetch');
    globalThis.fetch = fetch;
  } catch {
    console.error('Cannot load use-m: fetch not available and node-fetch not installed');
    process.exit(1);
  }
}

// Now use-m should work
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
`);

// Windows-specific notes
console.log('\n=== Windows-Specific Notes ===\n');
console.log('- GitHub Actions windows-latest may use Node.js 16.x in some contexts');
console.log('- Windows bash shell (Git Bash) may have different Node.js version than PowerShell');
console.log('- The shebang #!/usr/bin/env node may resolve to different Node versions');
console.log('- Consider explicitly setting Node version in GitHub Actions with setup-node');

// Exit with appropriate code
if (typeof fetch === 'undefined') {
  console.log('\n❌ Test failed: fetch not available, use-m cannot load');
  process.exit(1);
} else {
  console.log('\n✅ Test passed: fetch is available');
}
