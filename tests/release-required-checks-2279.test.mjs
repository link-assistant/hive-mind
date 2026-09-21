/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2279, corrected by issue #2281.
 *
 * An unprovisioned PAT must not be a release prerequisite. The built-in token
 * creates an auditable PR, and its GitHub Actions App token publishes the
 * already-passed parent validation as the required check on the version SHA.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const releaseHelper = readFileSync('scripts/release-pull-request.lib.mjs', 'utf8');
const preflightWorkflow = readFileSync('.github/workflows/release-preflight.yml', 'utf8');

assert.doesNotMatch(releaseWorkflow, /validate-pr/, 'the ineligible workflow_dispatch validation mode must stay removed');
assert.equal((releaseWorkflow.match(/actions: write/g) || []).length, 0, 'dispatch-only Actions write permissions must stay removed');
assert.ok((releaseWorkflow.match(/GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/g) || []).length >= 2, 'both release modes must use the existing built-in token');
assert.doesNotMatch(releaseWorkflow, /RELEASE_PULL_REQUEST_TOKEN/, 'release must not require an unprovisioned long-lived token');
assert.match(releaseHelper, /repos\/\$\{repository\}\/check-runs/, 'the helper must publish a check through the GitHub Actions App');
assert.match(releaseHelper, /--required/, 'the helper must wait for the ruleset-required check before merge');
assert.match(releaseHelper, /checks: write/, 'the narrow token permission needed by the release attestation must remain documented');
assert.doesNotMatch(preflightWorkflow, /validate-pr/, 'preflight no longer needs a publication exception for the invalid dispatch mode');

console.log('release-required-checks-2279.test.mjs: all assertions passed');
