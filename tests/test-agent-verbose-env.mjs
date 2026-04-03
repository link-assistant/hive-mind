#!/usr/bin/env node

/**
 * Tests for agent verbose environment variable propagation
 * Issue #1521: No HTTP requests and response logs in `--verbose` mode for `--tool agent`
 *
 * Root cause: agent.lib.mjs was not passing OPENCODE_VERBOSE and LINK_ASSISTANT_AGENT_VERBOSE
 * environment variables to the agent process. The agent's Flag module reads these env vars
 * at initialization to enable HTTP request/response logging. The --verbose CLI flag alone
 * is insufficient because providers are initialized before yargs middleware sets the flag.
 */

import { strict as assert } from 'assert';
import { readFileSync } from 'fs';

// Read the agent.lib.mjs source to verify the fix
const agentLibSource = readFileSync(new URL('../src/agent.lib.mjs', import.meta.url), 'utf8');

console.log('Testing agent verbose environment variable propagation (Issue #1521)...\n');

// Test 1: Verify OPENCODE_VERBOSE env var is set in the agent execution code
console.log('Test 1: agent.lib.mjs sets OPENCODE_VERBOSE env var for agent process');
assert.ok(agentLibSource.includes("agentEnv.OPENCODE_VERBOSE = 'true'"), 'Should set OPENCODE_VERBOSE=true in agent environment when verbose is enabled');
console.log('  ✅ PASSED: OPENCODE_VERBOSE is set in agentEnv\n');

// Test 2: Verify LINK_ASSISTANT_AGENT_VERBOSE env var is set
console.log('Test 2: agent.lib.mjs sets LINK_ASSISTANT_AGENT_VERBOSE env var for agent process');
assert.ok(agentLibSource.includes("agentEnv.LINK_ASSISTANT_AGENT_VERBOSE = 'true'"), 'Should set LINK_ASSISTANT_AGENT_VERBOSE=true in agent environment when verbose is enabled');
console.log('  ✅ PASSED: LINK_ASSISTANT_AGENT_VERBOSE is set in agentEnv\n');

// Test 3: Verify env is passed to $() command-stream call
console.log('Test 3: agent.lib.mjs passes env to command-stream execution');
assert.ok(agentLibSource.includes('env: agentEnv'), 'Should pass agentEnv to $() options for command-stream execution');
console.log('  ✅ PASSED: agentEnv is passed to $() options\n');

// Test 4: Verify env vars are only set when verbose is enabled (conditional)
console.log('Test 4: Environment variables are conditionally set based on argv.verbose');
const envBlockMatch = agentLibSource.match(/if \(argv\.verbose\) \{[^}]*agentEnv\.OPENCODE_VERBOSE[^}]*\}/s);
assert.ok(envBlockMatch, 'OPENCODE_VERBOSE should only be set inside an if (argv.verbose) block');
console.log('  ✅ PASSED: Env vars are conditional on argv.verbose\n');

// Test 5: Verify the pattern matches how claude.lib.mjs handles verbose for Claude tool
// Claude sets ANTHROPIC_LOG=debug, agent should set OPENCODE_VERBOSE=true
console.log('Test 5: Pattern consistency with claude.lib.mjs verbose handling');
assert.ok(agentLibSource.includes('const agentEnv = { ...process.env }'), 'Should spread process.env into agentEnv (same pattern as claudeEnv in claude.lib.mjs)');
console.log('  ✅ PASSED: Environment inheritance pattern is consistent\n');

// Test 6: Verify --verbose flag is still passed as CLI argument (belt-and-suspenders)
console.log('Test 6: --verbose CLI flag is still passed alongside env vars');
assert.ok(agentLibSource.includes("agentArgs += ' --verbose'"), 'Should still pass --verbose as CLI argument for defense in depth');
console.log('  ✅ PASSED: --verbose CLI flag is preserved\n');

console.log('All tests passed! ✅');
console.log('\nIssue #1521: Agent verbose env propagation is correctly implemented.');
