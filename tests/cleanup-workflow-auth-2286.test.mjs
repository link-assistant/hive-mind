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

assert.match(workflow, /GH_TOKEN:\s*\$\{\{ secrets\.TEST_GITHUB_USER_REPO_DELETION_TOKEN \}\}/, 'cleanup commands authenticate non-interactively with the configured repository-deletion token');
assert.doesNotMatch(workflow, /gh auth (?:login|refresh)\b/, 'automation must not start an interactive login or try to mutate an environment-provided token');
assert.match(workflow, /gh auth status\b/, 'the workflow verifies that GitHub CLI recognized the configured token');
assert.match(workflow, /gh api user\b/, 'the workflow verifies the token against the GitHub API before cleanup');
assert.doesNotMatch(cleanupScript, /authStatus\.includes\(['"]delete_repo['"]\)/, 'the cleanup script must not infer PAT permissions from human-readable auth status output');
assert.match(cleanupScript, /process\.env\.GH_TOKEN\s*\|\|\s*process\.env\.GITHUB_TOKEN/, 'authentication guidance distinguishes an automation token from stored interactive credentials');
assert.match(cleanupScript, /Administration: write/, 'fine-grained PAT remediation names the repository permission required by the delete endpoint');

console.log('cleanup-workflow-auth-2286.test.mjs: all assertions passed');
