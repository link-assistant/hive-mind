#!/usr/bin/env node
// Playwright MCP session-level disable/restore utilities.
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const path = (await use('path')).default;

export const getCommandResultCode = result => result?.code ?? result?.exitCode ?? null;

export const getCommandResultOutput = result => `${result?.stdout?.toString() || ''}${result?.stderr?.toString() || ''}`;

export const isCommandResultSuccess = result => getCommandResultCode(result) === 0;

export const checkPlaywrightMcpPackageAvailability = async () => {
  try {
    const result = await $`timeout 5 npx --no-install @playwright/mcp --help 2>&1`.catch(() => null);
    if (isCommandResultSuccess(result)) return true;
    const npmResult = await $`timeout 5 npm ls -g @playwright/mcp 2>&1`.catch(() => null);
    return getCommandResultOutput(npmResult).includes('@playwright/mcp');
  } catch {
    return false;
  }
};

export const parseCodexMcpServerNames = output =>
  output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('Name '))
    .map(line => line.split(/\s+/)[0])
    .filter(name => /^[A-Za-z0-9_-]+$/.test(name));

export const getCodexPlaywrightMcpDisableConfigArgs = async log => {
  try {
    const result = await $`timeout 5 codex mcp list 2>&1`.catch(() => null);
    if (!isCommandResultSuccess(result)) return [];
    const names = parseCodexMcpServerNames(getCommandResultOutput(result)).filter(name => name.toLowerCase().includes('playwright'));
    if (names.length === 0) {
      if (log) await log('🎭 No Codex Playwright MCP server registration found to disable for this session', { verbose: true });
      return [];
    }
    if (log) {
      await log(`🎭 Playwright MCP disabled for this Codex session via config override: ${names.join(', ')}`, {
        verbose: true,
      });
    }
    return names.flatMap(name => ['-c', `mcp_servers.${name}.enabled=false`]);
  } catch (err) {
    if (log) await log(`⚠️  Could not build Codex Playwright MCP disable override: ${err.message}`, { verbose: true });
    return [];
  }
};

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

/** Cascade --no-playwright-mcp to disable related flags */
export const cascadePlaywrightMcpDisable = async (argv, log) => {
  if (argv.playwrightMcp === false) {
    if (log) await log('🎭 Playwright MCP physically disabled via --no-playwright-mcp', { verbose: true });
    argv.promptPlaywrightMcp = false;
    argv.playwrightMcpAutoCleanup = false;
    if (log) await log('ℹ️  --prompt-playwright-mcp and --playwright-mcp-auto-cleanup also disabled', { verbose: true });
  }
};
