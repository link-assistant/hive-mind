#!/usr/bin/env node
// Search the extracted Claude Code bundle text for a needle and print surrounding context.
import fs from 'node:fs';
const [, , file, needle, radiusArg, maxArg] = process.argv;
const radius = Number(radiusArg || 400);
const max = Number(maxArg || 10);
const text = fs.readFileSync(file, 'utf8');
let i = 0,
  n = 0;
while ((i = text.indexOf(needle, i)) !== -1 && n < max) {
  console.log(`--- match ${++n} @${i} ---`);
  console.log(text.slice(Math.max(0, i - radius), i + needle.length + radius));
  i += needle.length;
}
if (n === 0) console.log('no matches');
