#!/usr/bin/env node

// Compare .strict() vs .strictOptions() behavior

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const testArgs = process.argv[2] === 'strict' ? 'strict' : 'strictOptions';
const testValue = process.argv[3] || '--invalid-option';

console.log(`Testing .${testArgs}() with: ${testValue}\n`);

try {
  const builder = yargs([testValue])
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
    .fail((msg, err, yargs) => {
      console.error('❌ Validation Error:');
      console.error(msg);
      process.exit(1);
    });

  if (testArgs === 'strict') {
    builder.strict();
  } else {
    builder.strictOptions();
  }

  const argv = builder.argv;

  console.log('✅ Parsing succeeded:');
  console.log('   fork:', argv.fork);
  console.log('   verbose:', argv.verbose);
  console.log('   _:', argv._);
  console.log('   All argv:', argv);
} catch (error) {
  console.error('❌ Caught error:', error.message);
  process.exit(1);
}
