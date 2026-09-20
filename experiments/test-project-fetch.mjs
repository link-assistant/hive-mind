#!/usr/bin/env node

// Test script for GitHub Projects v2 integration
import { fetchProjectIssues } from '../github.lib.mjs';
import { log, setLogFile } from '../lib.mjs';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const logFile = `/tmp/gh-issue-solver-1758062663654/experiments/test-project-${timestamp}.log`;
setLogFile(logFile);

console.log('Testing GitHub Projects v2 integration...');
console.log(`Log file: ${logFile}`);

// Test with a hypothetical project (will likely fail but shows the flow)
try {
  await log('Starting test...');

  // Test validation
  console.log('\n1. Testing function with valid parameters...');
  const issues = await fetchProjectIssues(1, 'test-owner', 'Ready');

  console.log(`   Result: ${issues.length} issues found`);
  if (issues.length > 0) {
    console.log('   Sample issues:');
    issues.slice(0, 3).forEach((issue, index) => {
      console.log(`      ${index + 1}. #${issue.number}: ${issue.title}`);
    });
  }
} catch (error) {
  console.log(`   Expected error: ${error.message}`);
  console.log('   This is expected since we are testing with a hypothetical project');
}

console.log('\nTest completed. Check the log file for detailed output.');
