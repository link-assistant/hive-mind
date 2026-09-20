#!/usr/bin/env node
/**
 * Unit tests for scripts/publish-failure-classifier.mjs.
 *
 * Verifies the failure detection that guards against the false-positive release
 * in issue #2028 (CI run 29035249489), where `changeset publish` printed
 * "packages failed to publish" / crashed with "Cannot find module 'sigstore'"
 * yet the release job reported success.
 *
 * Run with: node tests/test-publish-failure-classifier-2028.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2028
 */

import assert from 'node:assert/strict';
import { detectPublishFailure, isNonRetryableFailure, buildAuthFailureGuidance, FAILURE_PATTERNS, NON_RETRYABLE_PATTERNS } from '../scripts/publish-failure-classifier.mjs';

let passed = 0;
let failed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`❌ ${name}\n   ${err?.stack || err}`);
    failed++;
  }
};

await test('exports non-empty pattern lists', async () => {
  assert.ok(FAILURE_PATTERNS.length > 0);
  assert.ok(NON_RETRYABLE_PATTERNS.length > 0);
});

await test('detects "packages failed to publish" (changeset failure)', async () => {
  const output = 'info Publishing "@link-assistant/hive-mind"...\n🦋  error packages failed to publish';
  assert.equal(detectPublishFailure(output), 'packages failed to publish');
});

await test('detects the npm 12 sigstore MODULE_NOT_FOUND crash', async () => {
  const output = "Error: Cannot find module 'sigstore'\ncode: 'MODULE_NOT_FOUND'";
  // Either 'cannot find module' or 'module_not_found' is an acceptable match.
  assert.ok(detectPublishFailure(output));
});

await test('detects npm error codes regardless of case', async () => {
  assert.ok(detectPublishFailure('NPM ERROR 404 Not Found'));
  assert.ok(detectPublishFailure('npm error code E403'));
});

await test('returns null for clean successful output', async () => {
  const output = 'info Publishing...\nsuccess Published @link-assistant/hive-mind@2.1.10';
  assert.equal(detectPublishFailure(output), null);
});

await test('handles empty / null output without throwing', async () => {
  assert.equal(detectPublishFailure(''), null);
  assert.equal(detectPublishFailure(null), null);
  assert.equal(detectPublishFailure(undefined), null);
});

await test('classifies auth/registry errors as non-retryable', async () => {
  assert.equal(isNonRetryableFailure('npm error 404 Not Found - PUT'), true);
  assert.equal(isNonRetryableFailure('npm error code E401'), true);
  assert.equal(isNonRetryableFailure('ENEEDAUTH'), true);
  assert.equal(isNonRetryableFailure('Access token expired'), true);
  assert.equal(isNonRetryableFailure('You must be logged in to publish packages'), true);
});

await test('classifies the sigstore crash as retryable (transient/environmental)', async () => {
  // The sigstore crash is an environment problem, not an auth problem; it must
  // NOT be classified as non-retryable auth failure.
  assert.equal(isNonRetryableFailure("Cannot find module 'sigstore'"), false);
});

await test('auth guidance mentions the package and the E404 bootstrap fix', async () => {
  const guidance = buildAuthFailureGuidance('@link-assistant/hive-mind');
  assert.ok(guidance.includes('@link-assistant/hive-mind'));
  assert.match(guidance, /E404|NPM_TOKEN|trusted publish/i);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
