#!/usr/bin/env node

/**
 * Regression test for issue #1645.
 *
 * A PR thread with more than GitHub's default first page of comments can contain
 * an old "Ready to merge" comment on page 1 and the latest session-ending log on
 * a later page. checkForExistingComment() must inspect all pages, otherwise it
 * scopes deduplication to the wrong session and suppresses the final readiness
 * comment.
 */

import fs from 'fs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (error) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${error.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const noopCommandRunner = async () => ({ code: 1, stdout: '', stderr: '' });

globalThis.use = async moduleName => {
  if (moduleName === 'command-stream') {
    return { $: noopCommandRunner };
  }
  if (moduleName === 'fs') {
    return fs;
  }
  if (moduleName === 'path') {
    return await import('path');
  }
  if (moduleName === 'os') {
    return await import('os');
  }
  if (moduleName === 'getenv') {
    return (name, fallback) => process.env[name] ?? fallback;
  }
  if (moduleName === 'links-notation') {
    return {
      Parser: class {
        parse() {
          return [];
        }
      },
    };
  }
  throw new Error(`Unexpected use("${moduleName}") in test`);
};

const { checkForExistingComment } = await import('../src/solve.auto-merge-helpers.lib.mjs');

const buildCommandText = (strings, values) => {
  let command = '';
  for (let i = 0; i < strings.length; i++) {
    command += strings[i];
    if (i < values.length) {
      command += String(values[i]);
    }
  }
  return command;
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1645 - Ready-to-merge deduplication pagination');
console.log('================================================================================\n');

await test('checkForExistingComment paginates PR comments before applying session scope', async () => {
  const signature = '## ✅ Ready to merge';
  const sessionEndingLog = ['## 🤖 Solution Draft Log', '', '---', '*Now working session is ended, feel free to review and add any feedback on the solution draft.*'].join('\n');
  const firstPageBodies = [...Array.from({ length: 24 }, (_, index) => `Earlier discussion ${index + 1}`), sessionEndingLog, `${signature}\n\nThis stale readiness comment belongs to an older session.`, ...Array.from({ length: 4 }, (_, index) => `Older page trailing comment ${index + 1}`)];
  const fullHistoryBodies = [...firstPageBodies, 'Maintainer feedback after the stale readiness comment.', '🤖 **AI Work Session Started**\n\nStarting automated work session.', sessionEndingLog];

  assert(firstPageBodies.length === 30, 'test setup should mimic GitHub REST API default first page');
  assert(fullHistoryBodies.length > 30, 'test setup should require pagination');

  const capturedCommands = [];
  const mockCommandRunner = async (strings, ...values) => {
    const command = buildCommandText(strings, values);
    capturedCommands.push(command);

    // This models the bug: without --paginate, gh api sees only page 1 and
    // incorrectly finds the stale Ready-to-merge comment after the older log.
    const returnedBodies = command.includes('--paginate') ? fullHistoryBodies : firstPageBodies;
    return { code: 0, stdout: JSON.stringify(returnedBodies), stderr: '' };
  };

  const hasExistingReadyComment = await checkForExistingComment('link-assistant', 'hive-mind', 1643, signature, false, mockCommandRunner);

  assert(capturedCommands.length === 1, 'expected exactly one gh api command');
  assert(capturedCommands[0].includes('--paginate'), 'comment query must request all pages with --paginate');
  assert(hasExistingReadyComment === false, 'stale Ready-to-merge comment before the latest session-ending log must not suppress posting');
});

console.log('\n================================================================================');
console.log(`Test Results for Issue #1645:`);
console.log(`  ${GREEN}Passed:${RESET} ${passed}`);
console.log(`  ${RED}Failed:${RESET} ${failed}`);
console.log(`  Total: ${passed + failed}`);
console.log('================================================================================\n');

if (failed > 0) {
  process.exit(1);
}
