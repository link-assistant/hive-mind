#!/usr/bin/env node
/**
 * Sanitize a captured execution log before checking it into a case study.
 *
 * Usage:
 *   node experiments/sanitize-case-study-log.mjs <input> <output>
 */

import fs from 'node:fs/promises';
import { containsKnownToken, getAllKnownLocalTokens, getSanitizationStats, sanitizeCommentBody } from '../src/token-sanitization.lib.mjs';

const [inputPath, outputPath] = process.argv.slice(2);

if (!inputPath || !outputPath) {
  console.error('Usage: sanitize-case-study-log.mjs <input> <output>');
  process.exit(2);
}

const knownTokens = await getAllKnownLocalTokens();
const input = await fs.readFile(inputPath, 'utf8');
const sanitized = await sanitizeCommentBody(input, { knownTokens });
const remainingKnownTokens = await containsKnownToken(sanitized, knownTokens);

if (remainingKnownTokens.length > 0) {
  console.error(`Refusing to write: ${remainingKnownTokens.length} known local token(s) remain`);
  process.exit(1);
}

await fs.writeFile(outputPath, sanitized, { mode: 0o600 });
console.log(
  JSON.stringify({
    inputBytes: Buffer.byteLength(input),
    outputBytes: Buffer.byteLength(sanitized),
    knownTokensChecked: knownTokens.length,
    remainingKnownTokens: remainingKnownTokens.length,
    sanitization: getSanitizationStats(),
  })
);
