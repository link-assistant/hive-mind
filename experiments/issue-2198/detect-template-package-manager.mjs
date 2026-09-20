#!/usr/bin/env node
/**
 * Issue #2198 — reproduce the package-manager misdetection that broke this
 * repository's release job, against an arbitrary checkout.
 *
 * `@changesets/cli` 3.x formats what it rewrites through `@changesets/format`,
 * which asks `package-manager-detector` which agent to shell out to and then
 * runs `<agent> x prettier ...`. The detector's default strategy order puts
 * `lockfile` first, and its LOCKS table is probed in insertion order:
 *
 *   aube-lock.yaml, aube-workspace.yaml, bun.lock, bun.lockb, deno.lock,
 *   nub.lock, pnpm-lock.yaml, pnpm-workspace.yaml, yarn.lock,
 *   package-lock.json, npm-shrinkwrap.json
 *
 * so *any* of the first nine beats `package-lock.json`. The only thing that
 * overrides the table is a `packageManager` or `devEngines.packageManager`
 * field in package.json, which the detector reads once a lockfile matches.
 *
 * Usage: node experiments/issue-2198/detect-template-package-manager.mjs [dir]
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { detect, LOCKS } from 'package-manager-detector';

const cwd = path.resolve(process.argv[2] ?? process.cwd());

const pkgPath = path.join(cwd, 'package.json');
const pkg = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')) : {};

const present = Object.keys(LOCKS).filter(lock => existsSync(path.join(cwd, lock)));

console.log(`checkout:              ${cwd}`);
console.log(`lockfiles (in probe order): ${present.join(', ') || '(none)'}`);
console.log(`packageManager:        ${pkg.packageManager ?? '(unset)'}`);
console.log(`devEngines.packageManager: ${JSON.stringify(pkg.devEngines?.packageManager) ?? '(unset)'}`);
console.log(`@changesets/cli:       ${pkg.devDependencies?.['@changesets/cli'] ?? pkg.dependencies?.['@changesets/cli'] ?? '(absent)'}`);

const detected = await detect({ cwd });
console.log(`detect() =>            ${JSON.stringify(detected)}`);
console.log(`changeset version would spawn: ${detected?.agent ?? '(nothing)'} x prettier`);

const declares = Boolean(pkg.packageManager || pkg.devEngines?.packageManager);
if (!declares && present[0] && LOCKS[present[0]] !== 'npm') {
  console.log('');
  console.log(`VERDICT: misdetected as "${LOCKS[present[0]]}" because ${present[0]} is probed`);
  console.log('         before package-lock.json and package.json declares no package manager.');
  console.log('         On a GitHub runner without that agent installed, @changesets/format');
  console.log(`         dies with: Error: spawn ${LOCKS[present[0]]} ENOENT`);
  process.exitCode = 1;
} else {
  console.log('');
  console.log('VERDICT: package manager resolves correctly.');
}
