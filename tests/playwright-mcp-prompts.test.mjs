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
      assert.ok(
        content.includes('WebFetch') || content.includes('fetch-based browsing'),
        `${file} should mention WebFetch fallback to Playwright MCP`,
      );
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
    assert.ok(content.includes("checkOpenCodePlaywrightMcp") || content.includes("checkPlaywrightMcpAvailability: checkOpenCodePlaywrightMcp"), 'solve.mjs should import Playwright MCP check for opencode');
  });

  await asyncTest('solve.mjs checks Playwright MCP for agent tool', async () => {
    const content = await fs.readFile(path.join(srcDir, 'solve.mjs'), 'utf-8');
    assert.ok(content.includes("checkAgentPlaywrightMcp") || content.includes("checkPlaywrightMcpAvailability: checkAgentPlaywrightMcp"), 'solve.mjs should import Playwright MCP check for agent');
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
    const exists = await fs.stat(caseStudyPath).then(() => true).catch(() => false);
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
