#!/usr/bin/env node
/**
 * Tool-specific uncommitted-change loader contracts for issue #2150.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { resolveUncommittedChangesTool } from '../src/solve.tool-uncommitted.lib.mjs';

const loaded = [];
const handlers = new Map();
const importModule = async specifier => {
  loaded.push(specifier);
  const checkForUncommittedChanges = handlers.get(specifier) ?? (() => specifier);
  return { checkForUncommittedChanges, isAgentCommanderAvailable: () => true };
};
const claudeHandler = () => 'claude';

let resolved = await resolveUncommittedChangesTool({ argv: { tool: 'codex' }, claudeLib: { checkForUncommittedChanges: claudeHandler }, importModule });
assert.equal(resolved.checkForUncommittedChanges(), './codex.lib.mjs');
assert.equal(resolved.agentCommanderLib, null);

resolved = await resolveUncommittedChangesTool({ argv: { tool: 'claude' }, claudeLib: { checkForUncommittedChanges: claudeHandler }, importModule });
assert.equal(resolved.checkForUncommittedChanges, claudeHandler);
assert.equal(resolved.agentCommanderLib, null);

resolved = await resolveUncommittedChangesTool({ argv: { tool: 'qwen', useAgentCommander: true }, claudeLib: { checkForUncommittedChanges: claudeHandler }, importModule });
assert.equal(resolved.checkForUncommittedChanges(), './agent-commander.lib.mjs');
assert.equal(typeof resolved.agentCommanderLib.isAgentCommanderAvailable, 'function');
assert.deepEqual(loaded, ['./codex.lib.mjs', './agent-commander.lib.mjs']);

console.log('solve-tool-uncommitted-2150.test.mjs: all assertions passed');
