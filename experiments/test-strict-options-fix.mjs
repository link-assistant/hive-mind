#!/usr/bin/env node

// Test yargs strictOptions() to properly reject unknown options
// This addresses issue #453 where —fork (em-dash) is not recognized and doesn't fail

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

console.log('Testing strictOptions() to reject unrecognized options...\n');
console.log('Input args:', hideBin(process.argv));

try {
  const argv = yargs(hideBin(process.argv))
    .usage('Usage: $0 <github-url> [options]')
    .positional('github-url', {
      type: 'string',
      description: 'GitHub organization, repository, or user URL to monitor',
      demandOption: true
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
    .help('h')
    .alias('h', 'help')
    .strictOptions() // This should reject unknown options
    .fail((msg, err, yargs) => {
      console.error('\n❌ Validation Error:');
      console.error(msg);
      process.exit(1);
    }).argv;

  console.log('\n✅ Parsing succeeded:');
  console.log('   github-url:', argv['github-url']);
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
} catch (error) {
  console.error('\n❌ Caught error:', error.message);
  process.exit(1);
}
