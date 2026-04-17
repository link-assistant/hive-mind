#!/usr/bin/env node
/**
 * Playwright MCP Prompt Integration Tests
 *
 * Tests that all tool prompt builders include Playwright MCP browser
 * automation hints and WebFetch/WebSearch fallback guidance when enabled.
 *
 * Run with: node tests/playwright-mcp-prompts.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1623
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPlaywrightMcpDisableConfig, cascadePlaywrightMcpDisable, collectPlaywrightMcpServerNames, getAgentPlaywrightMcpDisableEnv, getCommandResultCode, getOpenCodePlaywrightMcpDisableEnv, isCommandResultSuccess, mergePlaywrightMcpDisableConfigContent, parseCodexMcpServerNames } from '../src/playwright-mcp.lib.mjs';

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

const srcDir = path.join(process.cwd(), 'src');

async function runTests() {
  console.log('\n📋 Playwright MCP Prompt Tests\n');

  // ============================================================================
  // Verify all prompt files contain Playwright MCP section
  // ============================================================================

  const promptFiles = [
    { file: 'claude.prompts.lib.mjs', tool: 'Claude' },
    { file: 'codex.prompts.lib.mjs', tool: 'Codex' },
    { file: 'opencode.prompts.lib.mjs', tool: 'OpenCode' },
    { file: 'agent.prompts.lib.mjs', tool: 'Agent' },
  ];

  for (const { file, tool } of promptFiles) {
    await asyncTest(`${tool} prompts include Playwright MCP section`, async () => {
      const content = await fs.readFile(path.join(srcDir, file), 'utf-8');
      assert.ok(content.includes('Playwright MCP usage'), `${file} should contain Playwright MCP usage section`);
      assert.ok(content.includes('promptPlaywrightMcp'), `${file} should check promptPlaywrightMcp flag`);
    });

    await asyncTest(`${tool} prompts include WebFetch fallback note`, async () => {
      const content = await fs.readFile(path.join(srcDir, file), 'utf-8');
      assert.ok(content.includes('WebFetch') || content.includes('fetch-based browsing'), `${file} should mention WebFetch fallback to Playwright MCP`);
    });

    await asyncTest(`${tool} prompts include WebSearch fallback note`, async () => {
      const content = await fs.readFile(path.join(srcDir, file), 'utf-8');
      assert.ok(content.includes('WebSearch'), `${file} should mention WebSearch fallback to Playwright MCP`);
    });
  }

  // ============================================================================
  // Verify Playwright MCP availability check in lib files
  // ============================================================================

  console.log('\n📋 Playwright MCP Availability Check Tests\n');

  const libFiles = [
    { file: 'claude.lib.mjs', tool: 'Claude' },
    { file: 'codex.lib.mjs', tool: 'Codex' },
    { file: 'opencode.lib.mjs', tool: 'OpenCode' },
    { file: 'agent.lib.mjs', tool: 'Agent' },
  ];

  for (const { file, tool } of libFiles) {
    await asyncTest(`${tool} lib exports checkPlaywrightMcpAvailability`, async () => {
      const content = await fs.readFile(path.join(srcDir, file), 'utf-8');
      assert.ok(content.includes('export const checkPlaywrightMcpAvailability'), `${file} should export checkPlaywrightMcpAvailability`);
    });
  }

  // ============================================================================
  // Verify solve.mjs includes MCP checks for all tools
  // ============================================================================

  console.log('\n📋 solve.mjs Playwright MCP Integration Tests\n');

  await asyncTest('solve.mjs checks Playwright MCP for opencode tool', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.mjs'), 'utf-8');
    assert.ok(content.includes('checkOpenCodePlaywrightMcp') || content.includes('checkPlaywrightMcpAvailability: checkOpenCodePlaywrightMcp'), 'solve.mjs should import Playwright MCP check for opencode');
  });

  await asyncTest('solve.mjs checks Playwright MCP for agent tool', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.mjs'), 'utf-8');
    assert.ok(content.includes('checkAgentPlaywrightMcp') || content.includes('checkPlaywrightMcpAvailability: checkAgentPlaywrightMcp'), 'solve.mjs should import Playwright MCP check for agent');
  });

  // ============================================================================
  // Verify solve.restart-shared.lib.mjs includes MCP checks for all tools
  // ============================================================================

  console.log('\n📋 solve.restart-shared.lib.mjs Playwright MCP Integration Tests\n');

  await asyncTest('solve.restart-shared.lib.mjs checks Playwright MCP for opencode tool', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.restart-shared.lib.mjs'), 'utf-8');
    const opencodeSection = content.indexOf("argv.tool === 'opencode'");
    const codexSection = content.indexOf("argv.tool === 'codex'");
    assert.ok(opencodeSection > -1, 'Should have opencode section');
    const betweenSections = content.substring(opencodeSection, codexSection > opencodeSection ? codexSection : undefined);
    assert.ok(betweenSections.includes('checkPlaywrightMcpAvailability'), 'OpenCode section should check Playwright MCP availability');
  });

  await asyncTest('solve.restart-shared.lib.mjs checks Playwright MCP for agent tool', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.restart-shared.lib.mjs'), 'utf-8');
    const agentSection = content.indexOf("argv.tool === 'agent'");
    assert.ok(agentSection > -1, 'Should have agent section');
    const afterAgent = content.substring(agentSection);
    assert.ok(afterAgent.includes('checkPlaywrightMcpAvailability'), 'Agent section should check Playwright MCP availability');
  });

  // ============================================================================
  // Verify config description includes all tools
  // ============================================================================

  console.log('\n📋 Config Description Tests\n');

  await asyncTest('config description mentions all tools', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.config.lib.mjs'), 'utf-8');
    const mcpConfigIndex = content.indexOf("'prompt-playwright-mcp'");
    assert.ok(mcpConfigIndex > -1, 'Config should have prompt-playwright-mcp option');
    const configSection = content.substring(mcpConfigIndex, mcpConfigIndex + 500);
    assert.ok(configSection.includes('opencode'), 'Config description should mention opencode');
    assert.ok(configSection.includes('agent'), 'Config description should mention agent');
    assert.ok(configSection.includes('claude'), 'Config description should mention claude');
    assert.ok(configSection.includes('codex'), 'Config description should mention codex');
  });

  // ============================================================================
  // Verify --playwright-mcp (physical disable) flag
  // ============================================================================

  console.log('\n📋 --playwright-mcp Physical Disable Flag Tests\n');

  await asyncTest('config has playwright-mcp option for physical disable', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.config.lib.mjs'), 'utf-8');
    assert.ok(content.includes("'playwright-mcp'"), 'Config should have playwright-mcp option');
    const mcpIndex = content.indexOf("'playwright-mcp'");
    const section = content.substring(mcpIndex, mcpIndex + 600);
    assert.ok(section.includes('physically disable'), 'Description should mention physical disabling');
    assert.ok(section.includes('--no-playwright-mcp'), 'Description should mention --no-playwright-mcp');
    assert.ok(section.includes('default: true'), 'Default should be true (enabled)');
  });

  await asyncTest('playwright-mcp.lib.mjs exports buildMcpConfigWithoutPlaywright', async () => {
    const content = await fs.readFile(path.join(srcDir, 'playwright-mcp.lib.mjs'), 'utf-8');
    assert.ok(content.includes('export const buildMcpConfigWithoutPlaywright'), 'playwright-mcp.lib.mjs should export buildMcpConfigWithoutPlaywright');
  });

  await asyncTest('command result helpers support command-stream code field', async () => {
    assert.equal(getCommandResultCode({ code: 0 }), 0, 'command-stream uses code for successful commands');
    assert.equal(getCommandResultCode({ exitCode: 0 }), 0, 'helpers should also support exitCode for compatible runners');
    assert.equal(isCommandResultSuccess({ code: 0 }), true, 'code=0 should be success');
    assert.equal(isCommandResultSuccess({ code: 1 }), false, 'code=1 should not be success');
  });

  await asyncTest('claude.lib.mjs uses --strict-mcp-config when playwrightMcp is false', async () => {
    const content = await fs.readFile(path.join(srcDir, 'claude.lib.mjs'), 'utf-8');
    assert.ok(content.includes('strict-mcp-config'), 'claude.lib.mjs should use --strict-mcp-config');
    assert.ok(content.includes('argv.playwrightMcp === false'), 'claude.lib.mjs should check playwrightMcp flag');
  });

  await asyncTest('playwright-mcp.lib.mjs exports Codex per-session disable helpers', async () => {
    const content = await fs.readFile(path.join(srcDir, 'playwright-mcp.lib.mjs'), 'utf-8');
    assert.ok(content.includes('export const getCodexPlaywrightMcpDisableConfigArgs'), 'should export getCodexPlaywrightMcpDisableConfigArgs');
    assert.ok(content.includes('mcp_servers.${name}.enabled=false'), 'should disable Codex MCP servers through config overrides');
    assert.ok(!content.includes('codex mcp remove'), 'should not mutate global Codex MCP registration');
    assert.ok(!content.includes('codex mcp add playwright'), 'should not restore by adding a hard-coded global registration');
  });

  await asyncTest('codex.lib.mjs disables Playwright MCP with per-command config overrides', async () => {
    const content = await fs.readFile(path.join(srcDir, 'codex.lib.mjs'), 'utf-8');
    assert.ok(content.includes('getCodexPlaywrightMcpDisableConfigArgs'), 'codex.lib.mjs should build per-command MCP disable args');
    assert.ok(content.includes('argv.playwrightMcp === false'), 'codex.lib.mjs should check playwrightMcp flag');
    assert.ok(!content.includes('codex mcp remove'), 'codex.lib.mjs should not remove global MCP registrations');
  });

  await asyncTest('Codex MCP server parser extracts Playwright registrations from list output', async () => {
    const output = `Name             Command  Args       Env  Cwd  Status    Auth
playwright       npx      @latest    -    -    enabled   Unsupported
playwright_alt   npx      @latest    -    -    disabled  Unsupported
github           docker   run        -    -    enabled   Unsupported`;
    assert.deepEqual(parseCodexMcpServerNames(output), ['playwright', 'playwright_alt', 'github']);
  });

  await asyncTest('shared helper collects Playwright MCP servers by name and command', async () => {
    const names = collectPlaywrightMcpServerNames({
      mcp: {
        playwright: { type: 'local', command: ['npx', '@playwright/mcp@latest'] },
        browser_tools: { type: 'local', command: ['npx', '-y', '@playwright/mcp'] },
        github: { type: 'remote', url: 'https://example.com/mcp' },
      },
    });
    assert.deepEqual(names.sort(), ['browser_tools', 'playwright']);
  });

  await asyncTest('shared helper builds session-scoped OpenCode/Agent disable config', async () => {
    const config = buildPlaywrightMcpDisableConfig(['browser_tools']);
    assert.equal(config.mcp.playwright.enabled, false, 'default playwright server should be disabled');
    assert.equal(config.mcp.browser_tools.enabled, false, 'detected Playwright server should be disabled');
    assert.equal(config.tools['playwright_*'], false, 'default Playwright tool glob should be disabled');
    assert.equal(config.tools['browser_tools_*'], false, 'detected server tool glob should be disabled');
  });

  await asyncTest('shared helper merges Playwright disable config with existing inline config', async () => {
    const merged = JSON.parse(
      mergePlaywrightMcpDisableConfigContent(
        JSON.stringify({
          model: 'opencode/nemotron-3-super-free',
          mcp: {
            browser_tools: {
              type: 'local',
              command: ['npx', '@playwright/mcp@latest'],
              enabled: true,
            },
          },
        })
      )
    );
    assert.equal(merged.model, 'opencode/nemotron-3-super-free', 'existing inline config should be preserved');
    assert.equal(merged.mcp.browser_tools.enabled, false, 'existing Playwright server should be disabled');
    assert.equal(merged.tools['browser_tools_*'], false, 'existing Playwright server tools should be disabled');
  });

  await asyncTest('OpenCode disable env uses OPENCODE_CONFIG_CONTENT without global mutation', async () => {
    const env = await getOpenCodePlaywrightMcpDisableEnv({
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          mcp: {
            browser_tools: {
              type: 'local',
              command: ['npx', '@playwright/mcp@latest'],
              enabled: true,
            },
          },
        }),
      },
      includeConfigFiles: false,
    });
    assert.ok(env.OPENCODE_CONFIG_CONTENT, 'OpenCode disable env should include OPENCODE_CONFIG_CONTENT');
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
    assert.equal(config.mcp.browser_tools.enabled, false, 'OpenCode env should disable detected Playwright server');
    assert.equal(config.tools['browser_tools_*'], false, 'OpenCode env should disable detected server tools');
  });

  await asyncTest('Agent disable env uses LINK_ASSISTANT_AGENT_CONFIG_CONTENT without global mutation', async () => {
    const env = await getAgentPlaywrightMcpDisableEnv({
      env: {
        LINK_ASSISTANT_AGENT_CONFIG_CONTENT: JSON.stringify({
          mcp: {
            playwright: {
              type: 'local',
              command: ['npx', '@playwright/mcp@latest'],
              enabled: true,
            },
          },
        }),
      },
      includeConfigFiles: false,
    });
    assert.ok(env.LINK_ASSISTANT_AGENT_CONFIG_CONTENT, 'Agent disable env should include LINK_ASSISTANT_AGENT_CONFIG_CONTENT');
    const config = JSON.parse(env.LINK_ASSISTANT_AGENT_CONFIG_CONTENT);
    assert.equal(config.mcp.playwright.enabled, false, 'Agent env should disable Playwright server');
    assert.equal(config.tools['playwright_*'], false, 'Agent env should disable Playwright tools');
  });

  await asyncTest('opencode.lib.mjs applies Playwright MCP disable env when playwrightMcp is false', async () => {
    const content = await fs.readFile(path.join(srcDir, 'opencode.lib.mjs'), 'utf-8');
    assert.ok(content.includes('argv.playwrightMcp === false'), 'opencode.lib.mjs should check playwrightMcp flag');
    assert.ok(content.includes('getOpenCodePlaywrightMcpDisableEnv'), 'opencode.lib.mjs should build a session-scoped disable env');
    assert.ok(content.includes('env: opencodeEnv'), 'opencode.lib.mjs should pass the disable env to the subprocess');
    assert.ok(content.includes('Playwright MCP physically disabled for this OpenCode session'), 'opencode.lib.mjs should log Playwright MCP disable');
  });

  await asyncTest('agent.lib.mjs applies Playwright MCP disable env when playwrightMcp is false', async () => {
    const content = await fs.readFile(path.join(srcDir, 'agent.lib.mjs'), 'utf-8');
    assert.ok(content.includes('argv.playwrightMcp === false'), 'agent.lib.mjs should check playwrightMcp flag');
    assert.ok(content.includes('getAgentPlaywrightMcpDisableEnv'), 'agent.lib.mjs should build a session-scoped disable env');
    assert.ok(content.includes('env: agentEnv'), 'agent.lib.mjs should pass the disable env to the subprocess');
    assert.ok(content.includes('Playwright MCP physically disabled for this Agent session'), 'agent.lib.mjs should log Playwright MCP disable');
  });

  await asyncTest('config --playwright-mcp description mentions all four tools', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.config.lib.mjs'), 'utf-8');
    const mcpIndex = content.indexOf("'playwright-mcp'");
    assert.ok(mcpIndex > -1, 'Config should have playwright-mcp option');
    const section = content.substring(mcpIndex, mcpIndex + 600);
    assert.ok(section.includes('opencode'), '--playwright-mcp description should mention opencode');
    assert.ok(section.includes('agent'), '--playwright-mcp description should mention agent');
    assert.ok(section.includes('claude'), '--playwright-mcp description should mention claude');
    assert.ok(section.includes('codex'), '--playwright-mcp description should mention codex');
  });

  await asyncTest('cascadePlaywrightMcpDisable turns off prompt and cleanup flags', async () => {
    const argv = {
      playwrightMcp: false,
      promptPlaywrightMcp: true,
      playwrightMcpAutoCleanup: true,
    };
    const logs = [];
    await cascadePlaywrightMcpDisable(argv, async message => logs.push(message));
    assert.equal(argv.promptPlaywrightMcp, false, '--no-playwright-mcp should disable prompt hints');
    assert.equal(argv.playwrightMcpAutoCleanup, false, '--no-playwright-mcp should disable MCP artifact cleanup');
    assert.ok(logs.length >= 2, 'disable cascade should log what changed');
  });

  await asyncTest('playwright-mcp.lib.mjs exports cascadePlaywrightMcpDisable', async () => {
    const content = await fs.readFile(path.join(srcDir, 'playwright-mcp.lib.mjs'), 'utf-8');
    assert.ok(content.includes('export const cascadePlaywrightMcpDisable'), 'should export cascadePlaywrightMcpDisable');
    assert.ok(content.includes('argv.promptPlaywrightMcp = false'), 'should disable promptPlaywrightMcp');
    assert.ok(content.includes('argv.playwrightMcpAutoCleanup = false'), 'should disable playwrightMcpAutoCleanup');
  });

  await asyncTest('solve.mjs uses cascadePlaywrightMcpDisable', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.mjs'), 'utf-8');
    assert.ok(content.includes('cascadePlaywrightMcpDisable'), 'solve.mjs should use cascadePlaywrightMcpDisable');
  });

  await asyncTest('solve.restart-shared.lib.mjs uses cascadePlaywrightMcpDisable', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.restart-shared.lib.mjs'), 'utf-8');
    assert.ok(content.includes('cascadePlaywrightMcpDisable'), 'restart-shared should use cascadePlaywrightMcpDisable');
  });

  // ============================================================================
  // Verify prompt builders produce correct output
  // ============================================================================

  console.log('\n📋 Prompt Builder Output Tests\n');

  await asyncTest('opencode buildSystemPrompt includes Playwright MCP when enabled', async () => {
    const { buildSystemPrompt } = await import('../src/opencode.prompts.lib.mjs');
    const prompt = buildSystemPrompt({
      owner: 'test-owner',
      repo: 'test-repo',
      issueNumber: 1,
      prNumber: 2,
      branchName: 'test-branch',
      argv: { promptPlaywrightMcp: true },
      modelSupportsVision: false,
    });
    assert.ok(prompt.includes('Playwright MCP usage'), 'Prompt should include Playwright MCP section when enabled');
    assert.ok(prompt.includes('WebSearch'), 'Prompt should include WebSearch fallback note');
  });

  await asyncTest('opencode buildSystemPrompt excludes Playwright MCP when disabled', async () => {
    const { buildSystemPrompt } = await import('../src/opencode.prompts.lib.mjs');
    const prompt = buildSystemPrompt({
      owner: 'test-owner',
      repo: 'test-repo',
      issueNumber: 1,
      prNumber: 2,
      branchName: 'test-branch',
      argv: { promptPlaywrightMcp: false },
      modelSupportsVision: false,
    });
    assert.ok(!prompt.includes('Playwright MCP usage'), 'Prompt should not include Playwright MCP section when disabled');
  });

  await asyncTest('agent buildSystemPrompt includes Playwright MCP when enabled', async () => {
    const { buildSystemPrompt } = await import('../src/agent.prompts.lib.mjs');
    const prompt = buildSystemPrompt({
      owner: 'test-owner',
      repo: 'test-repo',
      issueNumber: 1,
      prNumber: 2,
      branchName: 'test-branch',
      argv: { promptPlaywrightMcp: true },
      modelSupportsVision: false,
    });
    assert.ok(prompt.includes('Playwright MCP usage'), 'Prompt should include Playwright MCP section when enabled');
    assert.ok(prompt.includes('WebSearch'), 'Prompt should include WebSearch fallback note');
  });

  await asyncTest('agent buildSystemPrompt excludes Playwright MCP when disabled', async () => {
    const { buildSystemPrompt } = await import('../src/agent.prompts.lib.mjs');
    const prompt = buildSystemPrompt({
      owner: 'test-owner',
      repo: 'test-repo',
      issueNumber: 1,
      prNumber: 2,
      branchName: 'test-branch',
      argv: { promptPlaywrightMcp: false },
      modelSupportsVision: false,
    });
    assert.ok(!prompt.includes('Playwright MCP usage'), 'Prompt should not include Playwright MCP section when disabled');
  });

  // ============================================================================
  // Case Study Documentation Tests
  // ============================================================================

  console.log('\n📋 Case Study Documentation Tests\n');

  await asyncTest('case study documentation exists for issue 1623', async () => {
    const caseStudyPath = path.join(process.cwd(), 'docs/case-studies/issue-1623/README.md');
    const exists = await fs
      .stat(caseStudyPath)
      .then(() => true)
      .catch(() => false);
    assert.ok(exists, 'Case study README.md should exist for issue 1623');

    if (exists) {
      const content = await fs.readFile(caseStudyPath, 'utf-8');
      assert.ok(content.includes('Playwright MCP'), 'Case study should mention Playwright MCP');
      assert.ok(content.includes('WebFetch') || content.includes('WebSearch'), 'Case study should mention web tool fallback');
    }
  });

  // ============================================================================
  // Summary
  // ============================================================================

  console.log('\n========================================');
  console.log(`📊 Test Results: ${testsPassed} passed, ${testsFailed} failed`);
  console.log('========================================\n');

  process.exit(testsFailed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
