#!/usr/bin/env node

/**
 * CI guard: the repository root must not disagree with itself about which
 * package manager installs it.
 *
 * Usage:
 *   node scripts/check-package-manager.mjs [projectRoot]
 *
 * Exit code 0 = consistent; 1 = at least one problem, reported as a GitHub
 * Actions error annotation.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2198
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { inspectPackageManager } from './check-package-manager.lib.mjs';

const projectRoot = resolve(process.argv[2] ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));

const files = readdirSync(projectRoot, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name);

const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));

const report = inspectPackageManager({ files, packageJson });

console.log(`Project root:      ${projectRoot}`);
console.log(`Declared manager:  ${report.declared ?? '<none>'}`);
console.log(`Lockfile suggests: ${report.lockfileAgent ?? '<none>'}`);

if (report.problems.length === 0) {
  console.log('\nPackage manager declaration and lockfiles agree.');
  process.exit(0);
}

console.error('');
for (const problem of report.problems) {
  const location = problem.file ? `file=${problem.file}::` : '';
  console.error(`::error ${location}${problem.message}`);
}
console.error(`\n${report.problems.length} package manager problem(s) found.`);
process.exit(1);
