#!/usr/bin/env node

// Test yargs positional arguments with .command() and .parse()

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing yargs positional arguments with .parse()\n');

const testArgs = ['https://github.com/test/test/issues/1', '--dry-run', '--skip-tool-check'];

console.log('Test args:', testArgs);
console.log('');

console.log('Test 1: Using .command() with positional');
try {
  const argv1 = yargs()
    .command('$0 <url>', 'Test command', yargs => {
      yargs.positional('url', {
        type: 'string',
        description: 'URL argument',
        demandOption: true,
      });
    })
    .option('dry-run', { type: 'boolean' })
    .option('skip-tool-check', { type: 'boolean' })
    .strict()
    .parse(testArgs);

  console.log('✅ SUCCESS');
  console.log('   argv.url:', argv1.url);
  console.log('   argv.dryRun:', argv1.dryRun);
  console.log('   argv._:', argv1._);
  console.log('');
} catch (error) {
  console.log('❌ FAIL:', error.message);
  console.log('');
}

console.log('Test 2: Without .command(), just checking argv._');
try {
  const argv2 = yargs().option('dry-run', { type: 'boolean' }).option('skip-tool-check', { type: 'boolean' }).strict().parse(testArgs);

  console.log('✅ Parsed');
  console.log('   argv._:', argv2._);
  console.log('   argv._[0]:', argv2._[0]);
  console.log('');
} catch (error) {
  console.log('❌ FAIL:', error.message);
  console.log('');
}
