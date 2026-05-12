#!/usr/bin/env node

// Compare .argv vs .parse() behavior with .strict()

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Comparing .argv vs .parse() with .strict() mode\n');

const testArgs = ['--invalid-option', 'value'];

console.log('Test 1: Using yargs().parse(args) with .strict()');
try {
  const instance1 = yargs();
  instance1
    .option('token', { type: 'string' })
    .strict()
    .fail((msg, err, yargs) => {
      throw new Error(msg);
    });
  const argv1 = instance1.parse(testArgs);
  console.log('❌ FAIL: Invalid option was accepted\n');
} catch (error) {
  console.log('✅ PASS: Invalid option rejected');
  console.log('   Error:', error.message, '\n');
}

console.log('Test 2: Using yargs(args).strict().argv');
try {
  const instance2 = yargs(testArgs)
    .option('token', { type: 'string' })
    .strict()
    .fail((msg, err, yargs) => {
      throw new Error(msg);
    });
  const argv2 = instance2.argv;
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv2).filter(k => k !== '$0' && k !== '_'),
    '\n'
  );
} catch (error) {
  console.log('✅ PASS: Invalid option rejected');
  console.log('   Error:', error.message, '\n');
}

console.log('Test 3: Using yargs(args).strict().parseSync()');
try {
  const instance3 = yargs(testArgs)
    .option('token', { type: 'string' })
    .strict()
    .fail((msg, err, yargs) => {
      throw new Error(msg);
    });
  const argv3 = instance3.parseSync();
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv3).filter(k => k !== '$0' && k !== '_'),
    '\n'
  );
} catch (error) {
  console.log('✅ PASS: Invalid option rejected');
  console.log('   Error:', error.message, '\n');
}

console.log('Test 4: Using yargs(args).strict().parse()');
try {
  const instance4 = yargs(testArgs)
    .option('token', { type: 'string' })
    .strict()
    .fail((msg, err, yargs) => {
      throw new Error(msg);
    });
  const argv4 = instance4.parse();
  console.log('❌ FAIL: Invalid option was accepted');
  console.log(
    '   Keys:',
    Object.keys(argv4).filter(k => k !== '$0' && k !== '_'),
    '\n'
  );
} catch (error) {
  console.log('✅ PASS: Invalid option rejected');
  console.log('   Error:', error.message, '\n');
}
