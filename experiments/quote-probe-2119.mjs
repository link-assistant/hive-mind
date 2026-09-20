#!/usr/bin/env node
// Issue #2119: how does command-stream quote interpolated values in each context?
import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
const use = await ensureUseM();
const { $ } = await use('command-stream');
const v = 'Hello World';
const path = '/tmp/quote probe 2119.txt';

const cases = {
  'double-quoted   "${v}"': await $`echo "${v}"`,
  'bare             ${v} ': await $`echo ${v}`,
  "single-quoted   '${v}'": await $`echo '${v}'`,
  'inside jq-ish  --arg \'x == "${v}"\'': await $`echo 'x == "${v}"'`,
};
for (const [k, r] of Object.entries(cases)) console.log(k.padEnd(38), JSON.stringify(r.stdout.toString().trimEnd()));

// A path with a space must survive bare interpolation.
await $`rm -f ${path}`;
const w = await $`touch ${path}`;
const ls = await $`ls -1 ${path}`;
console.log('bare path with space:'.padEnd(38), w.code, JSON.stringify(ls.stdout.toString().trimEnd()));
await $`rm -f ${path}`;

// The jq-inside-single-quotes form used by the fork lookups: does it still match?
const login = 'konard';
const broken = await $`echo '{"owner":{"login":"konard"},"full_name":"konard/x"}' | jq -r 'select(.owner.login == "${login}") | .full_name'`;
console.log('jq select with "${login}":'.padEnd(38), JSON.stringify(broken.stdout.toString().trimEnd()), 'code', broken.code, (broken.stderr || '').toString().trim().slice(0, 120));
