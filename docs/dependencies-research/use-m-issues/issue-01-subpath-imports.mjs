#!/usr/bin/env node
// Issue: use-m fails to resolve subpath imports like 'yargs/helpers'
// This is a common pattern in modern npm packages but use-m doesn't handle it well

console.log('=== Issue #1: Subpath imports fail with use-m ===\n');

// Load use-m
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
console.log('✅ use-m loaded\n');

// Test 1: Import main package works
console.log('1. Importing main package (yargs@latest):');
try {
  const yargs = (await use('yargs@latest')).default;
  console.log('   ✅ Success - yargs imported');
  console.log('   Type:', typeof yargs);
} catch (error) {
  console.log('   ❌ Failed:', error.message);
}

// Test 2: Subpath import fails with @latest
console.log('\n2. Importing subpath (yargs@latest/helpers):');
try {
  const helpers = await use('yargs@latest/helpers');
  console.log('   ✅ Success - helpers imported');
  console.log('   Has hideBin:', 'hideBin' in helpers);
} catch (error) {
  console.log('   ❌ Failed:', error.message);
  console.log('   Error details:', error.toString());
}

// Test 3: Specific version with subpath
console.log('\n3. Importing subpath with specific version (yargs@17.7.2/helpers):');
try {
  const helpers = await use('yargs@17.7.2/helpers');
  console.log('   ✅ Success - helpers imported');
  console.log('   Has hideBin:', 'hideBin' in helpers);
  console.log('   hideBin type:', typeof helpers.hideBin);
} catch (error) {
  console.log('   ❌ Failed:', error.message);
}

// Test 4: Different package with subpath
console.log('\n4. Testing another package subpath (lodash@latest/isEmpty):');
try {
  const isEmpty = await use('lodash@latest/isEmpty');
  console.log('   ✅ Success - lodash/isEmpty imported');
  console.log('   Type:', typeof isEmpty);
} catch (error) {
  console.log('   ❌ Failed:', error.message);
}

console.log('\n=== Summary ===');
console.log('Problem: use-m cannot resolve subpath imports with @latest tag');
console.log('Impact: Common patterns like yargs/helpers fail to import');
console.log('Workaround: Use specific version numbers instead of @latest');
console.log('\nRecommendation for use-m:');
console.log('- Fix subpath resolution for @latest tags');
console.log('- Better error messages for subpath import failures');
console.log('- Document this limitation prominently');
