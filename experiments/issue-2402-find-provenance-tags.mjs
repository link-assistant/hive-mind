#!/usr/bin/env node
// Lists string literals in src/ that carry an issue/PR provenance tag such as
// "(issue #1234)" or "(#1234)". Comments are skipped. Used for issue #2402.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = dir =>
  readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(mjs|js|lino)$/.test(name) ? [full] : [];
  });
const TAG = /\b[Ii]ssues? #\d+|\(#\d+\)|hive-mind\/issues\/\d+/;
const verboseOnly = process.argv.includes('--include-verbose');
for (const file of walk(process.argv[2] || 'src')) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const trimmed = line.trim();
      if (/^(\/\/|\*|\/\*)/.test(trimmed)) return;
      const code = line.replace(/\s\/\/ .*$/, '');
      const literal = code.match(/(['"`])(?:\\.|(?!\1).)*\1/g) || [];
      if (!literal.some(s => TAG.test(s))) return;
      const verbose = /verbose: true|\[VERBOSE\]|\{ verbose \}|level: 'debug'/.test(line);
      if (verbose && !verboseOnly) return;
      console.log(`${file}:${index + 1}${verbose ? ' [verbose]' : ''}: ${trimmed.slice(0, 200)}`);
    });
}
