#!/usr/bin/env node

/**
 * Issue #2194 — the same inputs with recovery off and on.
 *
 * `parseGitHubUrl(url, { recover: false })` is exactly the pre-fix code path, so
 * this doubles as the regression record: the "before" column is what the bot did
 * on 2026-09-03, the "after" column is what it does now.
 *
 * Run: node experiments/issue-2194/before-and-after.mjs
 */

const { parseGitHubUrl } = await import('../../src/github-url-parser.lib.mjs');

const INPUTS = ['https://github.com/G-Ivan-A/aether-orbis/pulls/30', 'https://github.com/G-Ivan-A/aether-orbis​/pull/30', 'https://github.com/G-Ivan-A/aether-orbis/pull/30 ', '﻿https://github.com/G-Ivan-A/aether-orbis/pull/30', 'https：//github.com/G-Ivan-A/aether-orbis/pull/30', 'https://github.com/G-Ivan-A/aether-orbis/pull/３０', 'https://github.com/G-Ivan-A/aether-orbis/pull/30/files', '[PR 30](https://github.com/G-Ivan-A/aether-orbis/pull/30)', 'HTTPS://GITHUB.COM/G-Ivan-A/aether-orbis/PULL/30', 'git@github.com:G-Ivan-A/aether-orbis.git', 'https://api.github.com/repos/G-Ivan-A/aether-orbis/pulls/30'];

const describe = parsed => (parsed.valid ? `${parsed.type}${parsed.number === undefined ? '' : ` #${parsed.number}`} ${parsed.canonical}` : `invalid: ${parsed.error}`);

for (const input of INPUTS) {
  console.log(JSON.stringify(input));
  console.log(`  before: ${describe(parseGitHubUrl(input, { recover: false }))}`);
  console.log(`  after:  ${describe(parseGitHubUrl(input))}`);
  console.log('');
}
