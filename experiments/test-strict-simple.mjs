#!/usr/bin/env node

// Simple test of strictOptions() with different option formats

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing strictOptions() with simple args...\n');
console.log('Input args:', process.argv.slice(2));

try {
  const argv = yargs(process.argv.slice(2))
    .option('fork', {
      type: 'boolean',
      description: 'Fork the repository',
      alias: 'f',
      default: false
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false
    })
    .strictOptions()
    .fail((msg, err, yargs) => {
      console.error('\n❌ Validation Error:');
      console.error(msg);
      process.exit(1);
    }).argv;

  console.log('\n✅ Parsing succeeded:');
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
  console.log('   _:', argv._);
} catch (error) {
  console.error('\n❌ Caught error:', error.message);
  process.exit(1);
}
