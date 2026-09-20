#!/usr/bin/env node

// Test combining .strict() with other strict methods

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const testArg = process.argv[2] || '--invalid-option';
console.log(`Testing combined strict methods with: ${testArg}\n`);

try {
  const argv = yargs([testArg])
    .option('fork', {
      type: 'boolean',
      description: 'Fork the repository',
      alias: 'f',
      default: false,
    })
    .option('verbose', {
      type: 'boolean',
      description: 'Enable verbose logging',
      alias: 'v',
      default: false,
    })
    .strict() // General strict mode
    .strictOptions() // Strict options checking
    .strictCommands() // Strict commands checking
    .fail((msg, err, yargs) => {
      console.error('❌ Validation Error:');
      console.error(msg);
      process.exit(1);
    }).argv;

  console.log('✅ Parsing succeeded:');
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
  console.log('   _:', argv._);
} catch (error) {
  console.error('❌ Caught error:', error.message);
  process.exit(1);
}
