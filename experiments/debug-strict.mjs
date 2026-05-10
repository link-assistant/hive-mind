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

// Test step by step what's happening
const y = yargs(hideBin(process.argv));

y.command('$0 <github-url>', 'Monitor GitHub issues and create PRs', yargs => {
  yargs.positional('github-url', {
    type: 'string',
    description: 'GitHub organization, repository, or user URL to monitor',
    demandOption: true,
  });
});

y.usage('Usage: $0 <github-url> [options]');

y.option('once', {
  type: 'boolean',
  description: 'Run once and exit instead of continuous monitoring',
  default: false,
});

y.option('fork', {
  type: 'boolean',
  description: "Fork the repository if you don't have write access",
  alias: 'f',
  default: false,
});

y.option('verbose', {
  type: 'boolean',
  description: 'Enable verbose logging',
  alias: 'v',
  default: false,
});

y.option('all-issues', {
  type: 'boolean',
  description: 'Process all open issues regardless of labels',
  alias: 'a',
  default: false,
});

y.option('skip-issues-with-prs', {
  type: 'boolean',
  description: 'Skip issues that already have open pull requests',
  alias: 's',
  default: false,
});

y.help('h');
y.alias('h', 'help');

console.log('Before strict mode...');

try {
  y.strict();
  console.log('Strict mode set successfully');
  const argv = y.argv;
  console.log('Parsed argv:', argv);
} catch (error) {
  console.log('Error in strict mode:', error.message);
}
