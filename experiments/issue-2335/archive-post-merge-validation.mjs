/** Preserve the local checks repeated after merging main into the pull request. */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { sanitizeForPublication } from '../../src/token-sanitization.lib.mjs';

const logDirectory = process.argv[2] || '/tmp';
const destination = new URL('../../docs/case-studies/issue-2335/data/', import.meta.url);
const checks = [
  ['all-tests', 'npm test -- --continue-on-failure'],
  ['coverage', 'NODE_V8_COVERAGE=/tmp/issue-2335-v8-post-merge node --test --experimental-test-coverage --test-coverage-include=src/issue-completion.lib.mjs --test-coverage-include=src/issue-requirements.lib.mjs --test-coverage-include=src/pr-issue-link-repair.lib.mjs --test-coverage-include=src/solve.issue-completion.lib.mjs tests/issue-completion-2335.test.mjs'],
  ['linking', 'node --test tests/issue-linking-2335.test.mjs tests/pr-issue-link-before-merge-2395.test.mjs tests/no-changelog-in-ui-2402.test.mjs'],
  ['lint', 'npm run lint'],
  ['format', 'npm run format:check'],
  ['duplication', 'npm run check:duplication'],
  ['secrets', 'npm run check:secrets'],
  ['lines', 'bash scripts/check-file-line-limits.sh'],
  ['syntax', 'bash scripts/check-mjs-syntax.sh'],
  ['changeset', 'BASE_SHA=origin/main HEAD_SHA=HEAD node scripts/validate-changeset.mjs'],
];

const manifest = [];
let suiteFiles = null;
let coverage = null;
for (const [name, command] of checks) {
  const path = join(logDirectory, `issue-2335-post-merge-${name}.log`);
  const raw = await readFile(path, 'utf8');
  // Each runner appended the observed process status as its final line.
  const exitCode = Number(raw.match(/exit (\d+)\s*$/)?.[1]);
  if (exitCode !== 0) throw new Error(`${name} did not pass (exit ${exitCode})`);
  if (name === 'all-tests') suiteFiles = Number(raw.match(/All (\d+) selected test file\(s\) passed\./)?.[1]) || null;
  if (name === 'coverage') {
    const row = raw.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
    if (row) coverage = { lines: Number(row[1]), branches: Number(row[2]), functions: Number(row[3]) };
  }
  const content = await sanitizeForPublication(raw);
  const file = `local-post-merge-${name}.log.gz`;
  await writeFile(new URL(file, destination), gzipSync(content, { level: 9 }));
  manifest.push({ command, exitCode, file, completedAt: (await stat(path)).mtime.toISOString(), uncompressedSha256: createHash('sha256').update(content).digest('hex') });
}
if (!suiteFiles) throw new Error('The full test run has not finished successfully');
if (!coverage) throw new Error('The coverage summary is missing');

const recordUrl = new URL('validation.json', destination);
const record = JSON.parse(await readFile(recordUrl, 'utf8'));
record.postMerge = {
  collectedAt: new Date().toISOString(),
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  mergedMain: execFileSync('git', ['rev-parse', 'origin/main'], { encoding: 'utf8' }).trim(),
  node: process.version,
  defaultSuiteFiles: suiteFiles,
  focusedCoverage: { modules: record.focusedCoverage.modules, ...coverage, note: 'Measured for the focused completion modules, not whole-application coverage.' },
  logs: manifest,
};
await writeFile(recordUrl, `${JSON.stringify(record, null, 2)}\n`);
console.log(`Archived ${manifest.length} post-merge validation logs; ${suiteFiles} test files passed.`);
