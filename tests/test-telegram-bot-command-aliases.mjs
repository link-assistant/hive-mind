#!/usr/bin/env node

/**
 * Tests for Telegram /solve aliases.
 *
 * /do and /continue are plain /solve aliases.
 * /claude, /codex, /opencode, and /agent are per-tool aliases equivalent to
 * /solve --tool <tool>.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/525
 * @see https://github.com/link-assistant/hive-mind/issues/1618
 */

import { applySolveToolAlias, getSolveToolAliasFromText, parseCommandArgs, SOLVE_COMMAND_NAMES, TOOL_SOLVE_COMMAND_ALIASES } from '../src/telegram-solve-command.lib.mjs';

const tests = [
  {
    name: '/do command with basic URL',
    input: '/do https://github.com/test/repo/issues/1',
    expectedArgs: ['https://github.com/test/repo/issues/1'],
    expectedToolAlias: null,
  },
  {
    name: '/continue command with options',
    input: '/continue https://github.com/test/repo/issues/2 --verbose --attach-logs',
    expectedArgs: ['https://github.com/test/repo/issues/2', '--verbose', '--attach-logs'],
    expectedToolAlias: null,
  },
  {
    name: '/solve command still works',
    input: '/solve https://github.com/test/repo/issues/3 --fork',
    expectedArgs: ['https://github.com/test/repo/issues/3', '--fork'],
    expectedToolAlias: null,
  },
  {
    name: '/claude injects --tool claude',
    input: '/claude https://github.com/test/repo/issues/4',
    expectedArgs: ['https://github.com/test/repo/issues/4', '--tool', 'claude'],
    expectedToolAlias: 'claude',
  },
  {
    name: '/codex without arguments stays empty before reply URL resolution',
    input: '/codex',
    expectedArgs: [],
    expectedToolAlias: 'codex',
  },
  {
    name: '/codex injects --tool codex while preserving options',
    input: '/codex https://github.com/test/repo/issues/5 --model gpt-5.4 --think high',
    expectedArgs: ['https://github.com/test/repo/issues/5', '--model', 'gpt-5.4', '--think', 'high', '--tool', 'codex'],
    expectedToolAlias: 'codex',
  },
  {
    name: '/opencode injects --tool opencode',
    input: '/opencode https://github.com/test/repo/issues/6 --model grok-code-fast-1',
    expectedArgs: ['https://github.com/test/repo/issues/6', '--model', 'grok-code-fast-1', '--tool', 'opencode'],
    expectedToolAlias: 'opencode',
  },
  {
    name: '/agent injects --tool agent and handles bot mention',
    input: '/agent@SwarmMindBot https://github.com/test/repo/issues/7 --model nemotron-3-super-free',
    expectedArgs: ['https://github.com/test/repo/issues/7', '--model', 'nemotron-3-super-free', '--tool', 'agent'],
    expectedToolAlias: 'agent',
  },
  {
    name: '/agent handles Telegram em-dash replacement',
    input: '/agent https://github.com/test/repo/issues/8 —verbose',
    expectedArgs: ['https://github.com/test/repo/issues/8', '--verbose', '--tool', 'agent'],
    expectedToolAlias: 'agent',
  },
  {
    name: '/codex command wins over explicit --tool value',
    input: '/codex https://github.com/test/repo/issues/9 --tool claude --model gpt-5.4',
    expectedArgs: ['https://github.com/test/repo/issues/9', '--model', 'gpt-5.4', '--tool', 'codex'],
    expectedToolAlias: 'codex',
  },
  {
    name: '/opencode command wins over explicit --tool=value syntax',
    input: '/opencode https://github.com/test/repo/issues/10 --tool=agent --model grok-code-fast-1',
    expectedArgs: ['https://github.com/test/repo/issues/10', '--model', 'grok-code-fast-1', '--tool', 'opencode'],
    expectedToolAlias: 'opencode',
  },
];

let passed = 0;
let failed = 0;

function assertDeepEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    return;
  }
  throw new Error(`${label}\n  Expected: ${JSON.stringify(expected)}\n  Got:      ${JSON.stringify(actual)}`);
}

console.log('Running telegram bot command aliases tests...\n');

for (const test of tests) {
  try {
    const toolAlias = getSolveToolAliasFromText(test.input);
    const result = applySolveToolAlias(parseCommandArgs(test.input), toolAlias);

    assertDeepEqual(toolAlias, test.expectedToolAlias, 'tool alias mismatch');
    assertDeepEqual(result, test.expectedArgs, 'args mismatch');

    console.log(`PASS: ${test.name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${test.name}`);
    console.log(`  Input: ${test.input}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

for (const [command, tool] of Object.entries(TOOL_SOLVE_COMMAND_ALIASES)) {
  if (!SOLVE_COMMAND_NAMES.includes(command)) {
    console.log(`FAIL: /${command} is missing from SOLVE_COMMAND_NAMES`);
    failed++;
  } else if (tool !== command) {
    console.log(`FAIL: /${command} should map to --tool ${command}, got ${tool}`);
    failed++;
  } else {
    console.log(`PASS: /${command} is registered as a per-tool solve alias`);
    passed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${passed + failed} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`${'='.repeat(50)}`);

process.exit(failed > 0 ? 1 : 0);
