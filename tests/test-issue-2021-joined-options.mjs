#!/usr/bin/env node

/**
 * Regression tests for issue #2021: a GitHub URL immediately followed by an
 * option marker, usually after Telegram replaces "--" with an em dash.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2021
 */

import assert from 'node:assert/strict';

import { parseCliArgumentsWithLino } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig as createSolveYargsConfig } from '../src/solve.config.lib.mjs';
import { applySolveToolAlias, getSolveToolAliasFromText, parseCommandArgs } from '../src/telegram-solve-command.lib.mjs';

const issueUrl = 'https://github.com/leaderstat/wb-part2/issues/169';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

await test('Telegram /claude splits URL followed by em-dash model option', () => {
  const args = applySolveToolAlias(parseCommandArgs(`/claude ${issueUrl}—model opus`), getSolveToolAliasFromText('/claude'));

  assert.deepEqual(args, [issueUrl, '--model', 'opus', '--tool', 'claude']);
});

await test('Telegram parser accepts URL followed by another long option', () => {
  const args = applySolveToolAlias(parseCommandArgs(`/gemini ${issueUrl}—verbose`), getSolveToolAliasFromText('/gemini'));

  assert.deepEqual(args, [issueUrl, '--verbose', '--tool', 'gemini']);
});

await test('CLI parser accepts URL followed by em-dash model option', () => {
  const argv = parseCliArgumentsWithLino({
    argv: ['node', 'solve', `${issueUrl}—model`, 'opus'],
    commandName: 'solve',
    createYargsConfig: createSolveYargsConfig,
    positionalAliases: ['issue-url'],
  });

  assert.equal(argv['issue-url'], issueUrl);
  assert.equal(argv.model, 'opus');
});

await test('CLI parser accepts URL followed by ASCII long option', () => {
  const argv = parseCliArgumentsWithLino({
    argv: ['node', 'solve', `${issueUrl}--verbose`],
    commandName: 'solve',
    createYargsConfig: createSolveYargsConfig,
    positionalAliases: ['issue-url'],
  });

  assert.equal(argv['issue-url'], issueUrl);
  assert.equal(argv.verbose, true);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
