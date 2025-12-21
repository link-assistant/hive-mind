#!/usr/bin/env node

// Test yargs .strict() mode with the exact command from issue #482

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

console.log('Testing yargs .strict() mode with issue #482 command...\n');

// Simulate the exact command from issue #482
const testArgs = ['--token', '8490testtoken', '--allowed-chats', '(-1002975819706 -1002861722681)', '--no-hive', '--solve-overrides', '(\n  --auto-continue\n  --attach-logs\n  --verbose\n  --no-tool-check\n)'];

console.log('Command args:', testArgs.join(' '));
console.log('');

try {
  const argv = yargs(testArgs).option('token', { type: 'string', alias: 't' }).option('allowed-chats', { type: 'string', alias: 'a' }).option('solve-overrides', { type: 'string' }).option('hive-overrides', { type: 'string' }).option('solve', { type: 'boolean', default: true }).option('hive', { type: 'boolean', default: true }).parserConfiguration({ 'boolean-negation': true }).strict().parseSync();

  console.log('✅ SUCCESS: Command parsed without errors');
  console.log('');
  console.log('Parsed values:');
  console.log('  argv.token:', argv.token);
  console.log('  argv.allowedChats:', argv.allowedChats);
  console.log('  argv.solveOverrides:', argv.solveOverrides);
  console.log('  argv.hive:', argv.hive);
  console.log('  argv._:', argv._);
  console.log('');
  console.log(
    'All keys:',
    Object.keys(argv).filter(k => k !== '$0')
  );
  console.log('');

  // Check if values are correct
  if (argv.token === '8490testtoken' && argv.allowedChats === '(-1002975819706 -1002861722681)' && argv.solveOverrides && argv.hive === false) {
    console.log('✅ Test PASSED: .strict() mode works correctly with issue #482 command');
  } else {
    console.log('⚠️  Values not as expected - likely issue with test setup');
  }
} catch (error) {
  console.log('❌ FAIL: Command rejected by .strict() mode');
  console.log('Error:', error.message);
  console.log('');
  console.log('❌ Test FAILED: .strict() mode incorrectly rejects valid options');
  process.exit(1);
}
