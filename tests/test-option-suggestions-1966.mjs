#!/usr/bin/env node

import assert from 'node:assert/strict';

import { getLinoYargsFactory, parseCliArgumentsWithLino } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig as createHiveYargsConfig } from '../src/hive.config.lib.mjs';
import { enhanceErrorMessage, findSimilarOptions } from '../src/option-suggestions.lib.mjs';
import { createYargsConfig as createSolveYargsConfig } from '../src/solve.config.lib.mjs';
import { parseArgsWithYargs } from '../src/telegram-solve-command.lib.mjs';

const yargsFactory = getLinoYargsFactory();

function makeSolveParser() {
  return createSolveYargsConfig(yargsFactory());
}

function makeHiveParser() {
  return createHiveYargsConfig(yargsFactory());
}

function getFormattedOptionMentions(message) {
  return [...message.matchAll(/`(--[^`]+|-.)`/g)].map(match => match[1]);
}

const solveSuggestions = findSimilarOptions('mode', makeSolveParser(), 5);
assert.equal(solveSuggestions[0], 'model');

const enhancedSolveMessage = enhanceErrorMessage('Unknown argument: mode', makeSolveParser());
assert.match(enhancedSolveMessage, /Did you mean `--model` option\?/);
assert.match(enhancedSolveMessage, /Other close matches:/);

const solveOptionMentions = getFormattedOptionMentions(enhancedSolveMessage);
assert.equal(solveOptionMentions.length, 5, 'The primary suggestion plus four alternatives should be shown');
assert.deepEqual(
  solveOptionMentions.filter(option => /^-[^-]/.test(option)),
  [],
  'Single-letter aliases should not crowd out full option names'
);

await assert.rejects(
  () => parseArgsWithYargs(['https://github.com/link-assistant/hive-mind/pull/1965', '--mode', 'opus'], yargsFactory, createSolveYargsConfig),
  error => {
    assert.match(error.message, /Unknown argument: mode/);
    assert.match(error.message, /Did you mean `--model` option\?/);
    assert.equal(getFormattedOptionMentions(error.message).length, 5);
    return true;
  }
);

assert.throws(
  () =>
    parseCliArgumentsWithLino({
      argv: ['node', 'solve', 'https://github.com/link-assistant/hive-mind/issues/1966', '--mode', 'opus'],
      commandName: 'solve',
      createYargsConfig: createSolveYargsConfig,
      positionalAliases: ['issue-url'],
    }),
  error => {
    assert.match(error.message, /Unknown argument: mode/);
    assert.match(error.message, /Did you mean `--model` option\?/);
    assert.equal(getFormattedOptionMentions(error.message).length, 5);
    return true;
  }
);

await assert.rejects(
  () => parseArgsWithYargs(['https://github.com/link-assistant/hive-mind', '--targt-branch', 'main'], yargsFactory, createHiveYargsConfig),
  error => {
    assert.match(error.message, /Unknown arguments?: targt-branch/);
    assert.match(error.message, /Did you mean `--target-branch` option\?/);
    return true;
  }
);

assert.equal(findSimilarOptions('targt-branch', makeHiveParser(), 5)[0], 'target-branch');

console.log('✅ Option suggestion regression tests passed');
