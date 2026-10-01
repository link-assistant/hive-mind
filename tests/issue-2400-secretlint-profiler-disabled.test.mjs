#!/usr/bin/env node
/**
 * Issue #2400: the Secretlint scanner must not retain memory per call.
 *
 * `@secretlint/profiler` is enabled by default for library users. Every
 * `lintSource` call adds `performance.mark()` entries that the profiler's
 * observer pushes into arrays nobody clears — about 11 KB per call. While
 * replaying the #2398 session log line by line through sanitizeForPublication
 * the heap grew by ~36 KB per call until node ran out of memory. A Telegram bot
 * or solver that sanitizes every comment it posts grows the same way.
 *
 * Run with: node tests/issue-2400-secretlint-profiler-disabled.test.mjs
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { secretLintProfiler } from '@secretlint/profiler';
import { detectSecretsWithSecretlint, sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

const secretlintMarks = () => performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('@core>')).length;

await test('initialising the scanner disables the Secretlint profiler', async () => {
  await detectSecretsWithSecretlint('nothing to see here', { required: true });
  assert.equal(secretLintProfiler.isEnabled, false);
});

await test('repeated publication sanitization records no profiler marks', async () => {
  const before = secretlintMarks();
  for (let i = 0; i < 200; i++) {
    await sanitizeForPublication(`line ${i}: const fileTokens = await getGitHubTokensFromFiles();`, { includeEnvironmentCredentials: false });
  }
  assert.equal(secretlintMarks(), before, 'performance marks accumulate per call');
  assert.equal((await secretLintProfiler.getEntries()).length, 0, 'profiler entries accumulate per call');
});

await test('the scanner still detects a vendor credential', async () => {
  const githubToken = ['ghp', '_', 'R7kQ2mZ9xW4vL8pN3tB6yH1jC5dF0gS2aE7u'].join('');
  const findings = await detectSecretsWithSecretlint(`GITHUB_TOKEN=${githubToken}`, { required: true });
  assert.ok(findings.length > 0, 'Secretlint found nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
