#!/usr/bin/env node
/**
 * Test script to reproduce issue #651
 * Tests how yargs handles positional arguments with named keys
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

console.log('Testing yargs positional argument behavior for issue #651\n');

// Simulate the exact yargs configuration from solve.config.lib.mjs
const yargsInstance = yargs(hideBin(process.argv))
  .usage('Usage: solve.mjs <issue-url> [options]')
  .command('$0 <issue-url>', 'Solve a GitHub issue or pull request', (yargs) => {
    yargs.positional('issue-url', {
      type: 'string',
      description: 'The GitHub issue URL to solve'
    });
  });

const argv = await yargsInstance.parse();

console.log('Command line args:', process.argv.slice(2));
console.log('\n--- Parsed argv object ---');
console.log('argv._:', argv._);
console.log('argv._[0]:', argv._[0]);
console.log('argv["issue-url"]:', argv['issue-url']);
console.log('argv.issueUrl:', argv.issueUrl);

console.log('\n--- Full argv ---');
console.log(JSON.stringify(argv, null, 2));

console.log('\n--- Test Results ---');
if (argv._[0] === undefined && argv['issue-url'] !== undefined) {
  console.log('✗ BUG CONFIRMED: argv._[0] is undefined while argv["issue-url"] has the value');
  console.log('  This explains why CLAUDE.md shows "Issue to solve: undefined"');
  console.log('  in solve.auto-pr.lib.mjs line 62');
} else if (argv._[0] !== undefined && argv['issue-url'] !== undefined) {
  console.log('✓ Both argv._[0] and argv["issue-url"] are defined');
} else {
  console.log('? Unexpected state');
}
