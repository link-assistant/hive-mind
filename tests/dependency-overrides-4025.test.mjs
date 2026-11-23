#!/usr/bin/env node
/**
 * npm overrides must stay stable across npm majors (issue #4025).
 *
 * A version-ranged override key such as `"minimatch@>=7.0.0 <11.0.1"` is
 * resolved differently by npm 10 (the CI runner's npm) and npm 11: running
 * `npm update --package-lock-only` with npm 10.9.4 added a nested
 * `node_modules/@eslint/config-array/node_modules/minimatch` at 10.2.6, so the
 * dependency freshness gate reported the lockfile as stale on every run
 * (Checks and release run 42608795713). A bare package-name key behaves the
 * same under both majors.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));

for (const key of Object.keys(pkg.overrides ?? {})) {
  assert.doesNotMatch(key.replace(/^@/, ''), /@/, `override key "${key}" must be a bare package name; npm 10 and 11 resolve ranged keys differently`);
}

assert.match(pkg.overrides?.minimatch ?? '', /^\^(\d+)\./, 'minimatch is overridden to a patched line (GHSA-g3hv-75wg-m249, Dependabot alert #9)');

const minimatchCopies = Object.entries(lock.packages)
  .filter(([path]) => path === 'node_modules/minimatch' || path.endsWith('/node_modules/minimatch'))
  .map(([path, entry]) => ({ path, version: entry.version }));
assert.deepEqual(
  minimatchCopies.map(copy => copy.path),
  ['node_modules/minimatch'],
  `the lockfile holds a single minimatch, got ${JSON.stringify(minimatchCopies)}`
);
const [major, minor, patch] = minimatchCopies[0].version.split('.').map(Number);
assert.ok(major > 11 || (major === 11 && (minor > 0 || patch >= 5)), `minimatch ${minimatchCopies[0].version} is at least the patched 11.0.5`);

console.log('dependency-overrides-4025.test.mjs: all assertions passed');
