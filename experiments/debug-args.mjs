#!/usr/bin/env node

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Simple test to see what arguments we're receiving
console.log('Raw process.argv:', process.argv);
console.log('process.argv.length:', process.argv.length);

for (let i = 0; i < process.argv.length; i++) {
  console.log(`argv[${i}]: "${process.argv[i]}"`);
}

// Test yargs parsing
const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

const argv = yargs(hideBin(process.argv))
  .command('$0 <github-url>', 'Monitor GitHub issues and create PRs', yargs => {
    yargs.positional('github-url', {
      type: 'string',
      description: 'GitHub organization, repository, or user URL to monitor',
      demandOption: true
    });
  })
  .option('once', {
    type: 'boolean',
    description: 'Run once and exit instead of continuous monitoring',
    default: false
  })
  .option('fork', {
    type: 'boolean',
    description: "Fork the repository if you don't have write access",
    alias: 'f',
    default: false
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging',
    alias: 'v',
    default: false
  })
  .option('all-issues', {
    type: 'boolean',
    description: 'Process all open issues regardless of labels',
    alias: 'a',
    default: false
  })
  .option('skip-issues-with-prs', {
    type: 'boolean',
    description: 'Skip issues that already have open pull requests',
    alias: 's',
    default: false
  })
  .strict().argv;

console.log('Parsed argv:', argv);
