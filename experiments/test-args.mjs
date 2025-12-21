#!/usr/bin/env node

// Simple test to validate that the argument includes --auto-continue
console.log('🧪 Testing argument parsing...');
console.log('Arguments passed:', process.argv.slice(2));

const hasAutoContinue = process.argv.includes('--auto-continue');
const hasVerbose = process.argv.includes('--verbose') || process.argv.includes('-v');

console.log(`--auto-continue: ${hasAutoContinue}`);
console.log(`--verbose: ${hasVerbose}`);

if (hasAutoContinue) {
  console.log('✅ Auto-continue option is enabled');
} else {
  console.log('⏹️  Auto-continue option is disabled (default)');
}

console.log('🧪 Argument parsing test completed!');
