#!/usr/bin/env node

/**
 * Regression test for issue #1978.
 *
 * `--sub-agent-model` must be accepted by solve, hive, and Telegram's shared
 * yargs parsing path, but it must not change Claude Code defaults unless the
 * user explicitly provides a value.
 */

import assert from 'node:assert/strict';

import { buildAgentCommanderToolOptions } from '../src/agent-commander.lib.mjs';
import { getLinoYargsFactory } from '../src/cli-arguments.lib.mjs';
import { getClaudeEnv } from '../src/config.lib.mjs';
import { createYargsConfig as createHiveYargsConfig, getSolvePassthroughOptionNames } from '../src/hive.config.lib.mjs';
import { mapClaudeSubAgentModelToEnvValue, validateClaudeSubAgentModelName } from '../src/models/index.mjs';
import { createYargsConfig as createSolveYargsConfig, SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { getFirstParsedPositionalArg, moveArgumentToFront, parseArgsWithYargs, parseCommandArgs } from '../src/telegram-solve-command.lib.mjs';

const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/1978';
const repoUrl = 'https://github.com/link-assistant/hive-mind';
const yargsFactory = getLinoYargsFactory();

assert.equal(SOLVE_OPTION_DEFINITIONS['sub-agent-model']?.type, 'string');
assert.equal(SOLVE_OPTION_DEFINITIONS['sub-agent-model']?.default, undefined);
assert.ok(getSolvePassthroughOptionNames().includes('sub-agent-model'), 'hive should forward --sub-agent-model to solve workers');

const solveArgv = await parseArgsWithYargs([issueUrl, '--sub-agent-model', 'sonnet'], yargsFactory, createSolveYargsConfig);
assert.equal(solveArgv.subAgentModel, 'sonnet');

const solveEqualsArgv = await parseArgsWithYargs([issueUrl, '--sub-agent-model=inherit'], yargsFactory, createSolveYargsConfig);
assert.equal(solveEqualsArgv.subAgentModel, 'inherit');

const hiveArgv = await parseArgsWithYargs([repoUrl, '--sub-agent-model', 'sonnet'], yargsFactory, createHiveYargsConfig);
assert.equal(hiveArgv.subAgentModel ?? hiveArgv['sub-agent-model'], 'sonnet');

const telegramSolveArgs = parseCommandArgs(`/solve --sub-agent-model sonnet ${issueUrl}`);
const telegramSolveUrl = await getFirstParsedPositionalArg(telegramSolveArgs, yargsFactory, createSolveYargsConfig, ['issue-url']);
const telegramSolveArgv = await parseArgsWithYargs(moveArgumentToFront(telegramSolveArgs, telegramSolveUrl), yargsFactory, createSolveYargsConfig);
assert.equal(telegramSolveArgv.subAgentModel, 'sonnet');

const telegramHiveArgs = parseCommandArgs(`/hive --sub-agent-model=sonnet ${repoUrl}`);
const telegramHiveUrl = await getFirstParsedPositionalArg(telegramHiveArgs, yargsFactory, createHiveYargsConfig, ['github-url']);
const telegramHiveArgv = await parseArgsWithYargs(moveArgumentToFront(telegramHiveArgs, telegramHiveUrl), yargsFactory, createHiveYargsConfig);
assert.equal(telegramHiveArgv.subAgentModel, 'sonnet');

assert.equal(validateClaudeSubAgentModelName('SONNET').mappedModel, 'claude-sonnet-5');
assert.equal(validateClaudeSubAgentModelName('inherit').mappedModel, 'inherit');
assert.equal(validateClaudeSubAgentModelName('claude-future-9-20990101').mappedModel, 'claude-future-9-20990101');
assert.equal(validateClaudeSubAgentModelName('anthropic/claude-future-9').mappedModel, 'anthropic/claude-future-9');
assert.equal(validateClaudeSubAgentModelName('not-a-model').valid, false);
assert.equal(mapClaudeSubAgentModelToEnvValue('sonnet'), 'claude-sonnet-5');
assert.equal(mapClaudeSubAgentModelToEnvValue('INHERIT'), 'inherit');
assert.equal(mapClaudeSubAgentModelToEnvValue('claude-future-9-20990101'), 'claude-future-9-20990101');

const originalSubAgentModel = process.env.CLAUDE_CODE_SUBAGENT_MODEL;
delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
try {
  assert.equal('CLAUDE_CODE_SUBAGENT_MODEL' in getClaudeEnv({}), false, 'default getClaudeEnv must not set the sub-agent model');
  assert.equal(getClaudeEnv({ subAgentModel: 'claude-sonnet-4-6' }).CLAUDE_CODE_SUBAGENT_MODEL, 'claude-sonnet-4-6');
  assert.equal(getClaudeEnv({ subAgentModel: 'inherit' }).CLAUDE_CODE_SUBAGENT_MODEL, 'inherit');
} finally {
  if (originalSubAgentModel === undefined) {
    delete process.env.CLAUDE_CODE_SUBAGENT_MODEL;
  } else {
    process.env.CLAUDE_CODE_SUBAGENT_MODEL = originalSubAgentModel;
  }
}

const claudeToolOptions = buildAgentCommanderToolOptions({ subAgentModel: 'sonnet' }, 'claude');
assert.equal(claudeToolOptions.extraEnv.CLAUDE_CODE_SUBAGENT_MODEL, 'claude-sonnet-5');

const codexToolOptions = buildAgentCommanderToolOptions({ subAgentModel: 'claude-opus-4-8' }, 'codex');
assert.equal(codexToolOptions.extraEnv?.CLAUDE_CODE_SUBAGENT_MODEL, undefined, 'non-Claude tools must not receive Claude sub-agent env');

console.log('issue #1978 sub-agent model regression tests passed');
