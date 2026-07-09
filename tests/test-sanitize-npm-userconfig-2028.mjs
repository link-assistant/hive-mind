#!/usr/bin/env node
/**
 * Unit tests for scripts/sanitize-npm-userconfig.mjs.
 *
 * Verifies removal of the deprecated `always-auth` entry that setup-node writes
 * and npm 11 warns about (issue #2028).
 *
 * Run with: node tests/test-sanitize-npm-userconfig-2028.mjs
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2028
 */

import assert from 'node:assert/strict';
import { removeAlwaysAuthEntries, sanitizeNpmUserConfig } from '../scripts/sanitize-npm-userconfig.mjs';

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

const quietLogger = { log: () => {}, error: () => {} };

await test('removes always-auth line but keeps the auth token', async () => {
  const input = 'always-auth=true\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n';
  const { content, removed } = removeAlwaysAuthEntries(input);
  assert.equal(removed, 1);
  assert.ok(!content.includes('always-auth'));
  assert.ok(content.includes('_authToken'));
});

await test('matches always_auth (underscore) and mixed casing', async () => {
  assert.equal(removeAlwaysAuthEntries('Always_Auth = false\n').removed, 1);
  assert.equal(removeAlwaysAuthEntries('always-auth=false\n').removed, 1);
});

await test('leaves content untouched when no always-auth present', async () => {
  const input = '//registry.npmjs.org/:_authToken=abc\nregistry=https://registry.npmjs.org/\n';
  const { content, removed } = removeAlwaysAuthEntries(input);
  assert.equal(removed, 0);
  assert.equal(content, input);
});

await test('sanitizeNpmUserConfig rewrites the file when an entry is removed', async () => {
  let written = null;
  const result = sanitizeNpmUserConfig({
    env: { NPM_CONFIG_USERCONFIG: '/fake/.npmrc' },
    exists: () => true,
    reader: () => 'always-auth=true\n//registry.npmjs.org/:_authToken=x\n',
    writer: (path, data) => {
      written = { path, data };
    },
    logger: quietLogger,
  });
  assert.equal(result.changed, true);
  assert.equal(result.removed, 1);
  assert.equal(written.path, '/fake/.npmrc');
  assert.ok(!written.data.includes('always-auth'));
});

await test('sanitizeNpmUserConfig does nothing when file is absent', async () => {
  let wrote = false;
  const result = sanitizeNpmUserConfig({
    env: { NPM_CONFIG_USERCONFIG: '/nope/.npmrc' },
    exists: () => false,
    reader: () => {
      throw new Error('should not read');
    },
    writer: () => {
      wrote = true;
    },
    logger: quietLogger,
  });
  assert.equal(result.changed, false);
  assert.equal(wrote, false);
});

await test('sanitizeNpmUserConfig does not rewrite when nothing to remove', async () => {
  let wrote = false;
  const result = sanitizeNpmUserConfig({
    env: { NPM_CONFIG_USERCONFIG: '/fake/.npmrc' },
    exists: () => true,
    reader: () => '//registry.npmjs.org/:_authToken=x\n',
    writer: () => {
      wrote = true;
    },
    logger: quietLogger,
  });
  assert.equal(result.changed, false);
  assert.equal(wrote, false, 'no rewrite when there is nothing to change');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
