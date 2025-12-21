#!/usr/bin/env node
// Test to verify that --prompt-explore-sub-agent option correctly modifies system prompt

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const log = (message, color = 'reset') => {
  console.log(`${colors[color]}${message}${colors.reset}`);
};

const testName = 'Prompt Explore Sub-Agent Option Test';
log(`\n📋 Running: ${testName}`, 'blue');
log('─'.repeat(60), 'blue');

let passed = 0;
let failed = 0;

const assert = (condition, message) => {
  if (condition) {
    log(`✅ ${message}`, 'green');
    passed++;
  } else {
    log(`❌ ${message}`, 'red');
    failed++;
  }
};

try {
  // Import the prompts library
  const claudePromptsLib = await import('../src/claude.prompts.lib.mjs');
  const { buildSystemPrompt } = claudePromptsLib;

  // Test 1: Verify system prompt WITHOUT --prompt-explore-sub-agent
  log('\n1️⃣  Testing system prompt without --prompt-explore-sub-agent...', 'yellow');
  const promptWithoutOption = buildSystemPrompt({
    owner: 'test-owner',
    repo: 'test-repo',
    issueNumber: 123,
    prNumber: 456,
    branchName: 'test-branch',
    argv: {
      promptExploreSubAgent: false,
    },
  });

  assert(!promptWithoutOption.includes('use the Task tool with subagent_type=Explore'), 'System prompt does NOT include Explore sub-agent guidance when option is disabled');

  assert(promptWithoutOption.includes('When you need repo context'), 'System prompt includes basic guidance');

  // Test 2: Verify system prompt WITH --prompt-explore-sub-agent
  log('\n2️⃣  Testing system prompt with --prompt-explore-sub-agent...', 'yellow');
  const promptWithOption = buildSystemPrompt({
    owner: 'test-owner',
    repo: 'test-repo',
    issueNumber: 123,
    prNumber: 456,
    branchName: 'test-branch',
    argv: {
      promptExploreSubAgent: true,
    },
  });

  assert(promptWithOption.includes('use the Task tool with subagent_type=Explore'), 'System prompt includes Explore sub-agent guidance when option is enabled');

  assert(promptWithOption.includes('thoroughly explore the codebase'), 'System prompt includes codebase exploration instruction');

  assert(promptWithOption.includes('When you need to learn something about the codebase structure'), 'System prompt includes when-clause for Explore usage');

  // Test 3: Verify the option is defined in solve.config.lib.mjs
  log('\n3️⃣  Testing solve.config.lib.mjs configuration...', 'yellow');
  const { readFileSync } = await import('fs');
  const solveConfigPath = join(__dirname, '../src/solve.config.lib.mjs');
  const solveConfigContent = readFileSync(solveConfigPath, 'utf-8');

  assert(solveConfigContent.includes('prompt-explore-sub-agent'), 'solve.config.lib.mjs defines --prompt-explore-sub-agent option');

  assert(solveConfigContent.includes('Encourage Claude to use Explore sub-agent'), 'solve.config.lib.mjs has correct description for option');

  assert(solveConfigContent.includes('default: false'), 'solve.config.lib.mjs sets default to false for option');

  // Test 4: Verify the option is defined in hive.config.lib.mjs
  log('\n4️⃣  Testing hive.config.lib.mjs configuration...', 'yellow');
  const hiveConfigPath = join(__dirname, '../src/hive.config.lib.mjs');
  const hiveConfigContent = readFileSync(hiveConfigPath, 'utf-8');

  assert(hiveConfigContent.includes('prompt-explore-sub-agent'), 'hive.config.lib.mjs defines --prompt-explore-sub-agent option');

  assert(hiveConfigContent.includes('Encourage Claude to use Explore sub-agent'), 'hive.config.lib.mjs has correct description for option');

  assert(hiveConfigContent.includes('default: false'), 'hive.config.lib.mjs sets default to false for option');

  // Test 5: Verify hive forwards the option to solve
  log('\n5️⃣  Testing hive forwards option to solve...', 'yellow');
  const hivePath = join(__dirname, '../src/hive.mjs');
  const hiveContent = readFileSync(hivePath, 'utf-8');

  assert(hiveContent.includes('promptExploreSubAgent'), 'hive.mjs references promptExploreSubAgent option');

  assert(hiveContent.includes('argv.promptExploreSubAgent'), 'hive.mjs checks argv.promptExploreSubAgent');

  assert(hiveContent.includes('--prompt-explore-sub-agent'), 'hive.mjs forwards --prompt-explore-sub-agent flag to solve');
} catch (error) {
  log(`\n❌ Test error: ${error.message}`, 'red');
  log(error.stack, 'red');
  failed++;
}

// Summary
log('\n' + '─'.repeat(60), 'blue');
log(`📊 Test Summary: ${testName}`, 'blue');
log(`   ✅ Passed: ${passed}`, passed > 0 ? 'green' : 'reset');
log(`   ❌ Failed: ${failed}`, failed > 0 ? 'red' : 'reset');
log('─'.repeat(60), 'blue');

if (failed > 0) {
  log(`\n❌ ${testName} FAILED\n`, 'red');
  process.exit(1);
} else {
  log(`\n✅ ${testName} PASSED\n`, 'green');
  process.exit(0);
}
