#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

const yargsInstance = yargs(['--invalid', '--fork'])
  .option('fork', {
    type: 'boolean',
    description: 'Fork the repository',
    alias: 'f',
    default: false
  })
  .option('verbose', {
    type: 'boolean',
    description: 'Enable verbose logging',
    alias: 'v',
    default: false
  });

const argv = yargsInstance.argv;

console.log('argv:', JSON.stringify(argv, null, 2));
console.log('\nparsed.aliases:', JSON.stringify(yargsInstance.parsed.aliases, null, 2));

const aliases = yargsInstance.parsed.aliases;
const knownOptions = new Set(['_', '$0']);

Object.keys(aliases).forEach(key => {
  console.log(`Adding key: ${key}, aliases: ${JSON.stringify(aliases[key])}`);
  knownOptions.add(key);
  if (Array.isArray(aliases[key])) {
    aliases[key].forEach(alias => knownOptions.add(alias));
  }
});

console.log('\nknownOptions:', Array.from(knownOptions));
console.log('\nargv keys:', Object.keys(argv));
console.log(
  '\nUnknown options:',
  Object.keys(argv).filter(k => !knownOptions.has(k) && k !== '_' && k !== '$0')
);
