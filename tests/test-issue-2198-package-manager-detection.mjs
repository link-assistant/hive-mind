#!/usr/bin/env node

/**
 * Issue #2198: the release job died with `Error: spawn bun ENOENT`.
 *
 * `@changesets/cli` 3.x (adopted in #2189) formats every file it rewrites via
 * `@changesets/format`, which resolves a package manager and shells out to it:
 *
 *   node_modules/@changesets/format/dist/index.js
 *     const packageManager = (await detect({ ... }))?.agent ?? "npm";
 *     const cmd = resolveCommand(packageManager, "execute-local", args);
 *     await exec(cmd.command, cmd.args, { ... });
 *
 * `detect()` tries lockfiles first, and its LOCKS table probes `bun.lock`
 * before `package-lock.json`. This repository carried a `bun.lock` committed in
 * 5e059ea1 that nothing ever installed from, and declared no package manager —
 * so the runner resolved `bun x prettier` and bun is not on GitHub runners.
 *
 * Reproduced before the fix by `node scripts/check-package-manager.mjs`, which
 * reported both halves: no declaration, and two competing lockfiles.
 *
 * This test pins the repository state so the failure cannot come back, and the
 * detection rules so the guard itself keeps working.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { LOCKFILE_AGENTS, detectAgentFromLockfiles, readDeclaredAgent, inspectPackageManager } from '../scripts/check-package-manager.lib.mjs';

console.log('=== Issue #2198 — release must not resolve a package manager that is not installed ===\n');

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');

console.log('1. The probe order that made bun win\n');

const lockOrder = Object.keys(LOCKFILE_AGENTS);
assert(lockOrder.indexOf('bun.lock') < lockOrder.indexOf('package-lock.json'), 'bun.lock is probed before package-lock.json — the reason a stray bun lockfile decided the release job (mirrors package-manager-detector LOCKS)');
assert(detectAgentFromLockfiles(['bun.lock', 'package-lock.json']) === 'bun', 'with both lockfiles present and nothing else to go on, detection returns bun');
assert(detectAgentFromLockfiles(['package-lock.json']) === 'npm', 'package-lock.json alone returns npm');
assert(detectAgentFromLockfiles([]) === null, 'no lockfile means no lockfile-based answer');

console.log('\n2. A declaration overrides the lockfile guess\n');

assert(readDeclaredAgent({ packageManager: 'npm@11.0.0' }) === 'npm', 'the `packageManager` field is read, version stripped');
assert(readDeclaredAgent({ devEngines: { packageManager: { name: 'npm' } } }) === 'npm', '`devEngines.packageManager.name` is read');
assert(readDeclaredAgent({ packageManager: 'pnpm@9', devEngines: { packageManager: { name: 'npm' } } }) === 'pnpm', '`packageManager` wins over `devEngines`, exactly as package-manager-detector resolves it');
assert(readDeclaredAgent({}) === null, 'no declaration is reported as none');

console.log('\n3. The guard reports the state that broke the release\n');

const broken = inspectPackageManager({
  files: ['package.json', 'package-lock.json', 'bun.lock'],
  packageJson: { name: 'hive-mind' },
});
assert(broken.lockfileAgent === 'bun', 'the pre-fix tree resolves to bun');
assert(
  broken.problems.some(problem => problem.kind === 'missing-declaration'),
  'the missing package manager declaration is reported'
);
assert(
  broken.problems.some(problem => problem.kind === 'ambiguous-lockfiles'),
  'the competing lockfiles are reported'
);

const declaredButStale = inspectPackageManager({
  files: ['package.json', 'package-lock.json', 'bun.lock'],
  packageJson: { devEngines: { packageManager: { name: 'npm' } } },
});
assert(declaredButStale.foreignLockfiles.join(',') === 'bun.lock', 'with npm declared, only bun.lock is foreign — package-lock.json is the right one to keep');
assert(
  declaredButStale.problems.every(problem => problem.kind === 'foreign-lockfile'),
  'a declared manager silences the declaration and ambiguity problems'
);

const fixed = inspectPackageManager({
  files: ['package.json', 'package-lock.json'],
  packageJson: { devEngines: { packageManager: { name: 'npm' } } },
});
assert(fixed.problems.length === 0, 'a declared manager with only its own lockfile is clean');

console.log('\n4. This repository is in the fixed state\n');

const rootFiles = readdirSync(repoRoot, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name);
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const actual = inspectPackageManager({ files: rootFiles, packageJson });

assert(actual.declared === 'npm', `package.json declares npm as the package manager (got ${actual.declared ?? '<none>'})`);
assert(actual.problems.length === 0, `the repository root has no package manager problems${actual.problems.length ? `:\n    - ${actual.problems.map(problem => problem.message).join('\n    - ')}` : ''}`);
assert(!rootFiles.includes('bun.lock'), 'the stale bun.lock is gone — nothing in this repository ever installed from it (only `bun install -g <published package>` in the Dockerfiles)');

console.log('\n5. The real detector agrees (fidelity check against the installed dependency)\n');

let detect;
try {
  ({ detect } = await import('package-manager-detector'));
} catch {
  console.log('   package-manager-detector is not installed — skipping (the pure checks above already pin the rules)');
}

if (detect) {
  const detected = await detect({ cwd: repoRoot });
  assert(detected?.agent === 'npm', `the package manager @changesets/format would spawn is npm (got ${detected?.agent ?? 'null'})`);
}

printSummary('Issue #2198 — package manager detection');
process.exit(getFailCount() > 0 ? 1 : 0);
