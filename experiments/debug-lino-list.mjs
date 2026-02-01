#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;
const parser = new LinoParser();

const config = `LINO_LIST: (
  1
  2
  3
)`;

console.log('Input:');
console.log(config);
console.log('\nRaw parse:');
console.log(JSON.stringify(parser.parse(config), null, 2));
