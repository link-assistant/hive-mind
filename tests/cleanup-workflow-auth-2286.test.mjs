#!/usr/bin/env node
/**
 * Regression contract for the cleanup workflow authentication failure found
 * while auditing every active workflow for issue #2286.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync('.github/workflows/cleanup-test-repos.yml', 'utf8').replaceAll('\r\n', '\n');
const cleanupScript = readFileSync('cleanup-test-repos.mjs', 'utf8').replaceAll('\r\n', '\n');

assert.match(workflow, /GH_TOKEN:\s*\$\{\{ steps\.gh\.outputs\.token \}\}/, 'cleanup uses the shared credential layer');
assert.match(workflow, /can-delete-repositories == 'true'/, 'repository deletion requires a verified capability');
assert.doesNotMatch(workflow, /gh auth (?:login|refresh)\b/, 'automation never requests interactive credentials');
assert.doesNotMatch(cleanupScript, /authStatus\.includes\(['"]delete_repo['"]\)/, 'the cleanup script must not infer PAT permissions from human-readable auth status output');
assert.match(cleanupScript, /process\.env\.GH_TOKEN\s*\|\|\s*process\.env\.GITHUB_TOKEN/, 'authentication guidance distinguishes an automation token from stored interactive credentials');
assert.match(cleanupScript, /Administration: write/, 'fine-grained PAT remediation names the repository permission required by the delete endpoint');

console.log('cleanup-workflow-auth-2286.test.mjs: all assertions passed');
