#!/usr/bin/env node
/**
 * Comprehensive tests for --working-session-live-progress feature
 *
 * Tests:
 * 1. Progress monitoring module - utility functions
 * 2. CLI configuration - option definition in solve and hive
 * 3. Option forwarding - hive to solve command
 * 4. Interactive mode integration
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

section('Testing Progress Monitoring Module Utilities');

// Test 1: Import progress monitoring module
const progressModule = await import('../src/solve.progress-monitoring.lib.mjs');
test('Progress monitoring module exports createProgressMonitor', () => {
  assert(typeof progressModule.createProgressMonitor === 'function');
});

test('Progress monitoring module exports utils', () => {
  assert(typeof progressModule.utils === 'object');
});

// Test 2: Test utility functions
const { utils } = progressModule;

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

// Test 5: Test generateProgressSection
test('utils.generateProgressSection generates valid markdown', () => {
  const todos = [{ status: 'completed', content: 'Task 1' }];
  const section = utils.generateProgressSection(todos, 'test-session');
  assert(section.includes('<!-- LIVE-PROGRESS-START -->'));
  assert(section.includes('<!-- LIVE-PROGRESS-END -->'));
  assert(section.includes('## 📊 Live Progress Monitor'));
  assert(section.includes('Session:** test-session'));
  assert(section.includes('100%'));
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

test('working-session-live-progress is boolean type', () => {
  assert.equal(mockYargs.options['working-session-live-progress'].type, 'boolean');
});

test('working-session-live-progress defaults to false', () => {
  assert.equal(mockYargs.options['working-session-live-progress'].default, false);
});

test('working-session-live-progress has EXPERIMENTAL marker in description', () => {
  const desc = mockYargs.options['working-session-live-progress'].description;
  assert(desc.includes('[EXPERIMENTAL]'));
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

// Test 9: Check hive.mjs forwards the option
import { readFile } from 'fs/promises';
const hiveSource = await readFile('./src/hive.mjs', 'utf-8');

test('hive.mjs checks argv.workingSessionLiveProgress', () => {
  assert(hiveSource.includes('argv.workingSessionLiveProgress'));
});

test('hive.mjs adds flag to args array', () => {
  assert(hiveSource.includes("args.push('--working-session-live-progress')"));
});

section('\nTesting Interactive Mode Integration');

// Test 10: Check interactive-mode.lib.mjs integration
const interactiveSource = await readFile('./src/interactive-mode.lib.mjs', 'utf-8');

test('interactive-mode.lib.mjs imports progress monitoring module', () => {
  assert(interactiveSource.includes('solve.progress-monitoring.lib.mjs'));
});

test('interactive-mode.lib.mjs accepts enableProgressMonitoring option', () => {
  assert(interactiveSource.includes('enableProgressMonitoring'));
});

test('interactive-mode.lib.mjs creates progressMonitor instance', () => {
  assert(interactiveSource.includes('createProgressMonitor'));
});

test('interactive-mode.lib.mjs calls updateProgress for TodoWrite', () => {
  assert(interactiveSource.includes('progressMonitor.updateProgress'));
});

section('\nTesting Module Structure');

// Test 11: Verify progress monitoring module structure
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
