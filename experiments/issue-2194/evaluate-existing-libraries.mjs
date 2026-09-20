#!/usr/bin/env node

/**
 * Issue #2194 asked us to "check known existing components/libraries, that solve
 * similar problem or can help in solutions" before writing our own.
 *
 * This script runs the issue's own inputs through the two closest candidates on
 * npm so the survey in the case study is measured, not assumed.
 *
 * Setup (deliberately outside this repository — neither library is a dependency):
 *   mkdir -p /tmp/prior-art && cd /tmp/prior-art
 *   npm init -y && npm install normalize-url@9 confusables@1
 *   node <path-to-this-repo>/experiments/issue-2194/evaluate-existing-libraries.mjs
 */

const PRIOR_ART = '/tmp/prior-art/node_modules';

let normalizeUrl, confusables;
try {
  ({ default: normalizeUrl } = await import(`${PRIOR_ART}/normalize-url/index.js`));
  confusables = await import(`${PRIOR_ART}/confusables/dist/index.js`);
} catch (error) {
  console.error(`Could not load the candidate libraries from ${PRIOR_ART}: ${error.message}`);
  console.error('See the setup instructions at the top of this file.');
  process.exit(1);
}

const INPUTS = [
  ['the reported case', 'https://github.com/G-Ivan-A/aether-orbis/pulls/30'],
  ['zero-width space in the repo name', 'https://github.com/G-Ivan-A/aether-orbis​/pull/30'],
  ['full-width colon', 'https：//github.com/G-Ivan-A/aether-orbis/pull/30'],
  ['markdown link', '[PR 30](https://github.com/G-Ivan-A/aether-orbis/pull/30)'],
  ['non-ASCII owner name that must survive', 'https://github.com/Ćwikła/aether-orbis/pull/30'],
];

const attempt = fn => {
  try {
    return fn();
  } catch (error) {
    return `threw: ${error.message}`;
  }
};

for (const [label, input] of INPUTS) {
  console.log(`${label}\n  input:           ${JSON.stringify(input)}`);
  console.log(`  normalize-url:   ${JSON.stringify(attempt(() => normalizeUrl(input)))}`);
  console.log(`  confusables:     ${JSON.stringify(attempt(() => confusables.remove(input)))}`);
  console.log('');
}
