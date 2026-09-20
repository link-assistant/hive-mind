#!/usr/bin/env node

/**
 * Issue #2198: every command in `package.json#bin` must be committed
 * executable and carry a shebang.
 *
 * Found while reproducing the `npm link` warning: `npm link` chmods its bin
 * targets, and the resulting `git status` showed `src/cleanup.mjs` and
 * `src/fix.mjs` flipping 100644 -> 100755. Both declare `#!/usr/bin/env node`
 * and both were registered as bins, but neither was committed executable, so
 * `./src/cleanup.mjs` from a fresh clone died with "Permission denied" — the
 * exact invocation style release.yml uses for the other bins
 * (`timeout 10s ./src/solve.mjs --help`).
 *
 * Nothing caught it because the only guard, the `build:pre` script, is
 * unreferenced — no workflow, script or npm lifecycle hook runs it — and its
 * hand-maintained list had drifted to 5 of the 10 declared bins. A dead step
 * that looks like coverage is worse than no step, so this test pins both
 * halves: the file modes that actually ship, and the list staying in sync.
 *
 * Modes are read from the index rather than the working tree: a working-tree
 * chmod is what npm does to a clone, and it would mask the committed mode.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('=== Issue #2198 — every declared bin ships executable ===\n');

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const bins = Object.entries(pkg.bin ?? {});

assert(bins.length > 0, 'package.json declares bin commands');

// `git ls-files -s` prints the mode recorded in the index, e.g.
//   100755 <sha> 0\tsrc/solve.mjs
const indexModes = new Map(
  spawnSync('git', ['ls-files', '-s', '--', 'src'], { cwd: repoRoot, encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)
    .map(line => {
      const [meta, path] = line.split('\t');
      return [path, meta.split(' ')[0]];
    })
);

for (const [command, target] of bins) {
  const relative = target.replace(/^\.\//, '');
  const mode = indexModes.get(relative);

  assert(mode !== undefined, `bin "${command}" -> ${relative} is tracked by git`);
  assert(mode === '100755', `bin "${command}" -> ${relative} is committed executable (index mode is ${mode}, expected 100755)`);

  const firstLine = readFileSync(join(repoRoot, relative), 'utf8').split('\n', 1)[0];
  assert(firstLine.startsWith('#!'), `bin "${command}" -> ${relative} starts with a shebang (found ${JSON.stringify(firstLine.slice(0, 40))})`);
}

// The `build:pre` helper exists to restore those bits by hand; keep its list
// from drifting away from the bin map again.
const buildPre = pkg.scripts?.['build:pre'] ?? '';
for (const [command, target] of bins) {
  const relative = target.replace(/^\.\//, '');
  assert(buildPre.includes(`chmod +x ${relative}`), `build:pre marks ${relative} executable (bin "${command}")`);
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
