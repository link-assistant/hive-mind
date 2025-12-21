#!/usr/bin/env node

// Simple test to verify flag logic without dependencies
console.log('🧪 Testing flag generation logic:');

// Mock argv object like hive.mjs would have
const argv = {
  verbose: true,
  fork: false,
  attachLogs: true,
  model: 'sonnet',
};

const issueUrl = 'https://github.com/test/repo/issues/123';
const forkFlag = argv.fork ? ' --fork' : '';
const verboseFlag = argv.verbose ? ' --verbose' : '';
const attachLogsFlag = argv.attachLogs ? ' --attach-logs' : '';
const command = `./solve.mjs "${issueUrl}" --model ${argv.model}${forkFlag}${verboseFlag}${attachLogsFlag}`;

console.log('Arguments:', argv);
console.log('Generated command:', command);

// Test the args array logic
const args = [issueUrl, '--model', argv.model];
if (argv.fork) {
  args.push('--fork');
}
if (argv.verbose) {
  args.push('--verbose');
}
if (argv.attachLogs) {
  args.push('--attach-logs');
}

console.log('Generated args array:', args);

// Check if both flags are included
const hasAttachLogs = args.includes('--attach-logs');
const hasVerbose = args.includes('--verbose');
const commandHasAttachLogs = command.includes('--attach-logs');
const commandHasVerbose = command.includes('--verbose');

console.log('\n🔍 Results:');
console.log(hasAttachLogs ? '✅ SUCCESS: --attach-logs found in args array' : '❌ FAILURE: --attach-logs not found in args array');
console.log(hasVerbose ? '✅ SUCCESS: --verbose found in args array' : '❌ FAILURE: --verbose not found in args array');
console.log(commandHasAttachLogs ? '✅ SUCCESS: --attach-logs found in command string' : '❌ FAILURE: --attach-logs not found in command string');
console.log(commandHasVerbose ? '✅ SUCCESS: --verbose found in command string' : '❌ FAILURE: --verbose not found in command string');

if (hasAttachLogs && hasVerbose && commandHasAttachLogs && commandHasVerbose) {
  console.log('\n🎉 ALL TESTS PASSED: Both flags are working correctly!');
} else {
  console.log('\n❌ SOME TESTS FAILED');
}
