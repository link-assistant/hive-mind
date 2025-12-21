#!/usr/bin/env node

// Just test argument parsing - exit before networking
process.argv = [
  'node',
  './hive.mjs',
  'https://github.com/suenot/tinkoff-invest-etf-balancer-bot',
  '-vas',
  '--once',
  '--fork'
];

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

// Replicate the exact configuration from hive.mjs
const argv = yargs(hideBin(process.argv))
  .command('$0 <github-url>', 'Monitor GitHub issues and create PRs', yargs => {
    yargs.positional('github-url', {
      type: 'string',
      description: 'GitHub organization, repository, or user URL to monitor',
      demandOption: true
    });
  })
  .usage('Usage: $0 <github-url> [options]')
  .option('monitor-tag', {
    type: 'string',
    description: 'GitHub label to monitor for issues',
    default: 'help wanted',
    alias: 't'
  })
  .option('all-issues', {
    type: 'boolean',
    description: 'Process all open issues regardless of labels',
    default: false,
    alias: 'a'
  })
  .option('skip-issues-with-prs', {
    type: 'boolean',
    description: 'Skip issues that already have open pull requests',
    default: false,
    alias: 's'
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging',
    alias: 'v',
    default: false
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
  .help('h')
  .alias('h', 'help').argv;

console.log('✅ Arguments parsed successfully:');
console.log('  github-url:', argv['github-url']);
console.log('  verbose:', argv.verbose);
console.log('  all-issues:', argv.allIssues);
console.log('  skip-issues-with-prs:', argv.skipIssuesWithPrs);
console.log('  once:', argv.once);
console.log('  fork:', argv.fork);
