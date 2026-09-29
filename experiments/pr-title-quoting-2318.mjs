#!/usr/bin/env node
// Issue #2318: does command-stream's `$` add literal quotes to a `--title` value?
// Run with a fake `gh` first on PATH that prints its argv as JSON.
if (typeof globalThis.use === 'undefined') globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream');
const titles = ['Implement Hello World in Kotlin', "It's a title", 'Title with "double" quotes', 'Title $(whoami) `x`'];
for (const title of titles) {
  const result = await $({ mirror: false })`gh pr edit 2 --repo o/r --title ${title}`;
  const argv = JSON.parse(result.stdout.toString().trim());
  console.log(JSON.stringify(title), '->', JSON.stringify(argv[argv.indexOf('--title') + 1]), argv[argv.indexOf('--title') + 1] === title ? 'OK' : 'MISMATCH');
}

// The July 2026 (v2.10.3) form: an interpolation wrapped in double quotes.
const legacyTitle = 'Implement Hello World in Kotlin';
const legacy = await $({ mirror: false })`gh pr edit 2 --repo o/r --title "${legacyTitle}"`;
const legacyArgv = JSON.parse(legacy.stdout.toString().trim());
console.log('legacy "${title}" form ->', JSON.stringify(legacyArgv[legacyArgv.indexOf('--title') + 1]));
