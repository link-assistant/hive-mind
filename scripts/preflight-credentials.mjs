#!/usr/bin/env node

/**
 * Prove this run can publish before it builds anything (issue #2221).
 *
 * Probes every registry credential the pipeline will need with an attempted
 * write, reports all of them, and -- in `release` mode only -- exits 1 so the
 * run stops before it spends anything on artifacts it cannot deliver.
 *
 * Usage:
 *   node scripts/preflight-credentials.mjs [--mode release|report]
 *
 * Without `--mode`, a push to the default branch and a manual dispatch are
 * `release`; everything else, pull requests above all, is `report`.
 *
 * Emits GitHub Actions step outputs:
 *   ok        - 'true' when no definite failure was found
 *   failures  - number of definite failures
 *   warnings  - number of findings that are not proof of a failure
 *   verified  - number of capabilities actually established
 *
 * The logic lives in scripts/preflight-credentials.lib.mjs and
 * scripts/registry-probe.lib.mjs so it can be unit-tested against a fake
 * registry (see tests/release-preflight-2221.test.mjs). This file only wires
 * the real network, environment and GitHub Actions output into it.
 */

import { appendFileSync } from 'node:fs';

import { buildTargets, renderAnnotations, renderSummary, resolveMode, runPreflight } from './preflight-credentials.lib.mjs';

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

function writeSummary(markdown) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    appendFileSync(summaryFile, `${markdown}\n`);
  }
}

const mode = resolveMode({ argv: process.argv.slice(2) });
const targets = buildTargets();
const result = await runPreflight({ mode, targets });

// Annotations first: they are what shows up next to the run, and in release
// mode they are the last thing printed before the exit.
for (const annotation of renderAnnotations(result)) {
  console.log(annotation);
}

const summary = renderSummary(result);
console.log(summary);
writeSummary(summary);

setOutput('ok', String(result.ok));
setOutput('failures', String(result.failures));
setOutput('warnings', String(result.warnings));
setOutput('verified', String(result.verified));

if (mode === 'release' && !result.ok) {
  console.log(`::error title=Release preflight::${result.failures} credential check(s) failed; stopping before the build rather than publishing a release that delivers nothing`);
  process.exit(1);
}
