#!/usr/bin/env node
// Issue #2119: `"${path}"` inside a command-stream template - does the command find the file?
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream');
const file = '/tmp/quote-probe-2119-file.txt';
await $`rm -f ${file}`;
await $`sh -c ${`printf 'first-line\n' > ${file}`}`;
const quoted = await $`head -1 "${file}"`;
const bare = await $`head -1 ${file}`;
console.log(
  'head -1 "${file}":',
  JSON.stringify(quoted.stdout.toString().trimEnd()),
  'code',
  quoted.code,
  String(quoted.stderr || '')
    .trim()
    .slice(0, 120)
);
console.log('head -1  ${file} :', JSON.stringify(bare.stdout.toString().trimEnd()), 'code', bare.code);
await $`rm -f ${file}`;

// Same test with a space in the path - this is where the extra quotes leak.
const spaced = '/tmp/quote probe 2119 file.txt';
await $`rm -f ${spaced}`;
await $`sh -c ${`printf 'first-line\n' > '${spaced}'`}`;
const q2 = await $`head -1 "${spaced}"`;
const b2 = await $`head -1 ${spaced}`;
console.log(
  'spaced quoted:',
  JSON.stringify(q2.stdout.toString().trimEnd()),
  'code',
  q2.code,
  String(q2.stderr || '')
    .trim()
    .slice(0, 120)
);
console.log('spaced bare  :', JSON.stringify(b2.stdout.toString().trimEnd()), 'code', b2.code);
await $`rm -f ${spaced}`;
