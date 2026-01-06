#!/usr/bin/env node

/**
 * Direct test of yargs negation behavior
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing yargs negation behavior directly...\n');

// Simulate: node script.js --no-solve --no-hive
// Need to include node and script name like in real argv
const testArgs = ['node', 'script.js', '--no-solve', '--no-hive'];

const argv = yargs(testArgs.slice(2)) // Skip 'node' and 'script.js'
  .option('solve', {
    type: 'boolean',
    description: 'Enable /solve command (use --no-solve to disable)',
    default: true,
  })
  .option('hive', {
    type: 'boolean',
    description: 'Enable /hive command (use --no-hive to disable)',
    default: true,
  })
  .parserConfiguration({
    'boolean-negation': true,
  })
  .parseSync();

console.log('Input args:', testArgs);
console.log('Parsed argv:', argv);
console.log('argv.solve:', argv.solve);
console.log('argv.hive:', argv.hive);
console.log('argv["no-solve"]:', argv['no-solve']);
console.log('argv.noSolve:', argv.noSolve);

console.log('\n--- Environment check ---');
console.log('Does yargs support negation? Testing with explicit check...');

const solveEnabled = argv.solve !== false;
const hiveEnabled = argv.hive !== false;

console.log('solveEnabled (argv.solve !== false):', solveEnabled);
console.log('hiveEnabled (argv.hive !== false):', hiveEnabled);
