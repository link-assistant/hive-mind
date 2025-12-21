#!/usr/bin/env node

// Test if yargs .strict() catches truly invalid options

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Test 1: Valid options - should pass');
try {
  const argv1 = yargs(['--token', 'mytoken']).option('token', { type: 'string' }).strict().parseSync();
  console.log('✅ PASS: Valid option accepted');
  console.log('   argv.token:', argv1.token);
} catch (error) {
  console.log('❌ FAIL: Valid option rejected');
  console.log('   Error:', error.message);
}

console.log('\nTest 2: Invalid option - should fail');
try {
  const argv2 = yargs(['--invalid-option', 'value']).option('token', { type: 'string' }).strict().parseSync();
  console.log('❌ FAIL: Invalid option was accepted');
  console.log('   Keys:', Object.keys(argv2));
} catch (error) {
  console.log('✅ PASS: Invalid option rejected');
  console.log('   Error:', error.message);
}

console.log('\nTest 3: Option with special character value - check behavior');
try {
  const argv3 = yargs(['--token', '(test value)']).option('token', { type: 'string' }).strict().parseSync();
  console.log('Result: Command accepted');
  console.log('   argv.token:', argv3.token);
  console.log(
    '   All keys:',
    Object.keys(argv3).filter(k => k !== '$0' && k !== '_')
  );

  // Check if yargs created extra keys
  const extraKeys = Object.keys(argv3).filter(k => k !== '$0' && k !== '_' && k !== 'token');
  if (extraKeys.length > 0) {
    console.log('⚠️  WARNING: Yargs created extra keys:', extraKeys);
  } else {
    console.log('✅ OK: No extra keys created');
  }
} catch (error) {
  console.log('❌ Command rejected');
  console.log('   Error:', error.message);
}
