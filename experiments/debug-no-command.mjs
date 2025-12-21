#!/usr/bin/env node

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Test yargs parsing
const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

console.log('hideBin(process.argv):', hideBin(process.argv));

const argv = yargs(hideBin(process.argv))
  .positional('github-url', {
    type: 'string',
    description: 'GitHub organization, repository, or user URL to monitor',
    demandOption: true,
  })
  .usage('Usage: $0 <github-url> [options]')
  .option('once', {
    type: 'boolean',
    description: 'Run once and exit instead of continuous monitoring',
    default: false,
  })
  .option('fork', {
    type: 'boolean',
    description: "Fork the repository if you don't have write access",
    alias: 'f',
    default: false,
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging',
    alias: 'v',
    default: false,
  })
  .option('all-issues', {
    type: 'boolean',
    description: 'Process all open issues regardless of labels',
    alias: 'a',
    default: false,
  })
  .option('skip-issues-with-prs', {
    type: 'boolean',
    description: 'Skip issues that already have open pull requests',
    alias: 's',
    default: false,
  })
  .help('h')
  .alias('h', 'help')
  .strict().argv;

console.log('Parsed argv:', argv);
