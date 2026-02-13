#!/usr/bin/env node
/**
 * Experiment to understand links notation parser output structure
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const linoModule = await use('links-notation');
const LinoParser = linoModule.Parser || linoModule.default?.Parser;

const parser = new LinoParser();

// Test different config formats
const configs = ['((disk (90% reject)))', '((disk (90% reject)) (ram (65% enqueue)))', '((claude-5-hour (65% dequeue-one-at-a-time)))', '(disk (90% reject))', '(disk 90% reject)'];

for (const config of configs) {
  console.log('\n=== Config:', config, '===');
  try {
    const parsed = parser.parse(config);
    console.log('Parsed:', JSON.stringify(parsed, null, 2));
  } catch (error) {
    console.log('Error:', error.message);
  }
}
