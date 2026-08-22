#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const config = await import('../src/solve.config.lib.mjs');
const { initializeConfig, DEFINED_OPTIONS } = config;

const { yargs, hideBin } = await initializeConfig(use);

const args = ['https://github.com/test/test/issues/1', '--dry-run'];
const argv = yargs(args).argv;

console.log('Input args:', args);
console.log('Parsed argv:', JSON.stringify(argv, null, 2));
console.log('Argv keys:', Object.keys(argv));
console.log('DEFINED_OPTIONS has https://github:', DEFINED_OPTIONS.has('https://github'));
