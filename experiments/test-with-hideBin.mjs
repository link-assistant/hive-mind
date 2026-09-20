#!/usr/bin/env node

// Test with hideBin like the actual code

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

console.log('Testing with hideBin...\n');

// Simulate the command from issue #482
process.argv = ['node', 'hive-telegram-bot', '--token', '8490testtoken', '--allowed-chats', '(-1002975819706 -1002861722681)', '--no-hive', '--solve-overrides', '(\n  --auto-continue\n  --attach-logs\n  --verbose\n  --no-tool-check\n)'];

const argv = yargs(hideBin(process.argv)).option('token', { type: 'string', alias: 't' }).option('allowed-chats', { type: 'string', alias: 'a' }).option('solve-overrides', { type: 'string' }).option('hive-overrides', { type: 'string' }).option('solve', { type: 'boolean', default: true }).option('hive', { type: 'boolean', default: true }).parserConfiguration({ 'boolean-negation': true }).parse();

console.log('argv.token:', argv.token);
console.log('argv.allowedChats:', argv.allowedChats);
console.log('argv.solveOverrides:', argv.solveOverrides);
console.log('argv.hive:', argv.hive);
console.log('\nAll keys:', Object.keys(argv));
console.log(
  '\nFiltered keys (non-special):',
  Object.keys(argv).filter(k => k !== '_' && k !== '$0')
);
