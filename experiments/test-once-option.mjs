#!/usr/bin/env node

// Test script to verify the --once option fix
// This simulates the relevant parts of hive.mjs to test the polling interval display logic

const argv = {
  once: true, // Test with --once option
  interval: 300,
  concurrency: 2,
  pullRequestsPerIssue: 1,
  model: 'sonnet',
  fork: false,
  maxIssues: 0,
  dryRun: false,
  autoCleanup: false,
};

async function log(message) {
  console.log(message);
}

// Simulate the configuration display logic from hive.mjs
console.log('🎯 Testing configuration display with --once option:');
console.log('');

await log(`   🔄 Concurrency: ${argv.concurrency} parallel workers`);
await log(`   📊 Pull Requests per Issue: ${argv.pullRequestsPerIssue}`);
await log(`   🤖 Model: ${argv.model}`);
if (argv.fork) {
  await log(`   🍴 Fork: ENABLED (will fork repos if no write access)`);
}
if (!argv.once) {
  await log(`   ⏱️  Polling Interval: ${argv.interval} seconds`);
}
await log(`   ${argv.once ? '🚀 Mode: Single run' : '♾️  Mode: Continuous monitoring'}`);
if (argv.maxIssues > 0) {
  await log(`   🔢 Max Issues: ${argv.maxIssues}`);
}
if (argv.dryRun) {
  await log(`   🧪 DRY RUN MODE - No actual processing`);
}
if (argv.autoCleanup) {
  await log(`   🧹 Auto-cleanup: ENABLED (will clean /tmp/* /var/tmp/* on success)`);
}

console.log('');
console.log('✅ Test completed. Notice that "Polling Interval" is NOT displayed when --once is true.');
console.log('');

// Now test with --once false
console.log('🎯 Testing configuration display with continuous monitoring:');
console.log('');

argv.once = false;

await log(`   🔄 Concurrency: ${argv.concurrency} parallel workers`);
await log(`   📊 Pull Requests per Issue: ${argv.pullRequestsPerIssue}`);
await log(`   🤖 Model: ${argv.model}`);
if (argv.fork) {
  await log(`   🍴 Fork: ENABLED (will fork repos if no write access)`);
}
if (!argv.once) {
  await log(`   ⏱️  Polling Interval: ${argv.interval} seconds`);
}
await log(`   ${argv.once ? '🚀 Mode: Single run' : '♾️  Mode: Continuous monitoring'}`);
if (argv.maxIssues > 0) {
  await log(`   🔢 Max Issues: ${argv.maxIssues}`);
}
if (argv.dryRun) {
  await log(`   🧪 DRY RUN MODE - No actual processing`);
}
if (argv.autoCleanup) {
  await log(`   🧹 Auto-cleanup: ENABLED (will clean /tmp/* /var/tmp/* on success)`);
}

console.log('');
console.log('✅ Test completed. Notice that "Polling Interval" IS displayed when --once is false.');
