#!/usr/bin/env node

/**
 * Regression test for issue #2033.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';

import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';
import { createYargsConfig as createHiveYargsConfig } from '../src/hive.config.lib.mjs';
import { defaultModels } from '../src/models/index.mjs';
import { createYargsConfig as createSolveYargsConfig } from '../src/solve.config.lib.mjs';
import { parseArgsWithYargs } from '../src/telegram-solve-command.lib.mjs';

const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/2033';
const repoUrl = 'https://github.com/link-assistant/hive-mind';
const yargsFactory = getLinoYargsFactory();

assert.equal(defaultModels.claude, 'opus', 'Claude should default to opus');

const solveDefault = await parseArgsWithYargs([issueUrl], yargsFactory, createSolveYargsConfig);
assert.equal(solveDefault.tool, 'claude');
assert.equal(solveDefault.model ?? defaultModels[solveDefault.tool], 'opus', 'solve should resolve opus for its default Claude tool');

const solveClaude = await parseArgsWithYargs([issueUrl, '--tool', 'claude'], yargsFactory, createSolveYargsConfig);
assert.equal(solveClaude.model ?? defaultModels[solveClaude.tool], 'opus', 'solve --tool claude should resolve opus');

const hiveClaude = await parseArgsWithYargs([repoUrl, '--tool', 'claude'], yargsFactory, createHiveYargsConfig);
assert.equal(hiveClaude.model ?? defaultModels[hiveClaude.tool], 'opus', 'hive --tool claude should resolve opus');

const explicitSonnet = await parseArgsWithYargs([issueUrl, '--tool', 'claude', '--model', 'sonnet'], yargsFactory, createSolveYargsConfig);
assert.equal(explicitSonnet.model, 'sonnet', 'an explicit Claude model must override the default');

console.log('issue #2033 Claude default-model regression tests passed');
