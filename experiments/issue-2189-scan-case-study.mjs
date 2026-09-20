#!/usr/bin/env node

/**
 * Fail-closed credential scan of the committed case-study artifacts (#2189).
 *
 * The incident log came from a private repository and its own run reported 591
 * masked tokens, so everything extracted from it into
 * `docs/case-studies/issue-2189/` has to be provably clean before it is
 * committed. The repo has no `.secretlintrc`, because it drives secretlint
 * programmatically through `sanitizeForPublication`; this script applies that
 * same fail-closed scan, streamed block by block so it stays bounded no matter
 * how large an artifact gets.
 *
 * Usage: node experiments/issue-2189-scan-case-study.mjs [directory]
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findResidualCredentialBlock } from '../src/log-sanitize-stream.lib.mjs';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] || path.join(repoRoot, 'docs/case-studies/issue-2189'));

const walk = async dir => {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
};

// The scan's own report lands inside the scanned folder and quotes the very
// lines it flagged, so including it would re-flag those quotes and nest one
// level deeper on every regeneration. It is excluded by name.
const SELF_OUTPUT = path.join(target, 'logs', 'credential-scan.log');

const files = (await walk(target)).filter(file => file !== SELF_OUTPUT);
console.log(`scanning ${files.length} file(s) under ${path.relative(repoRoot, target)}`);
console.log(`(excluding this report itself: ${path.relative(repoRoot, SELF_OUTPUT)})\n`);

/**
 * Show every place the sanitizer would rewrite a file, so each hit can be
 * adjudicated instead of taken on trust.
 *
 * @param {string} filePath - File to diff
 * @returns {Promise<string[]>} Human-readable divergence descriptions
 */
const describeDivergences = async filePath => {
  const raw = await fs.readFile(filePath, 'utf8');
  const sanitized = String(await sanitizeForPublication(raw));
  if (sanitized === raw) return [];
  const rawLines = raw.split('\n');
  const sanitizedLines = sanitized.split('\n');
  const found = [];
  for (let i = 0; i < Math.max(rawLines.length, sanitizedLines.length); i++) {
    if (rawLines[i] === sanitizedLines[i]) continue;
    let col = 0;
    while (rawLines[i]?.[col] === sanitizedLines[i]?.[col]) col += 1;
    const from = Math.max(0, col - 50);
    found.push(`line ${i + 1} col ${col}\n       raw: ${JSON.stringify(rawLines[i].slice(from, col + 60))}\n       san: ${JSON.stringify(sanitizedLines[i].slice(from, col + 60))}`);
  }
  return found;
};

let residuals = 0;
for (const file of files) {
  const { size } = await fs.stat(file);
  const residual = await findResidualCredentialBlock(file);
  const relative = path.relative(repoRoot, file);
  if (!residual) {
    console.log(`✅ ${relative} (${size} bytes)`);
    continue;
  }
  residuals += 1;
  console.log(`❗ ${relative} (${size} bytes) — sanitizer would rewrite block ${residual.blockIndex}:`);
  for (const divergence of await describeDivergences(file)) console.log(`     ${divergence}`);
}

console.log(`\n${files.length} file(s) scanned, ${residuals} with sanitizer rewrites.`);
console.log('Every rewrite must be adjudicated by a human: `sanitizeForPublication` is deliberately');
console.log('keyword-proximal, so prose such as `...token: a partial line` or a path containing');
console.log('`secret` is rewritten even though it carries no credential material.');
process.exit(0);
