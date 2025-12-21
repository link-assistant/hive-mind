#!/usr/bin/env node

// Test different yargs parsing methods

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing different yargs parsing methods...\n');

const testArgs = ['--token', 'mytoken123'];

console.log('Method 1: Using .parse()');
const instance1 = yargs(testArgs).option('token', { type: 'string' });
const argv1 = instance1.parse();
console.log('argv1.token:', argv1.token);
console.log(
  'Keys:',
  Object.keys(argv1).filter(k => k !== '_' && k !== '$0')
);

console.log('\nMethod 2: Using .parseSync()');
const instance2 = yargs(testArgs).option('token', { type: 'string' });
const argv2 = instance2.parseSync();
console.log('argv2.token:', argv2.token);
console.log(
  'Keys:',
  Object.keys(argv2).filter(k => k !== '_' && k !== '$0')
);

console.log('\nMethod 3: Using .argv property');
const instance3 = yargs(testArgs).option('token', { type: 'string' });
const argv3 = instance3.argv;
console.log('argv3.token:', argv3.token);
console.log(
  'Keys:',
  Object.keys(argv3).filter(k => k !== '_' && k !== '$0')
);
