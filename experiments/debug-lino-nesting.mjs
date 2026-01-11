#!/usr/bin/env node

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;
const parser = new LinoParser();

// Case 1: Indented list (each on its own line) - works fine without parentheses
const config1 = `LINO_LIST:
  1
  2
  3`;

console.log('=== Case 1: Indented list without explicit parentheses ===');
console.log('Input:', JSON.stringify(config1));
console.log('Parse:', JSON.stringify(parser.parse(config1), null, 2));

// Case 2: Explicit parentheses - creates nested structure
const config2 = `LINO_LIST: (
  1
  2
  3
)`;

console.log('\n=== Case 2: Explicit parentheses ===');
console.log('Input:', JSON.stringify(config2));
console.log('Parse:', JSON.stringify(parser.parse(config2), null, 2));

// Case 3: Same line in nested context
const config3 = `TELEGRAM_HIVE_OVERRIDES:
  --option1
  --option2  --option3`;

console.log('\n=== Case 3: Same line options (problematic) ===');
console.log('Input:', JSON.stringify(config3));
console.log('Parse:', JSON.stringify(parser.parse(config3), null, 2));

// Case 4: Options with explicit parentheses (should work)
const config4 = `TELEGRAM_HIVE_OVERRIDES: (
  --option1
  --option2
  --option3
)`;

console.log('\n=== Case 4: Options with explicit parentheses ===');
console.log('Input:', JSON.stringify(config4));
console.log('Parse:', JSON.stringify(parser.parse(config4), null, 2));
