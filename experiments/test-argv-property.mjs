#!/usr/bin/env node

// Test using .argv property instead of .parse()

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

console.log('Testing with .argv property instead of .parse()...\n');

// Simulate the command from issue #482
process.argv = [
  'node',
  'hive-telegram-bot',
  '--token',
  '8490testtoken',
  '--allowed-chats',
  '(-1002975819706 -1002861722681)'
];

const instance = yargs(hideBin(process.argv))
  .option('token', { type: 'string', alias: 't' })
  .option('allowed-chats', { type: 'string', alias: 'a' });

// Try .argv
console.log('=== Using .argv ===');
const argv1 = instance.argv;
console.log('argv.token:', argv1.token);
console.log('argv.allowedChats:', argv1.allowedChats);
console.log(
  'Keys with values:',
  Object.entries(argv1).filter(([k, v]) => v !== undefined && k !== '_' && k !== '$0')
);

// Try .parseSync()
console.log('\n=== Using .parseSync() ===');
const argv2 = yargs(hideBin(process.argv))
  .option('token', { type: 'string', alias: 't' })
  .option('allowed-chats', { type: 'string', alias: 'a' })
  .parseSync();
console.log('argv.token:', argv2.token);
console.log('argv.allowedChats:', argv2.allowedChats);
console.log(
  'Keys with values:',
  Object.entries(argv2).filter(([k, v]) => v !== undefined && k !== '_' && k !== '$0')
);
