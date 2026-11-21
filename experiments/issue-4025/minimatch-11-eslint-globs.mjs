#!/usr/bin/env node
// Issue #4025: minimatch is overridden to 11.x (GHSA-g3hv-75wg-m249, fixed only
// in 11.0.1). eslint calls only `new Minimatch(pattern, opts).match(path, partial)`.
// This compares minimatch 10 and 11 on every glob in eslint.config.mjs against
// every tracked file, with eslint's options, and prints any difference.
// Usage: node experiments/issue-4025/minimatch-11-eslint-globs.mjs <path-to-minimatch-10>
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const mm11 = require('minimatch');
const mm10 = createRequire(process.argv[2] + '/')('minimatch');
const config = readFileSync(new URL('../../eslint.config.mjs', import.meta.url), 'utf8');
const patterns = [...new Set([...config.matchAll(/'([^']*[*/][^']*)'/g)].map(m => m[1]).filter(p => !p.includes(' ')))];
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n');
const options = { dot: true, allowWindowsEscape: true };
let differences = 0;
for (const pattern of patterns) {
  const a = new mm10.Minimatch(pattern, options);
  const b = new mm11.Minimatch(pattern, options);
  for (const file of files) {
    if (a.match(file) !== b.match(file)) {
      differences++;
      console.log(`DIFF ${pattern} ${file}: 10=${a.match(file)} 11=${b.match(file)}`);
    }
  }
}
console.log(`minimatch ${mm10 === mm11 ? '(same module!)' : '10 vs 11'}: ${patterns.length} patterns x ${files.length} files, ${differences} differences`);
