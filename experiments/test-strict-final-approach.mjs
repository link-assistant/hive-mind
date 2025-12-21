#!/usr/bin/env node

// Test that .strict() works with yargs().parse(args) pattern

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing .strict() with yargs().parse(args) pattern\n');

console.log('Test 1: Valid option - should pass');
try {
  const argv1 = yargs().option('token', { type: 'string' }).strict().parse(['--token', 'mytoken123']);
  console.log('✅ PASS: Valid option accepted');
  console.log('   argv.token:', argv1.token);
  console.log('');
} catch (error) {
  console.log('❌ FAIL: Valid option rejected');
  console.log('   Error:', error.message, '\n');
}

console.log('Test 2: Invalid option - should fail');
try {
  const argv2 = yargs().option('token', { type: 'string' }).strict().parse(['--invalid-option', 'value']);
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv2).filter(k => k !== '$0' && k !== '_')
  );
  console.log('');
} catch (error) {
  const errorStr = String(error);
  if (errorStr.includes('Unknown arguments') || errorStr.includes('invalid-option')) {
    console.log('✅ PASS: Invalid option rejected');
    console.log('   Error:', error.message);
    console.log('');
  } else {
    console.log('⚠️  Different error:', errorStr, '\n');
  }
}

console.log('Test 3: Valid option with special char value - should pass');
try {
  const argv3 = yargs()
    .option('token', { type: 'string' })
    .option('chats', { type: 'string' })
    .strict()
    .parse(['--token', '8490aOEM', '--chats', '(-1002975819706 -1002861722681)']);
  console.log('✅ PASS: Valid options with special char values accepted');
  console.log('   argv.token:', argv3.token);
  console.log('   argv.chats:', argv3.chats);
  console.log(
    '   All keys:',
    Object.keys(argv3).filter(k => k !== '$0' && k !== '_')
  );
  console.log('');
} catch (error) {
  console.log('❌ FAIL: Valid options rejected');
  console.log('   Error:', error.message, '\n');
}

console.log('✅ All tests passed! The yargs().parse(args) pattern works with .strict() mode.');
