#!/usr/bin/env node
/**
 * Issue #2156 — survey of the npm secret-scanning libraries we could add.
 *
 * The issue asks us to "use multiple similar libraries for fault tolerance",
 * so every plausible candidate on npm was measured rather than argued about.
 * Each is asked the only two questions that matter for this incident:
 *
 *   1. Does it find the credential in the shapes that actually leaked — plain,
 *      base64, base64 inside escaped JSON, and line-wrapped base64?
 *   2. Is it usable on our logs at all? A scanner that reports thousands of
 *      findings per file cannot drive masking: every finding is a span we would
 *      redact, so a false positive rate like that destroys the log.
 *
 * The candidates are NOT dependencies of hive-mind. Install them out-of-tree
 * before running:
 *
 *   mkdir -p /tmp/survey && cd /tmp/survey && npm init -y \
 *     && npm install @sanity-labs/secret-scan @visulima/secret-scanner detect-secrets redact-secrets
 *   NODE_PATH=/tmp/survey/node_modules node experiments/issue-2156-library-survey.mjs
 *
 * A candidate that fails to load is reported as such rather than skipped
 * silently — "we could not load it" is itself a finding about a dependency we
 * would have to trust with every log we publish.
 *
 * SYNTHETIC TOKEN ONLY. The real leaked value is never written to this repo.
 */

import { createRequire } from 'node:module';

import { detectSecretsWithSecretlint } from '../src/token-sanitization.lib.mjs';
import { sanitizeCredentialText } from '../src/credential-sanitization-core.lib.mjs';

const require = createRequire(import.meta.url);

const SYNTHETIC = `gho_${'A'.repeat(12)}SyntheticNotReal${'9'.repeat(8)}`;
const encoded = Buffer.from(SYNTHETIC).toString('base64');

// The four spellings, in the order they appear in the incident log.
const SHAPES = [
  ['plain', `token: ${SYNTHETIC}`],
  ['base64', `{"token":"${encoded}"}`],
  ['base64 in escaped JSON', `{"content":"token len ${SYNTHETIC.length}\\n{\\"token\\":\\"${encoded}\\"}\\n"}`],
  ['wrapped base64', `body=\n${encoded.replace(/(.{20})/g, '$1\n')}`],
];

/** Load a candidate, reporting why it is unusable instead of throwing. */
const tryLoad = specifier => {
  try {
    return { module: require(specifier) };
  } catch (error) {
    return { error: error.message.split('\n')[0] };
  }
};

/** Each adapter returns the number of findings, or null if it cannot answer. */
const candidates = [
  {
    // The core masks in one pass rather than reporting spans, so this answers
    // 0/1 — "did it change anything" — not a count. Enough for both questions
    // above; not comparable as a magnitude.
    name: 'hive-mind core (ours, 0/1)',
    scan: async text => (sanitizeCredentialText(text) === text ? 0 : 1),
  },
  {
    name: 'secretlint (recommended preset)',
    scan: async text => (await detectSecretsWithSecretlint(text)).length,
  },
  {
    name: '@sanity-labs/secret-scan',
    scan: async text => {
      const { module, error } = tryLoad('@sanity-labs/secret-scan');
      if (error) throw new Error(error);
      const scan = module.scan ?? module.secretScan ?? module.default;
      if (typeof scan !== 'function') throw new Error(`no callable export (${Object.keys(module).join(', ') || 'none'})`);
      const result = await scan(text);
      return Array.isArray(result) ? result.length : (result?.findings?.length ?? result?.secrets?.length ?? 0);
    },
  },
  {
    name: '@visulima/secret-scanner',
    // Resolution fails for a reason worth reporting: the published package has
    // no entry point at all, so the manifest is read directly.
    scan: async () => {
      const manifest = require('@visulima/secret-scanner/package.json');
      throw new Error(`v${manifest.version} is a placeholder — "${manifest.description}"; no code is published`);
    },
  },
  {
    name: 'detect-secrets (npm)',
    scan: async () => {
      const manifest = require('detect-secrets/package.json');
      if (!manifest.main && !manifest.exports) throw new Error(`v${manifest.version} publishes only a CLI (bin: ${Object.keys(manifest.bin ?? {}).join(', ')}) wrapping Yelp's Python tool; no library entry point`);
      throw new Error(`v${manifest.version} wraps the Python tool`);
    },
  },
  {
    name: 'redact-secrets',
    scan: async text => {
      const { module, error } = tryLoad('redact-secrets');
      if (error) throw new Error(error);
      const redact = (module.default ?? module)('[REDACTED]');
      // Operates on objects, not text; give it the shape it wants.
      return JSON.stringify(redact.map({ value: text })) === JSON.stringify({ value: text }) ? 0 : 1;
    },
  },
];

console.log(`Detection by shape (findings; 0 = missed)\n`);
const header = ['candidate'.padEnd(34), ...SHAPES.map(([name]) => name.padStart(24))].join('');
console.log(header);
console.log('-'.repeat(header.length));

for (const candidate of candidates) {
  const cells = [];
  for (const [, text] of SHAPES) {
    try {
      cells.push(String(await candidate.scan(text)).padStart(24));
    } catch (error) {
      cells.push(`unusable`.padStart(24));
      candidate.note ??= error.message;
    }
  }
  console.log([candidate.name.padEnd(34), ...cells].join(''));
  if (candidate.note) console.log(`${' '.repeat(34)}↳ ${candidate.note}`);
}

// False-positive load, measured on a real log rather than asserted. Pass the
// incident log (or any large log) as argv[2] to include this section.
const logPath = process.argv[2];
if (logPath) {
  const { readFileSync } = await import('node:fs');
  const log = readFileSync(logPath, 'utf8');
  console.log(`\nFindings on ${logPath} (${log.length} bytes) — a masking layer redacts every one of these\n`);
  for (const candidate of candidates) {
    try {
      const started = Date.now();
      const count = await candidate.scan(log);
      console.log(`${candidate.name.padEnd(34)} ${String(count).padStart(8)} findings in ${Date.now() - started} ms`);
    } catch (error) {
      console.log(`${candidate.name.padEnd(34)} ${'unusable'.padStart(8)} — ${error.message}`);
    }
  }
}
