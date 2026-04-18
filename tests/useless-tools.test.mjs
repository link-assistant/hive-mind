#!/usr/bin/env node
/**
 * Useless Tools Disable Tests
 *
 * Tests for src/useless-tools.lib.mjs — the block-list of Claude Code
 * built-in tools and MCP servers that have no value (and may be harmful)
 * in autonomous headless hive-mind runs.
 *
 * Run with: node tests/useless-tools.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1627
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { USELESS_CLAUDE_BUILTIN_TOOLS, USELESS_MCP_SERVER_NAME_PREFIXES, USELESS_MCP_TOOL_NAME_PREFIXES, buildDisallowedToolsList, buildFilteredMcpConfig, ensureDisallowedToolsInSettings, filterMcpServersObject, isUselessMcpServerName } from '../src/useless-tools.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function runTests() {
  console.log('\n📋 Useless Tools Disable Tests (issue #1627)\n');

  // ============================================================================
  // Constants
  // ============================================================================

  test('USELESS_CLAUDE_BUILTIN_TOOLS contains exactly the expected tools', () => {
    const expected = ['AskUserQuestion', 'CronCreate', 'CronDelete', 'CronList', 'EnterPlanMode', 'EnterWorktree', 'ExitPlanMode', 'ExitWorktree', 'Monitor', 'NotebookEdit', 'PushNotification', 'RemoteTrigger', 'ScheduleWakeup'];
    assert.deepEqual([...USELESS_CLAUDE_BUILTIN_TOOLS].sort(), expected.sort());
  });

  test('USELESS_CLAUDE_BUILTIN_TOOLS is frozen', () => {
    assert.ok(Object.isFrozen(USELESS_CLAUDE_BUILTIN_TOOLS), 'USELESS_CLAUDE_BUILTIN_TOOLS should be frozen');
  });

  test('USELESS_MCP_SERVER_NAME_PREFIXES contains all three claude.ai connectors', () => {
    assert.deepEqual([...USELESS_MCP_SERVER_NAME_PREFIXES].sort(), ['claude.ai gmail', 'claude.ai google calendar', 'claude.ai google drive'].sort());
  });

  test('USELESS_MCP_TOOL_NAME_PREFIXES contains mcp__claude_ai_* for all three connectors', () => {
    assert.deepEqual([...USELESS_MCP_TOOL_NAME_PREFIXES].sort(), ['mcp__claude_ai_Gmail', 'mcp__claude_ai_Google_Calendar', 'mcp__claude_ai_Google_Drive'].sort());
  });

  // ============================================================================
  // isUselessMcpServerName
  // ============================================================================

  test('isUselessMcpServerName matches all three claude.ai connectors case-insensitively', () => {
    assert.equal(isUselessMcpServerName('claude.ai Gmail'), true);
    assert.equal(isUselessMcpServerName('claude.ai Google Drive'), true);
    assert.equal(isUselessMcpServerName('claude.ai Google Calendar'), true);
    assert.equal(isUselessMcpServerName('CLAUDE.AI GMAIL'), true);
  });

  test('isUselessMcpServerName does NOT match Playwright or unrelated servers', () => {
    assert.equal(isUselessMcpServerName('playwright'), false);
    assert.equal(isUselessMcpServerName('my-custom-server'), false);
    assert.equal(isUselessMcpServerName(''), false);
    assert.equal(isUselessMcpServerName(null), false);
    assert.equal(isUselessMcpServerName(undefined), false);
  });

  // ============================================================================
  // filterMcpServersObject
  // ============================================================================

  test('filterMcpServersObject removes all three claude.ai connectors', () => {
    const input = {
      'claude.ai Gmail': { url: 'https://gmail.mcp.claude.com/mcp' },
      'claude.ai Google Drive': { url: 'https://drivemcp.googleapis.com/mcp/v1' },
      'claude.ai Google Calendar': { url: 'https://gcal.mcp.claude.com/mcp' },
      playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
      'other-server': { url: 'https://example.com/mcp' },
    };
    const filtered = filterMcpServersObject(input);
    assert.deepEqual(Object.keys(filtered).sort(), ['other-server', 'playwright'].sort());
  });

  test('filterMcpServersObject handles empty and invalid inputs', () => {
    assert.deepEqual(filterMcpServersObject({}), {});
    assert.deepEqual(filterMcpServersObject(null), {});
    assert.deepEqual(filterMcpServersObject(undefined), {});
  });

  // ============================================================================
  // buildDisallowedToolsList
  // ============================================================================

  test('buildDisallowedToolsList returns all block-listed built-ins', () => {
    const list = buildDisallowedToolsList();
    for (const tool of USELESS_CLAUDE_BUILTIN_TOOLS) {
      assert.ok(list.includes(tool), `list should include ${tool}`);
    }
  });

  test('buildDisallowedToolsList returns wildcard MCP tool patterns', () => {
    const list = buildDisallowedToolsList();
    assert.ok(list.includes('mcp__claude_ai_Gmail__*'));
    assert.ok(list.includes('mcp__claude_ai_Google_Drive__*'));
    assert.ok(list.includes('mcp__claude_ai_Google_Calendar__*'));
  });

  test('buildDisallowedToolsList matches the exact length expected', () => {
    const list = buildDisallowedToolsList();
    assert.equal(list.length, USELESS_CLAUDE_BUILTIN_TOOLS.length + USELESS_MCP_TOOL_NAME_PREFIXES.length);
  });

  // ============================================================================
  // buildFilteredMcpConfig
  // ============================================================================

  await asyncTest('buildFilteredMcpConfig writes a JSON file excluding useless connectors', async () => {
    // Create a fake HOME with a claude.json that has mixed servers.
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'useless-tools-test-'));
    const claudeJsonPath = path.join(fakeHome, '.claude.json');
    const input = {
      mcpServers: {
        'claude.ai Gmail': { url: 'https://gmail.mcp.claude.com/mcp' },
        'claude.ai Google Drive': { url: 'https://drivemcp.googleapis.com/mcp/v1' },
        'claude.ai Google Calendar': { url: 'https://gcal.mcp.claude.com/mcp' },
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
        'other-server': { url: 'https://example.com/mcp' },
      },
    };
    await fs.writeFile(claudeJsonPath, JSON.stringify(input));

    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const configPath = await buildFilteredMcpConfig({ log: null });
      assert.ok(configPath, 'should return a path');
      const written = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      assert.deepEqual(Object.keys(written.mcpServers).sort(), ['other-server', 'playwright'].sort(), 'should keep non-blocklisted servers');
      // Clean up the temp config.
      await fs.rm(configPath, { force: true });
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  await asyncTest('buildFilteredMcpConfig with excludePlaywright also drops Playwright', async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'useless-tools-test-'));
    const claudeJsonPath = path.join(fakeHome, '.claude.json');
    const input = {
      mcpServers: {
        'claude.ai Gmail': { url: 'https://gmail.mcp.claude.com/mcp' },
        playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
        'other-server': { url: 'https://example.com/mcp' },
      },
    };
    await fs.writeFile(claudeJsonPath, JSON.stringify(input));
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const configPath = await buildFilteredMcpConfig({ excludePlaywright: true, log: null });
      assert.ok(configPath, 'should return a path');
      const written = JSON.parse(await fs.readFile(configPath, 'utf-8'));
      assert.deepEqual(Object.keys(written.mcpServers), ['other-server']);
      await fs.rm(configPath, { force: true });
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  await asyncTest('buildFilteredMcpConfig returns null if claude.json is missing', async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'useless-tools-test-'));
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const configPath = await buildFilteredMcpConfig({ log: null });
      assert.equal(configPath, null, 'should return null when claude.json is missing');
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // ensureDisallowedToolsInSettings
  // ============================================================================

  await asyncTest('ensureDisallowedToolsInSettings creates a new settings file if missing', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'useless-tools-settings-'));
    const settingsPath = path.join(tmp, 'settings.json');
    const result = await ensureDisallowedToolsInSettings({ settingsPath, log: null });
    assert.equal(result.added.length, buildDisallowedToolsList().length, 'should add the full block-list');
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.deepEqual(written.disallowedTools.sort(), buildDisallowedToolsList().sort());
    await fs.rm(tmp, { recursive: true, force: true });
  });

  await asyncTest('ensureDisallowedToolsInSettings preserves unrelated settings and existing disallowedTools', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'useless-tools-settings-'));
    const settingsPath = path.join(tmp, 'settings.json');
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark', disallowedTools: ['AskUserQuestion', 'CustomTool'] }));
    const result = await ensureDisallowedToolsInSettings({ settingsPath, log: null });
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    assert.equal(written.theme, 'dark', 'unrelated settings preserved');
    assert.ok(written.disallowedTools.includes('CustomTool'), 'existing custom entry preserved');
    assert.ok(written.disallowedTools.includes('AskUserQuestion'), 'existing block-list entry preserved');
    assert.ok(written.disallowedTools.includes('CronCreate'), 'new block-list entry added');
    // AskUserQuestion was already present; it must not have been added.
    assert.ok(!result.added.includes('AskUserQuestion'), 'already-present entries are not in .added');
    await fs.rm(tmp, { recursive: true, force: true });
  });

  // ============================================================================
  // Integration checks with the rest of the project
  // ============================================================================

  await asyncTest('solve.config.lib.mjs exposes --useless-tools-disabled option', async () => {
    const content = await fs.readFile(path.join(process.cwd(), 'src/solve.config.lib.mjs'), 'utf-8');
    assert.ok(content.includes("'useless-tools-disabled'"), 'solve.config should define useless-tools-disabled');
    assert.ok(content.includes('default: true'), 'option should default to true');
  });

  await asyncTest('claude.lib.mjs wires up --disallowedTools via useless-tools helpers', async () => {
    const content = await fs.readFile(path.join(process.cwd(), 'src/claude.lib.mjs'), 'utf-8');
    assert.ok(content.includes('resolveClaudeSessionToolFlags'), 'claude.lib should call resolveClaudeSessionToolFlags');
    assert.ok(content.includes('--disallowedTools'), 'claude.lib should inject --disallowedTools');
    assert.ok(content.includes('--strict-mcp-config'), 'claude.lib should inject --strict-mcp-config');
    assert.ok(content.includes("from './useless-tools.lib.mjs'") || content.includes('from "./useless-tools.lib.mjs"'), 'claude.lib should import from useless-tools.lib.mjs');
  });

  await asyncTest('resolveClaudeSessionToolFlags returns disallowed list by default', async () => {
    const { resolveClaudeSessionToolFlags } = await import('../src/useless-tools.lib.mjs');
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'useless-tools-resolve-'));
    await fs.writeFile(path.join(fakeHome, '.claude.json'), JSON.stringify({ mcpServers: { playwright: { command: 'npx' } } }));
    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const { mcpConfigPath, disallowedToolsList } = await resolveClaudeSessionToolFlags({ argv: {}, log: null });
      assert.ok(mcpConfigPath, 'default path returns a temp mcp config path');
      assert.equal(disallowedToolsList.length, buildDisallowedToolsList().length, 'default returns full disallowed list');
      await fs.rm(mcpConfigPath, { force: true });
    } finally {
      process.env.HOME = originalHome;
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  await asyncTest('resolveClaudeSessionToolFlags returns empty list when disabled', async () => {
    const { resolveClaudeSessionToolFlags } = await import('../src/useless-tools.lib.mjs');
    const { mcpConfigPath, disallowedToolsList } = await resolveClaudeSessionToolFlags({ argv: { uselessToolsDisabled: false }, log: null });
    assert.equal(mcpConfigPath, null, 'when fully disabled, no mcp config is produced');
    assert.deepEqual(disallowedToolsList, [], 'no disallowed tools when opted out');
  });

  await asyncTest('Dockerfile bakes disallowedTools into baseline ~/.claude/settings.json via published configure-claude', async () => {
    const content = await fs.readFile(path.join(process.cwd(), 'Dockerfile'), 'utf-8');
    assert.ok(content.includes('configure-claude --settings-path /workspace/.claude/settings.json'), 'Dockerfile should invoke the published configure-claude bin');
    assert.ok(content.includes('configure-claude --settings-path /workspace/.claude/settings.json --verify'), 'Dockerfile should verify the configure-claude baseline');
    assert.ok(!content.includes('useless-tools.lib.mjs'), 'Dockerfile should not copy source libs for configuration');
    assert.ok(content.includes('issue #1627'), 'Dockerfile should reference issue #1627');
  });

  await asyncTest('coolify/Dockerfile bakes disallowedTools into baseline ~/.claude/settings.json via published configure-claude', async () => {
    const content = await fs.readFile(path.join(process.cwd(), 'coolify/Dockerfile'), 'utf-8');
    assert.ok(content.includes('configure-claude --settings-path /workspace/.claude/settings.json'), 'coolify/Dockerfile should invoke the published configure-claude bin');
    assert.ok(content.includes('configure-claude --settings-path /workspace/.claude/settings.json --verify'), 'coolify/Dockerfile should verify the configure-claude baseline');
    assert.ok(!content.includes('useless-tools.lib.mjs'), 'coolify/Dockerfile should not copy source libs for configuration');
    assert.ok(content.includes('issue #1627'), 'coolify/Dockerfile should reference issue #1627');
  });

  // ============================================================================
  // Summary
  // ============================================================================

  console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
  if (testsFailed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
