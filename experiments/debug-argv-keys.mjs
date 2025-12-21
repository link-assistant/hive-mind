#!/usr/bin/env node

/**
 * Debug what keys yargs creates
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Test 1: —fork (em-dash)');
let argv1 = yargs(['—fork']).option('fork', { type: 'boolean', default: false }).parseSync();
console.log('Keys:', Object.keys(argv1));
console.log('Values:', JSON.stringify(argv1, null, 2));
console.log('');

console.log('Test 2: --unknown-option');
let argv2 = yargs(['--unknown-option']).option('fork', { type: 'boolean', default: false }).parseSync();
console.log('Keys:', Object.keys(argv2));
console.log('Values:', JSON.stringify(argv2, null, 2));
console.log('');

console.log('Test 3: --no-tool-check with boolean-negation');
let argv3 = yargs(['--no-tool-check'])
  .option('tool-check', { type: 'boolean', default: true })
  .parserConfiguration({ 'boolean-negation': true })
  .parseSync();
console.log('Keys:', Object.keys(argv3));
console.log('Values:', JSON.stringify(argv3, null, 2));
