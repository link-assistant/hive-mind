#!/usr/bin/env node

// Test with and without quotes

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

console.log('Test 1: Without quotes (how yargs receives it from shell)');
process.argv = ['node', 'test.js', '--token', '8490aOEM', '--config', '(a b c)'];
const argv1 = yargs(hideBin(process.argv)).option('token', { type: 'string' }).option('config', { type: 'string' }).parse();
console.log('argv1.token:', argv1.token);
console.log('argv1.config:', argv1.config);
console.log(
  'Keys:',
  Object.keys(argv1).filter(k => k !== '_' && k !== '$0')
);

console.log('\n\nTest 2: Without quotes, multiline string');
process.argv = ['node', 'test.js', '--config', '(\n  a\n  b\n)'];
const argv2 = yargs(hideBin(process.argv)).option('config', { type: 'string' }).parse();
console.log('argv2.config:', argv2.config);
console.log(
  'Keys:',
  Object.keys(argv2).filter(k => k !== '_' && k !== '$0')
);

console.log('\n\nTest 3: Check actual key contents');
process.argv = ['node', 'test.js', '--token', '8490aOEM'];
const argv3 = yargs(hideBin(process.argv)).option('token', { type: 'string' }).parse();

for (const [key, value] of Object.entries(argv3)) {
  if (key !== '_' && key !== '$0') {
    console.log(`Key: "${key}" = ${JSON.stringify(value)}`);
    console.log(`  Key length: ${key.length}`);
    console.log(`  Key charCodes: ${[...key].map(c => c.charCodeAt(0)).join(',')}`);
  }
}
