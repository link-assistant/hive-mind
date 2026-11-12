#!/usr/bin/env node
/**
 * Refuse an npm tarball the public registry would reject with E413 (issue #4050).
 *
 * npm documents no publish size limit. The budget sits inside the range the
 * registry is known to accept: @openai/codex@0.164.0-linux-x64 (165,142,849
 * bytes) was published, while @link-assistant/hive-mind@2.40.0 (249,485,829
 * bytes, both native Codex platforms in one tarball) was refused three times
 * with "E413 413 Payload Too Large" after ~87 s per upload attempt. Failing
 * locally takes seconds and says which file to move out of the tarball.
 *
 * Usage:
 *   npm pack --dry-run --json | node scripts/check-npm-tarball-size.mjs --stdin
 *   node scripts/check-npm-tarball-size.mjs <archive.tgz>...
 *   HIVE_MIND_NPM_TARBALL_BUDGET_BYTES=<n> overrides the budget (tests only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const NPM_TARBALL_BUDGET_BYTES = 157 * 1024 * 1024;

const mib = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/** Entries are `npm pack --json` objects or `{ filename, size }` for archives on disk. */
export function findOversizedTarballs(entries, budget = NPM_TARBALL_BUDGET_BYTES) {
  return entries.filter(entry => !Number.isSafeInteger(entry.size) || entry.size > budget);
}

/** The largest files of an oversized `npm pack --json` entry, the ones to move out. */
export function largestFiles(entry, count = 5) {
  return [...(entry.files || [])].sort((a, b) => b.size - a.size).slice(0, count);
}

export function formatOversizedReport(oversized, budget = NPM_TARBALL_BUDGET_BYTES) {
  return oversized
    .map(entry => {
      const label = entry.name ? `${entry.name}@${entry.version}` : entry.filename;
      const size = Number.isSafeInteger(entry.size) ? `${entry.size} bytes (${mib(entry.size)})` : 'an unknown size';
      const lines = [`::error title=npm tarball over the publish budget::${label} is ${size}; the budget is ${budget} bytes (${mib(budget)}). npm rejects oversized uploads with E413 (issue #4050).`];
      for (const file of largestFiles(entry)) lines.push(`  ${file.path}: ${file.size} bytes`);
      lines.push('  Move large native payloads into per-platform packages; see docs/NATIVE-CODEX-PACKAGES.md.');
      return lines.join('\n');
    })
    .join('\n');
}

const budgetFromEnv = () => {
  const raw = process.env.HIVE_MIND_NPM_TARBALL_BUDGET_BYTES;
  if (!raw) return NPM_TARBALL_BUDGET_BYTES;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`HIVE_MIND_NPM_TARBALL_BUDGET_BYTES must be a positive integer, received ${JSON.stringify(raw)}`);
  return value;
};

/** Returns the process exit code. */
export function checkNpmTarballSizes(entries, { budget = NPM_TARBALL_BUDGET_BYTES, log = console.log, error = console.error } = {}) {
  if (!entries.length) {
    error('::error title=npm tarball size check::No tarball was given to check.');
    return 1;
  }
  const oversized = findOversizedTarballs(entries, budget);
  if (oversized.length) {
    error(formatOversizedReport(oversized, budget));
    return 1;
  }
  for (const entry of entries) log(`${entry.name ? `${entry.name}@${entry.version}` : entry.filename}: ${entry.size} bytes (${mib(entry.size)}) within the ${mib(budget)} npm publish budget.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const entries = args.includes('--stdin') ? [].concat(JSON.parse(fs.readFileSync(0, 'utf8'))) : args.map(file => ({ filename: file, size: fs.statSync(file).size }));
  process.exitCode = checkNpmTarballSizes(entries, { budget: budgetFromEnv() });
}
