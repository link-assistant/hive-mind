#!/usr/bin/env node

// Test yargs .strict() mode correctly

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing yargs .strict() mode...\n');

console.log('Test 1: Using .parse() with array of args');
try {
  const instance1 = yargs();
  const argv1 = instance1
    .option('token', { type: 'string' })
    .strict()
    .fail(false) // Disable yargs error handling to catch in our catch block
    .parse(['--invalid-option', 'value']);
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv1).filter(k => k !== '$0' && k !== '_')
  );
} catch (error) {
  const errorStr = String(error);
  if (errorStr.includes('Unknown arguments') || errorStr.includes('invalid-option')) {
    console.log('✅ PASS: Invalid option rejected');
    console.log('   Error:', error.message || errorStr);
  } else {
    console.log('⚠️  Different error:', errorStr);
  }
}

console.log('\nTest 2: Using .parseSync() with array of args');
try {
  const instance2 = yargs();
  const argv2 = instance2
    .option('token', { type: 'string' })
    .strict()
    .fail(false)
    .parseSync(['--invalid-option', 'value']);
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv2).filter(k => k !== '$0' && k !== '_')
  );
} catch (error) {
  const errorStr = String(error);
  if (errorStr.includes('Unknown arguments') || errorStr.includes('invalid-option')) {
    console.log('✅ PASS: Invalid option rejected');
    console.log('   Error:', error.message || errorStr);
  } else {
    console.log('⚠️  Different error:', errorStr);
  }
}

console.log('\nTest 3: Calling yargs as function first');
try {
  const argv3 = yargs(['--invalid-option', 'value'])
    .option('token', { type: 'string' })
    .strict()
    .fail(false)
    .parseSync();
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv3).filter(k => k !== '$0' && k !== '_')
  );
} catch (error) {
  const errorStr = String(error);
  if (errorStr.includes('Unknown arguments') || errorStr.includes('invalid-option')) {
    console.log('✅ PASS: Invalid option rejected');
    console.log('   Error:', error.message || errorStr);
  } else {
    console.log('⚠️  Different error:', errorStr);
  }
}

console.log('\nTest 4: Using .argv property');
try {
  const instance4 = yargs(['--invalid-option', 'value']);
  const config = instance4.option('token', { type: 'string' }).strict().fail(false);
  const argv4 = config.argv;
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv4).filter(k => k !== '$0' && k !== '_')
  );
} catch (error) {
  const errorStr = String(error);
  if (errorStr.includes('Unknown arguments') || errorStr.includes('invalid-option')) {
    console.log('✅ PASS: Invalid option rejected');
    console.log('   Error:', error.message || errorStr);
  } else {
    console.log('⚠️  Different error:', errorStr);
  }
}
