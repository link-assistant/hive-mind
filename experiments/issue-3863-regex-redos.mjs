// Times parseDependencyLine on the CodeQL "inefficient regular expression"
// input (strings starting with `0>!,` repeating `<=!,`) and on normal lines.
// Before the fix, 20 repetitions followed by `"x"` took ~360ms and every
// extra repetition doubled it; after the fix it is linear.
import { parseDependencyLine } from '../src/fix.dependabot-superseded.lib.mjs';

const inputs = ['0>!,' + '<=!,'.repeat(40) + '"x"', '0>!,' + '<=!,'.repeat(40) + '#', 'x>=1' + ',<=1'.repeat(5000) + ' "', 'numpy==2.2.6', 'mypy>=1.13.0,<3.0', '"torch>=2.0, <3",', 'pkg[extra] >= 1.0 ; python_version<"3.9"'];
for (const input of inputs) {
  const started = Date.now();
  const result = parseDependencyLine(input);
  console.log(`${Date.now() - started}ms`, JSON.stringify(input.slice(0, 40)), JSON.stringify(result));
}
