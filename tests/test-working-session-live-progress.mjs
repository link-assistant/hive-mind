#!/usr/bin/env node
/**
 * Comprehensive tests for --working-session-live-progress feature
 *
 * Tests:
 * 1. Progress monitoring module - utility functions
 * 2. CLI configuration - option definition in solve and hive
 * 3. Option forwarding - hive to solve command
 * 4. Display modes - comment and pr
 * 5. Stream event processing
 */

import { strict as assert } from 'assert';

// Color codes for pretty output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

const log = (msg, color = 'reset') => console.log(`${colors[color]}${msg}${colors.reset}`);
const pass = msg => log(`✓ ${msg}`, 'green');
const fail = msg => log(`✗ ${msg}`, 'red');
const section = msg => log(`\n${msg}`, 'blue');

let testsPassed = 0;
let testsFailed = 0;

const test = (name, fn) => {
  try {
    fn();
    pass(name);
    testsPassed++;
  } catch (error) {
    fail(`${name}: ${error.message}`);
    testsFailed++;
  }
};

const asyncTest = async (name, fn) => {
  try {
    await fn();
    pass(name);
    testsPassed++;
  } catch (error) {
    fail(`${name}: ${error.message}`);
    testsFailed++;
  }
};

section('Testing Progress Monitoring Module Utilities');

// Test 1: Import progress monitoring module
const progressModule = await import('../src/solve.progress-monitoring.lib.mjs');
test('Progress monitoring module exports createProgressMonitor', () => {
  assert(typeof progressModule.createProgressMonitor === 'function');
});

test('Progress monitoring module exports utils', () => {
  assert(typeof progressModule.utils === 'object');
});

test('Progress monitoring module exports normalizeDisplayMode', () => {
  assert(typeof progressModule.normalizeDisplayMode === 'function');
});

// Test 2: Test utility functions
const { utils, normalizeDisplayMode } = progressModule;

test('utils.generateProgressBar generates correct bar for 0%', () => {
  const bar = utils.generateProgressBar(0, 10);
  assert.equal(bar, '░░░░░░░░░░');
});

test('utils.generateProgressBar generates correct bar for 50%', () => {
  const bar = utils.generateProgressBar(50, 10);
  assert.equal(bar, '█████░░░░░');
});

test('utils.generateProgressBar generates correct bar for 100%', () => {
  const bar = utils.generateProgressBar(100, 10);
  assert.equal(bar, '██████████');
});

// Test 3: Test calculateProgress
test('utils.calculateProgress returns zero stats for empty array', () => {
  const stats = utils.calculateProgress([]);
  assert.deepEqual(stats, {
    total: 0,
    completed: 0,
    inProgress: 0,
    pending: 0,
    percentage: 0,
  });
});

test('utils.calculateProgress calculates correct stats', () => {
  const todos = [
    { status: 'completed', content: 'Task 1' },
    { status: 'completed', content: 'Task 2' },
    { status: 'in_progress', content: 'Task 3' },
    { status: 'pending', content: 'Task 4' },
  ];
  const stats = utils.calculateProgress(todos);
  assert.equal(stats.total, 4);
  assert.equal(stats.completed, 2);
  assert.equal(stats.inProgress, 1);
  assert.equal(stats.pending, 1);
  assert.equal(stats.percentage, 50);
});

// Test 4: Test formatTodoList
test('utils.formatTodoList formats todos correctly', () => {
  const todos = [
    { status: 'completed', content: 'Done task' },
    { status: 'in_progress', content: 'Active task' },
    { status: 'pending', content: 'Pending task' },
  ];
  const formatted = utils.formatTodoList(todos);
  assert(formatted.includes('[x] Done task'));
  assert(formatted.includes('[~] Active task'));
  assert(formatted.includes('[ ] Pending task'));
});

// Test 5: Test generateProgressSection (never collapsible)
test('utils.generateProgressSection generates valid markdown', () => {
  const todos = [{ status: 'completed', content: 'Task 1' }];
  const section = utils.generateProgressSection(todos, 'test-session');
  assert(section.includes('<!-- LIVE-PROGRESS-START -->'));
  assert(section.includes('<!-- LIVE-PROGRESS-END -->'));
  assert(section.includes('## 📊 Live Progress Monitor'));
  assert(section.includes('Session:** test-session'));
  assert(section.includes('100%'));
});

test('utils.generateProgressSection does NOT use collapsible details/summary', () => {
  const todos = [
    { status: 'completed', content: 'Done' },
    { status: 'pending', content: 'Todo' },
  ];
  const section = utils.generateProgressSection(todos, 'test-session');
  assert(!section.includes('<details>'), 'Should NOT contain <details> tag');
  assert(!section.includes('<summary>'), 'Should NOT contain <summary> tag');
  assert(!section.includes('</details>'), 'Should NOT contain </details> tag');
});

test('utils.generateProgressSection shows task list directly', () => {
  const todos = [
    { status: 'completed', content: 'Done' },
    { status: 'pending', content: 'Todo' },
  ];
  const section = utils.generateProgressSection(todos, 'test-session');
  assert(section.includes('📋 **Task List**'), 'Should have task list header');
  assert(section.includes('[x] Done'), 'Should include completed task');
  assert(section.includes('[ ] Todo'), 'Should include pending task');
});

section('\nTesting normalizeDisplayMode');

test('normalizeDisplayMode returns null for false', () => {
  assert.equal(normalizeDisplayMode(false), null);
});

test('normalizeDisplayMode returns null for "false"', () => {
  assert.equal(normalizeDisplayMode('false'), null);
});

test('normalizeDisplayMode returns null for null', () => {
  assert.equal(normalizeDisplayMode(null), null);
});

test('normalizeDisplayMode returns null for undefined', () => {
  assert.equal(normalizeDisplayMode(undefined), null);
});

test('normalizeDisplayMode returns null for empty string ""', () => {
  // Empty string is falsy in JS, so it's treated as disabled
  assert.equal(normalizeDisplayMode(''), null);
});

test('normalizeDisplayMode returns "comment" for true', () => {
  assert.equal(normalizeDisplayMode(true), 'comment');
});

test('normalizeDisplayMode returns "comment" for "true"', () => {
  assert.equal(normalizeDisplayMode('true'), 'comment');
});

test('normalizeDisplayMode returns "comment" for "comment"', () => {
  assert.equal(normalizeDisplayMode('comment'), 'comment');
});

test('normalizeDisplayMode returns "pr" for "pr"', () => {
  assert.equal(normalizeDisplayMode('pr'), 'pr');
});

test('normalizeDisplayMode returns "pr" for "PR" (case insensitive)', () => {
  assert.equal(normalizeDisplayMode('PR'), 'pr');
});

test('normalizeDisplayMode returns "comment" for "Comment" (case insensitive)', () => {
  assert.equal(normalizeDisplayMode('Comment'), 'comment');
});

test('normalizeDisplayMode returns "comment" for unknown values (fallback)', () => {
  assert.equal(normalizeDisplayMode('unknown'), 'comment');
});

section('\nTesting CLI Configuration');

// Test 6: Check solve.config.lib.mjs
const solveConfig = await import('../src/solve.config.lib.mjs');
test('solve.config.lib.mjs exports createYargsConfig', () => {
  assert(typeof solveConfig.createYargsConfig === 'function');
});

// Test 7: Create mock yargs and check option
const mockYargs = {
  options: {},
  usage: function () {
    return this;
  },
  command: function () {
    return this;
  },
  fail: function () {
    return this;
  },
  option: function (name, config) {
    this.options[name] = config;
    return this;
  },
  parserConfiguration: function () {
    return this;
  },
  strict: function () {
    return this;
  },
  help: function () {
    return this;
  },
  alias: function () {
    return this;
  },
};

solveConfig.createYargsConfig(mockYargs);

test('solve config defines working-session-live-progress option', () => {
  assert(mockYargs.options['working-session-live-progress'] !== undefined);
});

test('working-session-live-progress is string type', () => {
  assert.equal(mockYargs.options['working-session-live-progress'].type, 'string');
});

test('working-session-live-progress defaults to false (disabled)', () => {
  assert.equal(mockYargs.options['working-session-live-progress'].default, false);
});

test('working-session-live-progress has EXPERIMENTAL marker in description', () => {
  const desc = mockYargs.options['working-session-live-progress'].description;
  assert(desc.includes('[EXPERIMENTAL]'));
});

test('working-session-live-progress description mentions comment and pr modes', () => {
  const desc = mockYargs.options['working-session-live-progress'].description;
  assert(desc.includes('comment'), 'Should mention comment mode');
  assert(desc.includes('pr'), 'Should mention pr mode');
});

// Test 8: Check hive.config.lib.mjs
const hiveConfig = await import('../src/hive.config.lib.mjs');
test('hive.config.lib.mjs exports createYargsConfig', () => {
  assert(typeof hiveConfig.createYargsConfig === 'function');
});

const mockYargsHive = {
  options: {},
  command: function () {
    return this;
  },
  usage: function () {
    return this;
  },
  fail: function () {
    return this;
  },
  option: function (name, config) {
    this.options[name] = config;
    return this;
  },
  parserConfiguration: function () {
    return this;
  },
  strict: function () {
    return this;
  },
  help: function () {
    return this;
  },
  alias: function () {
    return this;
  },
  showHelpOnFail: function () {
    return this;
  },
};

hiveConfig.createYargsConfig(mockYargsHive);

test('hive config defines working-session-live-progress option', () => {
  assert(mockYargsHive.options['working-session-live-progress'] !== undefined);
});

section('\nTesting Option Forwarding');

// Test 9: Check option is in SOLVE_OPTION_DEFINITIONS (auto-forwarded by hive)
test('SOLVE_OPTION_DEFINITIONS includes working-session-live-progress', () => {
  assert(solveConfig.SOLVE_OPTION_DEFINITIONS['working-session-live-progress'] !== undefined);
  assert.equal(solveConfig.SOLVE_OPTION_DEFINITIONS['working-session-live-progress'].type, 'string');
  assert.equal(solveConfig.SOLVE_OPTION_DEFINITIONS['working-session-live-progress'].default, false);
});

// Test 10: Check hive auto-registers the option via getSolvePassthroughOptionNames
test('hive.config exports getSolvePassthroughOptionNames', () => {
  assert(typeof hiveConfig.getSolvePassthroughOptionNames === 'function');
});

test('getSolvePassthroughOptionNames includes working-session-live-progress', () => {
  const passthroughNames = hiveConfig.getSolvePassthroughOptionNames();
  assert(passthroughNames.includes('working-session-live-progress'));
});

section('\nTesting Claude Integration');

// Test 11: Check claude.lib.mjs integration
import { readFile } from 'fs/promises';
const claudeSource = await readFile('./src/claude.lib.mjs', 'utf-8');

test('claude.lib.mjs imports initProgressMonitoring from progress module', () => {
  assert(claudeSource.includes("import { initProgressMonitoring } from './solve.progress-monitoring.lib.mjs'"));
});

test('claude.lib.mjs initializes progressMonitor via initProgressMonitoring', () => {
  assert(claudeSource.includes('initProgressMonitoring(argv'));
});

test('claude.lib.mjs calls processStreamEvent for progress monitoring', () => {
  assert(claudeSource.includes('progressMonitor.processStreamEvent(data'));
});

test('claude.lib.mjs progress monitoring works without --interactive-mode', () => {
  assert(claudeSource.includes('works with or without --interactive-mode'));
});

test('Progress module exports initProgressMonitoring factory', () => {
  assert(typeof progressModule.initProgressMonitoring === 'function');
});

test('initProgressMonitoring returns null when disabled (false)', async () => {
  const result = await progressModule.initProgressMonitoring({ workingSessionLiveProgress: false }, { owner: 'o', repo: 'r', prNumber: 1, $: null, log: async () => {} });
  assert.equal(result, null);
});

section('\nTesting Module Structure');

test('Progress monitoring CONFIG is defined', () => {
  assert(typeof utils.CONFIG === 'object');
});

test('CONFIG has PROGRESS_BAR_WIDTH', () => {
  assert(typeof utils.CONFIG.PROGRESS_BAR_WIDTH === 'number');
});

test('CONFIG has PROGRESS_SECTION_START marker', () => {
  assert(typeof utils.CONFIG.PROGRESS_SECTION_START === 'string');
  assert(utils.CONFIG.PROGRESS_SECTION_START.includes('LIVE-PROGRESS-START'));
});

test('CONFIG has PROGRESS_SECTION_END marker', () => {
  assert(typeof utils.CONFIG.PROGRESS_SECTION_END === 'string');
  assert(utils.CONFIG.PROGRESS_SECTION_END.includes('LIVE-PROGRESS-END'));
});

test('CONFIG has MIN_UPDATE_INTERVAL for rate limiting', () => {
  assert(typeof utils.CONFIG.MIN_UPDATE_INTERVAL === 'number');
  assert(utils.CONFIG.MIN_UPDATE_INTERVAL > 0);
});

test('CONFIG has DISPLAY_MODES with comment and pr', () => {
  assert(Array.isArray(utils.CONFIG.DISPLAY_MODES));
  assert(utils.CONFIG.DISPLAY_MODES.includes('comment'));
  assert(utils.CONFIG.DISPLAY_MODES.includes('pr'));
});

test('CONFIG has DEFAULT_DISPLAY_MODE set to comment', () => {
  assert.equal(utils.CONFIG.DEFAULT_DISPLAY_MODE, 'comment');
});

section('\nTesting createProgressMonitor Display Modes');

test('createProgressMonitor defaults to comment display mode', () => {
  const monitor = progressModule.createProgressMonitor({
    owner: 'test',
    repo: 'test',
    prNumber: 1,
    $: async () => ({ stdout: '{}' }),
    log: async () => {},
  });
  assert.equal(monitor.displayMode, 'comment');
});

test('createProgressMonitor accepts pr display mode', () => {
  const monitor = progressModule.createProgressMonitor({
    owner: 'test',
    repo: 'test',
    prNumber: 1,
    $: async () => ({ stdout: '{}' }),
    log: async () => {},
    displayMode: 'pr',
  });
  assert.equal(monitor.displayMode, 'pr');
});

test('createProgressMonitor accepts comment display mode', () => {
  const monitor = progressModule.createProgressMonitor({
    owner: 'test',
    repo: 'test',
    prNumber: 1,
    $: async () => ({ stdout: '{}' }),
    log: async () => {},
    displayMode: 'comment',
  });
  assert.equal(monitor.displayMode, 'comment');
});

test('createProgressMonitor exposes commentId (initially null)', () => {
  const monitor = progressModule.createProgressMonitor({
    owner: 'test',
    repo: 'test',
    prNumber: 1,
    $: async () => ({ stdout: '{}' }),
    log: async () => {},
    displayMode: 'comment',
  });
  assert.equal(monitor.commentId, null);
});

section('\nTesting processStreamEvent Behavioral Tests');

// Helper: create a mock progress monitor for behavioral testing
const createMockMonitor = (displayMode = 'pr') => {
  const calls = [];
  const mockLog = async () => {};
  const monitor = progressModule.createProgressMonitor({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 1,
    $: async (...args) => {
      // Mock $ that returns empty PR body for gh pr view
      const cmd = args[0]?.join?.(' ') || String(args[0]);
      if (cmd.includes('gh pr view')) {
        return { stdout: JSON.stringify({ body: '' }) };
      }
      if (cmd.includes('gh pr edit')) {
        return { stdout: '' };
      }
      if (cmd.includes('gh pr comment')) {
        return { stdout: 'https://github.com/test-owner/test-repo/pull/1#issuecomment-12345\n' };
      }
      if (cmd.includes('gh api')) {
        return { stdout: '' };
      }
      return { stdout: '' };
    },
    log: mockLog,
    verbose: false,
    sessionId: 'test-session',
    displayMode,
  });
  // Wrap processStreamEvent to track calls
  const origProcess = monitor.processStreamEvent.bind(monitor);
  const wrappedMonitor = {
    ...monitor,
    processStreamEvent: async (data, force = false) => {
      const result = await origProcess(data, force);
      if (result) calls.push(data);
      return result;
    },
    getCalls: () => calls,
  };
  return wrappedMonitor;
};

// Test: Pattern 1 - Assistant event with TodoWrite tool_use (real event shape from case studies)
await asyncTest('processStreamEvent detects Pattern 1: assistant TodoWrite tool_use', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'assistant',
    message: {
      model: 'claude-opus-4-5-20251101',
      id: 'msg_test1',
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_test1',
          name: 'TodoWrite',
          input: {
            todos: [
              { content: 'Task 1', status: 'completed', activeForm: 'Doing task 1' },
              { content: 'Task 2', status: 'in_progress', activeForm: 'Doing task 2' },
              { content: 'Task 3', status: 'pending', activeForm: 'Doing task 3' },
            ],
          },
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: 'test-session-id',
  };
  const result = await monitor.processStreamEvent(event, true); // force=true to skip rate limit
  assert.equal(result, true, 'Should return true when TodoWrite detected');
  assert.equal(monitor.getCalls().length, 1, 'Should have tracked one call');
});

await asyncTest('processStreamEvent detects Pattern 2: user tool_use_result with newTodos', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: 'toolu_test1',
          type: 'tool_result',
          content: 'Todos have been modified successfully.',
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: 'test-session-id',
    tool_use_result: {
      oldTodos: [],
      newTodos: [
        { content: 'Task 1', status: 'completed', activeForm: 'Doing task 1' },
        { content: 'Task 2', status: 'in_progress', activeForm: 'Doing task 2' },
      ],
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, true, 'Should return true when newTodos detected');
});

await asyncTest('processStreamEvent ignores non-TodoWrite assistant tool_use', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_test_bash',
          name: 'Bash',
          input: { command: 'ls' },
        },
      ],
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false for non-TodoWrite tool_use');
});

await asyncTest('processStreamEvent ignores user event without tool_use_result.newTodos', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: 'toolu_test_bash',
          type: 'tool_result',
          content: 'command output here',
        },
      ],
    },
    tool_use_result: {
      output: 'some output',
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false when no newTodos');
});

await asyncTest('processStreamEvent ignores result events', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 1.5,
    result: 'Done',
    num_turns: 5,
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false for result events');
});

await asyncTest('processStreamEvent ignores system events', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'system',
    subtype: 'task_started',
    task_id: 'test-task',
    description: 'Test task',
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false for system events');
});

await asyncTest('processStreamEvent ignores rate_limit_event events', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'rate_limit_event',
    retry_after: 60,
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false for rate limit events');
});

await asyncTest('processStreamEvent handles null/undefined data gracefully', async () => {
  const monitor = createMockMonitor();
  assert.equal(await monitor.processStreamEvent(null, true), false);
  assert.equal(await monitor.processStreamEvent(undefined, true), false);
  assert.equal(await monitor.processStreamEvent('string', true), false);
  assert.equal(await monitor.processStreamEvent(42, true), false);
});

await asyncTest('processStreamEvent handles assistant event with mixed content (text + TodoWrite)', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: 'Let me update the task list.',
        },
        {
          type: 'tool_use',
          id: 'toolu_mixed',
          name: 'TodoWrite',
          input: {
            todos: [{ content: 'Mixed task', status: 'in_progress', activeForm: 'Working on mixed task' }],
          },
        },
      ],
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, true, 'Should detect TodoWrite in mixed content');
});

await asyncTest('processStreamEvent handles assistant event with content as non-array', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'assistant',
    message: {
      content: {
        type: 'tool_use',
        id: 'toolu_single',
        name: 'TodoWrite',
        input: {
          todos: [{ content: 'Single item task', status: 'pending', activeForm: 'Working' }],
        },
      },
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, true, 'Should handle content as non-array single object');
});

await asyncTest('processStreamEvent handles assistant event with empty content array', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'assistant',
    message: {
      content: [],
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false for empty content');
});

await asyncTest('processStreamEvent handles assistant event without message', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'assistant',
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false when message is missing');
});

await asyncTest('processStreamEvent handles user event without tool_use_result', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          content: 'some result',
        },
      ],
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should return false when no tool_use_result');
});

await asyncTest('processStreamEvent handles TodoWrite with empty todos array', async () => {
  const monitor = createMockMonitor();
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_empty',
          name: 'TodoWrite',
          input: {
            todos: [],
          },
        },
      ],
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, true, 'Should still process empty todos array');
});

await asyncTest('processStreamEvent handles ToolSearch referencing TodoWrite (no false positive)', async () => {
  const monitor = createMockMonitor();
  // Real pattern from case study: ToolSearch that finds TodoWrite
  const event = {
    type: 'user',
    message: {
      content: [
        {
          tool_use_id: 'toolu_toolsearch',
          type: 'tool_result',
          content: [{ type: 'tool_reference', tool_name: 'TodoWrite' }],
        },
      ],
    },
    tool_use_result: {
      matches: ['TodoWrite'],
      query: 'select:TodoWrite',
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, false, 'Should NOT trigger for ToolSearch results mentioning TodoWrite');
});

await asyncTest('processStreamEvent detects TodoWrite with all statuses', async () => {
  const monitor = createMockMonitor();
  const todos = [
    { content: 'Completed task', status: 'completed', activeForm: 'Done' },
    { content: 'In progress task', status: 'in_progress', activeForm: 'Working' },
    { content: 'Pending task', status: 'pending', activeForm: 'Waiting' },
  ];
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_allstatus',
          name: 'TodoWrite',
          input: { todos },
        },
      ],
    },
  };
  await monitor.processStreamEvent(event, true);
  const stats = monitor.getStats();
  assert.equal(stats.total, 3, 'Total should be 3');
  assert.equal(stats.completed, 1, 'Completed should be 1');
  assert.equal(stats.inProgress, 1, 'In progress should be 1');
  assert.equal(stats.pending, 1, 'Pending should be 1');
  assert.equal(stats.percentage, 33, 'Percentage should be 33%');
});

await asyncTest('processStreamEvent detects Codex todo_list updates', async () => {
  const monitor = progressModule.createProgressMonitor({
    owner: 'o',
    repo: 'r',
    prNumber: 1,
    $: async () => ({ stdout: '{"body":""}' }),
    log: async () => {},
    displayMode: 'comment',
  });

  const updated = await monitor.processStreamEvent({
    type: 'item.updated',
    item: {
      type: 'todo_list',
      items: [
        { text: 'First', completed: true },
        { text: 'Second', completed: false },
      ],
    },
  });

  assert.equal(updated, true);
  assert.deepEqual(monitor.currentTodos, [
    { status: 'completed', content: 'First' },
    { status: 'pending', content: 'Second' },
  ]);
});

section('\nTesting processStreamEvent with Comment Mode');

await asyncTest('processStreamEvent works in comment display mode', async () => {
  const monitor = createMockMonitor('comment');
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_comment_mode',
          name: 'TodoWrite',
          input: {
            todos: [{ content: 'Comment mode task', status: 'in_progress', activeForm: 'Working' }],
          },
        },
      ],
    },
  };
  const result = await monitor.processStreamEvent(event, true);
  assert.equal(result, true, 'Should update progress in comment mode');
});

section('\nTesting initProgressMonitoring');

await asyncTest('initProgressMonitoring returns null when disabled (false)', async () => {
  const result = await progressModule.initProgressMonitoring({ workingSessionLiveProgress: false }, { owner: 'o', repo: 'r', prNumber: 1, $: null, log: async () => {} });
  assert.equal(result, null, 'Should return null when disabled');
});

await asyncTest('initProgressMonitoring returns null when missing PR info', async () => {
  const result = await progressModule.initProgressMonitoring({ workingSessionLiveProgress: 'comment' }, { owner: '', repo: 'r', prNumber: 1, $: null, log: async () => {} });
  assert.equal(result, null, 'Should return null when owner is empty');
});

await asyncTest('initProgressMonitoring returns null when prNumber is missing', async () => {
  const result = await progressModule.initProgressMonitoring({ workingSessionLiveProgress: 'comment' }, { owner: 'o', repo: 'r', prNumber: null, $: null, log: async () => {} });
  assert.equal(result, null, 'Should return null when prNumber is missing');
});

await asyncTest('initProgressMonitoring returns monitor with comment mode', async () => {
  const result = await progressModule.initProgressMonitoring({ workingSessionLiveProgress: 'comment' }, { owner: 'o', repo: 'r', prNumber: 1, $: async () => ({ stdout: '{}' }), log: async () => {} });
  assert.notEqual(result, null, 'Should return a monitor object');
  assert.equal(result.displayMode, 'comment', 'Should be in comment mode');
  assert.equal(typeof result.processStreamEvent, 'function', 'Should have processStreamEvent');
  assert.equal(typeof result.updateProgress, 'function', 'Should have updateProgress');
  assert.equal(typeof result.getStats, 'function', 'Should have getStats');
  assert.equal(typeof result.generateSection, 'function', 'Should have generateSection');
});

await asyncTest('initProgressMonitoring returns monitor with pr mode', async () => {
  const result = await progressModule.initProgressMonitoring({ workingSessionLiveProgress: 'pr' }, { owner: 'o', repo: 'r', prNumber: 1, $: async () => ({ stdout: '{}' }), log: async () => {} });
  assert.notEqual(result, null, 'Should return a monitor object');
  assert.equal(result.displayMode, 'pr', 'Should be in pr mode');
});

await asyncTest('initProgressMonitoring treats bare true as comment mode', async () => {
  // When yargs passes true (no value given), normalizeDisplayMode maps it to "comment"
  const result = await progressModule.initProgressMonitoring({ workingSessionLiveProgress: true }, { owner: 'o', repo: 'r', prNumber: 1, $: async () => ({ stdout: '{}' }), log: async () => {} });
  assert.notEqual(result, null, 'Should return a monitor object');
  assert.equal(result.displayMode, 'comment', 'Should default to comment mode');
});

section('\nTesting Edge Cases');

test('calculateProgress handles null input', () => {
  const stats = utils.calculateProgress(null);
  assert.deepEqual(stats, { total: 0, completed: 0, inProgress: 0, pending: 0, percentage: 0 });
});

test('calculateProgress handles undefined input', () => {
  const stats = utils.calculateProgress(undefined);
  assert.deepEqual(stats, { total: 0, completed: 0, inProgress: 0, pending: 0, percentage: 0 });
});

test('calculateProgress handles non-array input', () => {
  const stats = utils.calculateProgress('not an array');
  assert.deepEqual(stats, { total: 0, completed: 0, inProgress: 0, pending: 0, percentage: 0 });
});

test('calculateProgress handles all completed todos', () => {
  const todos = [
    { status: 'completed', content: 'A' },
    { status: 'completed', content: 'B' },
  ];
  const stats = utils.calculateProgress(todos);
  assert.equal(stats.percentage, 100);
  assert.equal(stats.completed, 2);
  assert.equal(stats.pending, 0);
  assert.equal(stats.inProgress, 0);
});

test('calculateProgress handles single todo', () => {
  const stats = utils.calculateProgress([{ status: 'in_progress', content: 'Only one' }]);
  assert.equal(stats.total, 1);
  assert.equal(stats.percentage, 0);
  assert.equal(stats.inProgress, 1);
});

test('formatTodoList handles null input', () => {
  assert.equal(utils.formatTodoList(null), '_No tasks yet_');
});

test('formatTodoList handles empty array', () => {
  assert.equal(utils.formatTodoList([]), '_No tasks yet_');
});

test('formatTodoList handles unknown status with fallback icon', () => {
  const todos = [{ status: 'unknown_status', content: 'Mystery task' }];
  const formatted = utils.formatTodoList(todos);
  assert(formatted.includes('[ ] Mystery task'), 'Should use default icon for unknown status');
});

test('formatTodoList truncates long lists with maxDisplay', () => {
  const todos = Array.from({ length: 20 }, (_, i) => ({
    status: i < 10 ? 'completed' : 'pending',
    content: `Task ${i + 1}`,
  }));
  const formatted = utils.formatTodoList(todos, 6);
  assert(formatted.includes('Task 1'), 'Should include first tasks');
  assert(formatted.includes('Task 20'), 'Should include last tasks');
  assert(formatted.includes('more tasks'), 'Should show truncation message');
});

test('generateProgressBar handles edge case percentage of 1%', () => {
  const bar = utils.generateProgressBar(1, 10);
  assert(bar.length === 10, 'Bar should be exactly 10 chars');
});

test('generateProgressBar clamps percentage over 100', () => {
  const bar = utils.generateProgressBar(200, 10);
  assert.equal(bar, '██████████', 'Should clamp to 100% (all filled)');
});

test('generateProgressBar clamps negative percentage to 0', () => {
  const bar = utils.generateProgressBar(-50, 10);
  assert.equal(bar, '░░░░░░░░░░', 'Should clamp to 0% (all empty)');
});

test('generateProgressSection includes all required markers and sections (no collapsible)', () => {
  const todos = [
    { status: 'completed', content: 'Done' },
    { status: 'pending', content: 'Todo' },
  ];
  const section = utils.generateProgressSection(todos, 'my-session');
  assert(section.includes(utils.CONFIG.PROGRESS_SECTION_START), 'Should include start marker');
  assert(section.includes(utils.CONFIG.PROGRESS_SECTION_END), 'Should include end marker');
  assert(section.includes('my-session'), 'Should include session ID');
  assert(section.includes('50%'), 'Should include correct percentage');
  assert(section.includes('1/2 completed'), 'Should include task counts');
  assert(!section.includes('<details>'), 'Should NOT include collapsible section');
  assert(!section.includes('<summary>'), 'Should NOT include summary tag');
  assert(section.includes('[x] Done'), 'Should include completed task');
  assert(section.includes('[ ] Todo'), 'Should include pending task');
});

test('generateProgressSection uses "Current" when sessionId is null', () => {
  const section = utils.generateProgressSection([], null);
  assert(section.includes('Current'), 'Should show "Current" as session name');
});

section('\nTest Summary');
log(`\nTotal: ${testsPassed + testsFailed} tests`);
log(`Passed: ${testsPassed}`, 'green');
if (testsFailed > 0) {
  log(`Failed: ${testsFailed}`, 'red');
  process.exit(1);
} else {
  log('\n✨ All tests passed!', 'green');
  process.exit(0);
}
