#!/usr/bin/env node

// Test if exitProcess(true) is needed for strict() to fail properly

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const testArg = process.argv[2] || '--invalid-option';
console.log(`Testing .strict() with exitProcess(true): ${testArg}\n`);

const argv = yargs([testArg])
  .option('fork', {
    type: 'boolean',
    description: 'Fork the repository',
    alias: 'f',
    default: false
  })
  .strict()
  .exitProcess(true).argv; // Ensure yargs exits the process on errors

console.log('✅ Parsing succeeded:');
console.log('   fork:', argv.fork);
console.log('   _:', argv._);
