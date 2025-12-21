#!/usr/bin/env node

// Test yargs initialization and parsing

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('yargs type:', typeof yargs);
console.log('yargs function?', typeof yargs === 'function');
console.log('yargs keys:', Object.keys(yargs).slice(0, 10));

// Try calling it with process.argv
console.log('\n=== Test 1: Real process.argv ===');
process.argv = ['node', 'test.js', '--token', 'mytoken123'];
const realArgv = yargs(process.argv.slice(2)).option('token', { type: 'string' }).argv;
console.log('realArgv.token:', realArgv.token);
console.log(
  'Keys:',
  Object.keys(realArgv).filter(k => k !== '_' && k !== '$0')
);

// Try without calling yargs as function
console.log('\n=== Test 2: Direct yargs usage ===');
const directArgv = yargs.option('token', { type: 'string' }).parse(['--token', 'mytoken123']);
console.log('directArgv.token:', directArgv.token);
console.log(
  'Keys:',
  Object.keys(directArgv).filter(k => k !== '_' && k !== '$0')
);
