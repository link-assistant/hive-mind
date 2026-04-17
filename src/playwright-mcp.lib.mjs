#!/usr/bin/env node
// Playwright MCP session-level disable/restore utilities.
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;

/** Build a temporary MCP config JSON excluding Playwright, for use with --strict-mcp-config */
export const buildMcpConfigWithoutPlaywright = async log => {
  const os = await use('os');
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    const claudeJson = JSON.parse(await fs.readFile(claudeJsonPath, 'utf-8'));
    const mcpServers = claudeJson.mcpServers || {};
    const filtered = {};
    for (const [name, config] of Object.entries(mcpServers)) {
      if (name.toLowerCase().includes('playwright')) continue;
      filtered[name] = config;
    }
    const tempConfigPath = path.join(os.tmpdir(), `claude-mcp-no-playwright-${Date.now()}-${process.pid}.json`);
    await fs.writeFile(tempConfigPath, JSON.stringify({ mcpServers: filtered }, null, 2));
    if (log) await log(`🎭 Created filtered MCP config (without Playwright): ${tempConfigPath}`, { verbose: true });
    return tempConfigPath;
  } catch (err) {
    if (log) await log(`⚠️  Could not build filtered MCP config: ${err.message}`, { verbose: true });
    return null;
  }
};

/** Temporarily remove Playwright MCP from Codex for this session, returning restore info */
export const disableCodexPlaywrightMcpForSession = async log => {
  try {
    const listResult = await $`timeout 5 codex mcp list 2>&1`.catch(() => null);
    if (!listResult) return null;
    const output = `${listResult.stdout?.toString() || ''}${listResult.stderr?.toString() || ''}`;
    if (!output.toLowerCase().includes('playwright')) return null;
    await $`codex mcp remove playwright 2>&1`.catch(() => null);
    if (log) await log('🎭 Playwright MCP temporarily removed from Codex for this session', { verbose: true });
    return { wasPresent: true };
  } catch (err) {
    if (log) await log(`⚠️  Could not disable Playwright MCP for Codex: ${err.message}`, { verbose: true });
    return null;
  }
};

/** Restore Playwright MCP to Codex after session */
export const restoreCodexPlaywrightMcpForSession = async log => {
  try {
    await $`codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080 2>&1`.catch(() => null);
    if (log) await log('🎭 Playwright MCP restored to Codex after session', { verbose: true });
  } catch (err) {
    if (log) await log(`⚠️  Could not restore Playwright MCP for Codex: ${err.message}`, { verbose: true });
  }
};

/** Cascade --no-playwright-mcp to disable related flags */
export const cascadePlaywrightMcpDisable = async (argv, log) => {
  if (argv.playwrightMcp === false) {
    await log('🎭 Playwright MCP physically disabled via --no-playwright-mcp', { verbose: true });
    argv.promptPlaywrightMcp = false;
    argv.playwrightMcpAutoCleanup = false;
    await log('ℹ️  --prompt-playwright-mcp and --playwright-mcp-auto-cleanup also disabled', { verbose: true });
  }
};
