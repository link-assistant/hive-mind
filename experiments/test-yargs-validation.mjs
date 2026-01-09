#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

// Import hive config
const { createYargsConfig: createHiveYargsConfig } = await import('../src/hive.config.lib.mjs');

// Test options
const testCases = [
  ['https://github.com/test/test', '--auto-resume-on-limit-reset', '--tokens-budget-stats'],  // Valid
  ['https://github.com/test/test', '--auto-resume-on-limit-reset?', '--tokens-budget-stats'], // Invalid (?)
  ['https://github.com/test/test', '--unknown-option', '--tokens-budget-stats'],              // Invalid (unknown)
];

for (let i = 0; i < testCases.length; i++) {
  const testArgs = testCases[i];
  console.log(`\n=== Test ${i + 1} ===`);
  console.log('Args:', testArgs.join(' '));

  try {
    const testYargs = createHiveYargsConfig(yargs());
    testYargs
      .exitProcess(false)
      .showHelpOnFail(false)
      .fail((msg, err) => {
        if (err) throw err;
        throw new Error(msg);
      });

    // Suppress stderr
    const originalStderrWrite = process.stderr.write;
    process.stderr.write = () => true;

    try {
      await testYargs.parse(testArgs);
      console.log('Result: PASS (no error)');
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  } catch (error) {
    console.log('Result: FAIL');
    console.log('Error:', error.message);
  }
}
