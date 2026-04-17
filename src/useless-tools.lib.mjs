#!/usr/bin/env node
// Useless Claude Code tools and MCP servers for autonomous headless workflows.
//
// Hive-mind runs `claude` inside Docker with `--print --dangerously-skip-permissions`
// and no human operator. Several built-in Claude Code tools and three `claude.ai`
// OAuth MCP connectors are active by default but either:
//   - wait for a human reaction that will never come (`AskUserQuestion`,
//     `EnterPlanMode`);
//   - have side effects that outlive the session (`CronCreate`,
//     `EnterWorktree`);
//   - can never complete authentication without an interactive browser
//     (`claude.ai Gmail`, `claude.ai Google Drive`, `claude.ai Google Calendar`).
//
// This module centralises the block-list and provides helpers that both the
// Docker image baseline and the `solve` runtime use to disable them.
//
// Related issue: https://github.com/link-assistant/hive-mind/issues/1627

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const fs = (await use('fs')).promises;
const os = await use('os');
const path = (await use('path')).default;

/**
 * Built-in Claude Code tools that have no value (and may be harmful) in
 * autonomous headless hive-mind runs. Every entry is a tool name as it
 * appears in the stream-json `tools` array emitted by `claude --verbose`.
 */
export const USELESS_CLAUDE_BUILTIN_TOOLS = Object.freeze([
  'AskUserQuestion',
  'CronCreate',
  'CronDelete',
  'CronList',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Monitor',
  'NotebookEdit',
  'PushNotification',
  'RemoteTrigger',
  'ScheduleWakeup',
]);

/**
 * Name prefixes of MCP servers that are always unusable in headless Docker
 * runs because they require interactive OAuth that cannot complete without
 * a browser. Match is case-insensitive on the full MCP server name.
 */
export const USELESS_MCP_SERVER_NAME_PREFIXES = Object.freeze(['claude.ai gmail', 'claude.ai google drive', 'claude.ai google calendar']);

/**
 * MCP tool-name prefixes derived from {@link USELESS_MCP_SERVER_NAME_PREFIXES}.
 * Claude Code exposes MCP tools as `mcp__<server-name-slug>__<tool-name>`,
 * replacing non-alphanumerics in the server name with `_`. Passing these
 * entries to `--disallowedTools` is a belt-and-braces measure that complements
 * filtering the MCP server itself.
 */
export const USELESS_MCP_TOOL_NAME_PREFIXES = Object.freeze([
  'mcp__claude_ai_Gmail',
  'mcp__claude_ai_Google_Drive',
  'mcp__claude_ai_Google_Calendar',
]);

/**
 * Tool identifiers accepted by `claude --disallowedTools ...`. This is a
 * flat list combining the built-in tools with the wildcard forms of the
 * useless MCP tool-name prefixes.
 */
export const buildDisallowedToolsList = () => [
  ...USELESS_CLAUDE_BUILTIN_TOOLS,
  ...USELESS_MCP_TOOL_NAME_PREFIXES.map(prefix => `${prefix}__*`),
];

/**
 * Returns true if `name` matches one of the useless MCP server prefixes.
 */
export const isUselessMcpServerName = name => {
  if (!name || typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return USELESS_MCP_SERVER_NAME_PREFIXES.some(prefix => lower.startsWith(prefix));
};

/**
 * Returns the set of MCP server entries from an object (typically
 * `~/.claude.json` `mcpServers` block) with useless entries removed.
 */
export const filterMcpServersObject = (mcpServers = {}) => {
  const filtered = {};
  for (const [name, config] of Object.entries(mcpServers || {})) {
    if (isUselessMcpServerName(name)) continue;
    filtered[name] = config;
  }
  return filtered;
};

/**
 * Build a temporary MCP config JSON file that filters out both the three
 * `claude.ai` OAuth connectors and (optionally) Playwright.
 *
 * Designed to be used with `--strict-mcp-config --mcp-config <file>` so the
 * excluded servers are not even advertised to the model for this run.
 *
 * @param {Object} [options]
 * @param {boolean} [options.excludePlaywright] - Also exclude Playwright.
 * @param {Function} [options.log] - Async logger with (msg, opts) signature.
 * @returns {Promise<string|null>} absolute path to the temp config, or null
 *   if the home `.claude.json` file cannot be read (fatal errors are
 *   caught — callers should treat `null` as "skip --strict-mcp-config").
 */
export const buildFilteredMcpConfig = async ({ excludePlaywright = false, log } = {}) => {
  try {
    const claudeJsonPath = path.join(os.homedir(), '.claude.json');
    const claudeJson = JSON.parse(await fs.readFile(claudeJsonPath, 'utf-8'));
    const mcpServers = claudeJson.mcpServers || {};
    const filtered = {};
    for (const [name, config] of Object.entries(mcpServers)) {
      if (isUselessMcpServerName(name)) continue;
      if (excludePlaywright && name.toLowerCase().includes('playwright')) continue;
      filtered[name] = config;
    }
    const suffix = excludePlaywright ? 'no-playwright-no-useless' : 'no-useless';
    const tempConfigPath = path.join(os.tmpdir(), `claude-mcp-${suffix}-${Date.now()}-${process.pid}.json`);
    await fs.writeFile(tempConfigPath, JSON.stringify({ mcpServers: filtered }, null, 2));
    if (log) {
      const excluded = [...USELESS_MCP_SERVER_NAME_PREFIXES.map(p => `'${p}*'`), ...(excludePlaywright ? ["'playwright*'"] : [])].join(', ');
      await log(`🧰 Created filtered MCP config (excluding ${excluded}): ${tempConfigPath}`, { verbose: true });
    }
    return tempConfigPath;
  } catch (err) {
    if (log) await log(`⚠️  Could not build filtered useless-MCP config: ${err.message}`, { verbose: true });
    return null;
  }
};

/**
 * Resolve the per-session Claude CLI args for the useless-tools flag and the
 * playwright-mcp flag in a single step. Returns an object with:
 *   - mcpConfigPath (string|null): temp file path for `--strict-mcp-config --mcp-config`
 *   - disallowedToolsList (string[]): values for `--disallowedTools`
 *
 * Callers are expected to append the returned values to the Claude command.
 * Extracted from claude.lib.mjs to keep that file under the 1500-line cap.
 */
export const resolveClaudeSessionToolFlags = async ({ argv, log, fallbackBuildMcpConfigWithoutPlaywright } = {}) => {
  const uselessToolsDisabled = argv?.uselessToolsDisabled !== false;
  const excludePlaywright = argv?.playwrightMcp === false;
  let mcpConfigPath = null;
  if (uselessToolsDisabled || excludePlaywright) {
    mcpConfigPath = await buildFilteredMcpConfig({ excludePlaywright, log });
    if (!mcpConfigPath && excludePlaywright && fallbackBuildMcpConfigWithoutPlaywright) {
      mcpConfigPath = await fallbackBuildMcpConfigWithoutPlaywright(log);
    }
    if (mcpConfigPath && log) {
      if (excludePlaywright) await log('🎭 Playwright MCP physically disabled for this session via --strict-mcp-config', { verbose: true });
      if (uselessToolsDisabled) await log('🧰 Useless MCP servers (claude.ai Gmail/Drive/Calendar) disabled for this session via --strict-mcp-config (issue #1627)', { verbose: true });
    }
  }
  const disallowedToolsList = uselessToolsDisabled ? buildDisallowedToolsList() : [];
  if (uselessToolsDisabled && log) await log(`🧰 Disallowed ${disallowedToolsList.length} useless Claude Code tool(s) for this session (issue #1627)`, { verbose: true });
  return { mcpConfigPath, disallowedToolsList };
};

/**
 * Persist `disallowedTools` in `~/.claude/settings.json` so even interactive
 * `claude` sessions launched outside of `solve` don't surface the useless
 * tools. Existing entries in the settings file are preserved (shallow
 * merge) and any existing `disallowedTools` list has the useless tools
 * added to it without duplicates. Returns the set of tools that were
 * newly added.
 */
export const ensureDisallowedToolsInSettings = async ({ settingsPath, log } = {}) => {
  const resolvedPath = settingsPath || path.join(os.homedir(), '.claude', 'settings.json');
  const toBlock = buildDisallowedToolsList();
  let settings = {};
  try {
    const content = await fs.readFile(resolvedPath, 'utf-8');
    settings = JSON.parse(content);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) settings = {};
  } catch (err) {
    if (err.code !== 'ENOENT' && log) {
      await log(`⚠️  Could not read ${resolvedPath}: ${err.message}`, { verbose: true });
    }
    settings = {};
  }
  const existing = Array.isArray(settings.disallowedTools) ? settings.disallowedTools : [];
  const merged = [...existing];
  const added = [];
  for (const tool of toBlock) {
    if (!merged.includes(tool)) {
      merged.push(tool);
      added.push(tool);
    }
  }
  settings.disallowedTools = merged;
  try {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, JSON.stringify(settings, null, 2));
    if (log && added.length) {
      await log(`🧰 Added ${added.length} useless tool(s) to ${resolvedPath} disallowedTools`, { verbose: true });
    }
  } catch (err) {
    if (log) await log(`⚠️  Could not write ${resolvedPath}: ${err.message}`, { verbose: true });
  }
  return { added, total: merged.length, path: resolvedPath };
};
