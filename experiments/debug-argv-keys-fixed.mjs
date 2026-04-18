#!/usr/bin/env node

/**
 * Debug what keys yargs creates (with fresh instances)
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Test 1: —fork (em-dash)');
let argv1 = yargs(['—fork']).option('fork', { type: 'boolean', default: false }).parseSync();
console.log('Keys:', Object.keys(argv1));
console.log('');

console.log('Test 2: --unknown-option (fresh yargs instance)');
const yargsModule2 = await use('yargs@17.7.2');
const yargs2 = yargsModule2.default || yargsModule2;
let argv2 = yargs2(['--unknown-option']).option('fork', { type: 'boolean', default: false }).parseSync();
console.log('Keys:', Object.keys(argv2));
console.log('');

console.log('Test 3: --no-tool-check with boolean-negation (fresh instance)');
const yargsModule3 = await use('yargs@17.7.2');
const yargs3 = yargsModule3.default || yargsModule3;
let argv3 = yargs3(['--no-tool-check']).option('tool-check', { type: 'boolean', default: true }).parserConfiguration({ 'boolean-negation': true }).parseSync();
console.log('Keys:', Object.keys(argv3));
console.log('Values - tool-check:', argv3['tool-check']);
console.log('Values - toolCheck:', argv3.toolCheck);
console.log('Values - no-tool-check:', argv3['no-tool-check']);
console.log('Values - noToolCheck:', argv3.noToolCheck);
