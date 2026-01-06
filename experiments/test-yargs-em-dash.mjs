#!/usr/bin/env node

/**
 * Test how yargs parses em-dash
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing how yargs parses em-dash\n');

const argv = yargs(['—fork'])
  .option('fork', {
    type: 'boolean',
    default: false,
  })
  .parseSync();

console.log('argv keys:', Object.keys(argv));
console.log('argv:', JSON.stringify(argv, null, 2));
