#!/usr/bin/env node

/**
 * Reproduce issue #2146's command-stream argv shape without starting Agent or
 * making a model request. Run with:
 *
 *   node experiments/issue-2146-agent-argv-shape.mjs
 */

if (process.argv[2] === '--print-argv') {
  process.stdout.write(`${JSON.stringify(process.argv.slice(3))}\n`);
  process.exit(0);
}

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');
const probe = new URL(import.meta.url).pathname;
const brokenArgs = '--model formalai/formal-ai --verbose';
const fixedArgs = ['--model', 'formalai/formal-ai', '--verbose'];
const commandRunner = $({ mirror: false });
const broken = await commandRunner`${process.execPath} ${probe} --print-argv ${brokenArgs}`;
const fixed = await commandRunner`${process.execPath} ${probe} --print-argv ${fixedArgs}`;

console.log('string interpolation:', broken.stdout.toString().trim());
console.log('array interpolation: ', fixed.stdout.toString().trim());
