#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargsFactory = yargsModule.default || yargsModule;

console.log('Test 1: With --solve');
const argv1 = yargsFactory(['--solve']).option('solve', { type: 'boolean', default: true }).parseSync();
console.log('argv.solve:', argv1.solve);

console.log('\nTest 2: With --no-solve');
const argv2 = yargsFactory(['--no-solve']).option('solve', { type: 'boolean', default: true }).parseSync();
console.log('argv.solve:', argv2.solve);

console.log('\nTest 3: Without any option (should use default)');
const argv3 = yargsFactory([]).option('solve', { type: 'boolean', default: true }).parseSync();
console.log('argv.solve:', argv3.solve);

console.log('\nTest 4: Check negation with boolean() method');
const argv4 = yargsFactory(['--no-solve']).boolean('solve').default('solve', true).parseSync();
console.log('argv.solve:', argv4.solve);
