#!/usr/bin/env node
// Issue: use-m doesn't always detect module format correctly
// Some packages export differently and need special handling

console.log('=== Issue #2: Module format detection inconsistencies ===\n');

// Load use-m
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
console.log('✅ use-m loaded\n');

// Test different module formats
console.log('1. Testing yargs@latest (CommonJS with default export):');
try {
  const yargsLatest = await use('yargs@latest');
  console.log('   Direct access:', typeof yargsLatest);
  console.log('   .default:', typeof yargsLatest.default);
  console.log('   Callable:', typeof yargsLatest === 'function');
  console.log('   Result: Need to use .default to access the function');
} catch (error) {
  console.log('   ❌ Failed:', error.message);
}

console.log('\n2. Testing yargs@17.7.2 (specific version):');
try {
  const yargs17 = await use('yargs@17.7.2');
  console.log('   Direct access:', typeof yargs17);
  console.log('   .default:', typeof yargs17.default);
  console.log('   Callable:', typeof yargs17 === 'function');
  console.log('   Result: Different behavior from @latest!');
} catch (error) {
  console.log('   ❌ Failed:', error.message);
}

console.log('\n3. Testing command-stream (ESM module):');
try {
  const cmdStream = await use('command-stream');
  console.log('   Direct access:', typeof cmdStream);
  console.log('   Has $:', '$' in cmdStream);
  console.log('   Result: Direct access to exports');
} catch (error) {
  console.log('   ❌ Failed:', error.message);
}

console.log('\n4. Testing fs (built-in module):');
try {
  const fs = await use('fs');
  console.log('   Direct access:', typeof fs);
  console.log('   Has promises:', 'promises' in fs);
  console.log('   Result: Direct access to module');
} catch (error) {
  console.log('   ❌ Failed:', error.message);
}

console.log('\n=== Workaround Pattern ===');
console.log('// Safe pattern for any module:');
console.log('const moduleImport = await use("package-name");');
console.log('const module = moduleImport.default || moduleImport;');
console.log('');
console.log('// For accessing properties:');
console.log('const { property } = moduleImport.default || moduleImport;');

console.log('\n=== Summary ===');
console.log('Problem: Inconsistent module format detection');
console.log('Impact: Same package behaves differently with @latest vs specific version');
console.log('Workaround: Always check for .default and fallback to direct access');
console.log('\nRecommendation for use-m:');
console.log('- Consistent module resolution regardless of version tag');
console.log('- Better documentation of module format handling');
console.log('- Consider auto-unwrapping default exports');
