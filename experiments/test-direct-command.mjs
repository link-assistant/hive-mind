#!/usr/bin/env node

// Direct test to verify command generation logic
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Mock the command line arguments parsing like hive.mjs does
const argv = yargs(hideBin(['node', 'test', 'https://github.com/test/repo', '--attach-logs', '--verbose']))
  .positional('github-url', {
    description: 'GitHub organization, repository, or user URL to monitor',
    type: 'string',
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging',
    alias: 'v',
    default: false,
  })
  .option('fork', {
    type: 'boolean',
    description: "Fork the repository if you don't have write access",
    alias: 'f',
    default: false,
  })
  .option('attach-logs', {
    type: 'boolean',
    description: 'Upload the solution log file to the Pull Request on completion (⚠️ WARNING: May expose sensitive data)',
    default: false,
  }).argv;

// Test the flag generation logic
const issueUrl = 'https://github.com/test/repo/issues/123';
const forkFlag = argv.fork ? ' --fork' : '';
const verboseFlag = argv.verbose ? ' --verbose' : '';
const attachLogsFlag = argv.attachLogs ? ' --attach-logs' : '';
const command = `./solve.mjs "${issueUrl}" --model ${argv.model || 'sonnet'}${forkFlag}${verboseFlag}${attachLogsFlag}`;

console.log('🧪 Testing command generation logic:');
console.log('Arguments parsed:', {
  verbose: argv.verbose,
  fork: argv.fork,
  attachLogs: argv.attachLogs,
});
console.log('Generated command:', command);

// Test the args array logic
const args = [issueUrl, '--model', argv.model || 'sonnet'];
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

// Check if --attach-logs is included
if (args.includes('--attach-logs')) {
  console.log('✅ SUCCESS: --attach-logs found in args array');
} else {
  console.log('❌ FAILURE: --attach-logs not found in args array');
}

if (command.includes('--attach-logs')) {
  console.log('✅ SUCCESS: --attach-logs found in command string');
} else {
  console.log('❌ FAILURE: --attach-logs not found in command string');
}
