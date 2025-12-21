#!/usr/bin/env node

// Simpler test to understand yargs behavior

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing yargs behavior with string options...\n');

// Test with a simple string option
const testArgs = ['--token', 'mytoken123', '--name', 'John Doe'];

const argv = yargs(testArgs)
  .option('token', {
    type: 'string',
    description: 'Token value'
  })
  .option('name', {
    type: 'string',
    description: 'Name value'
  })
  .parse();

console.log('Input args:', testArgs);
console.log('\nParsed argv (full):', argv);
console.log('\nAll keys in argv:', Object.keys(argv));
console.log('\nargv.token:', argv.token);
console.log('argv.name:', argv.name);
console.log('argv._:', argv._);

// Check if yargs is adding extra keys
const extraKeys = Object.keys(argv).filter(key => key !== '_' && key !== '$0' && key !== 'token' && key !== 'name');
console.log('\nExtra keys added by yargs:', extraKeys);
