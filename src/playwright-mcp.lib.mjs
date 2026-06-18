#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';
// Playwright MCP session-level disable/restore utilities.
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const { $ } = await use('command-stream');
const fs = (await use('fs')).promises;
const os = await use('os');
const path = (await use('path')).default;

export const getCommandResultCode = result => result?.code ?? result?.exitCode ?? null;

export const getCommandResultOutput = result => `${result?.stdout?.toString() || ''}${result?.stderr?.toString() || ''}`;

export const isCommandResultSuccess = result => getCommandResultCode(result) === 0;

export const PLAYWRIGHT_MCP_UNAVAILABLE_PATTERN = /\b(pending|disabled|failed|error|disconnected|not[-_\s]+connected|unavailable|timed[-_\s]+out)\b|(?:^|[^A-Za-z0-9_-])timeout(?:$|[^A-Za-z0-9_-])|\benabled\s*[:=]?\s*false\b/i;
export const PLAYWRIGHT_MCP_CONNECTED_PATTERN = /\b(connected|enabled)\b|[✓✔]/i;

export const getPlaywrightMcpListRows = output =>
  String(output || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.toLowerCase().includes('playwright'));

export const hasConnectedPlaywrightMcpServer = output => {
  const rows = getPlaywrightMcpListRows(output);
  if (rows.length === 0) return false;
  return rows.some(row => PLAYWRIGHT_MCP_CONNECTED_PATTERN.test(row) && !PLAYWRIGHT_MCP_UNAVAILABLE_PATTERN.test(row));
};

// `claude mcp list` / `codex mcp list` perform live health checks against every
// registered MCP server (Playwright MCP launches a browser to report status),
// which can take noticeably longer than a couple of seconds on a cold cache or
// a busy CI host. A too-aggressive `timeout` kills the probe before it answers,
// which previously aborted the entire solve (issue #1943). The probe timeout is
// therefore generous by default and overridable for slow/fast environments.
export const PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT = 30;

export const getPlaywrightMcpListTimeoutSeconds = (env = process.env) => {
  const parsed = Number.parseInt(env?.PLAYWRIGHT_MCP_PREFLIGHT_TIMEOUT_SECONDS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PLAYWRIGHT_MCP_LIST_TIMEOUT_SECONDS_DEFAULT;
};

const diagLog =
  (log, opts = { verbose: true }) =>
  async message => {
    if (log) await log(message, opts);
  };

export const checkPlaywrightMcpPackageAvailability = async ({ log } = {}) => {
  const diag = diagLog(log);
  try {
    const timeoutSeconds = getPlaywrightMcpListTimeoutSeconds();
    const result = await $`timeout ${timeoutSeconds} npx --no-install @playwright/mcp --help 2>&1`.catch(() => null);
    if (isCommandResultSuccess(result)) {
      await diag('🎭 @playwright/mcp package is available via npx');
      return true;
    }
    const npmResult = await $`timeout ${timeoutSeconds} npm ls -g @playwright/mcp 2>&1`.catch(() => null);
    const available = getCommandResultOutput(npmResult).includes('@playwright/mcp');
    await diag(`🎭 @playwright/mcp global package ${available ? 'is installed' : 'was not found'}`);
    return available;
  } catch (error) {
    await diag(`⚠️  @playwright/mcp package availability check threw: ${error.message}`);
    return false;
  }
};

export const ensureConnectedPlaywrightMcpServer = async ({ list, add, hasPackage = checkPlaywrightMcpPackageAvailability, log } = {}) => {
  const diag = diagLog(log);
  try {
    const result = await list().catch(() => null);
    const code = getCommandResultCode(result);
    const output = getCommandResultOutput(result);
    const rows = getPlaywrightMcpListRows(output);
    await diag(`🎭 Playwright MCP probe: 'mcp list' exit=${code === null ? 'timeout/none' : code}, playwright rows=${rows.length}${rows.length ? ` [${rows.join(' | ')}]` : ''}`);

    // Inconclusive probe: the `mcp list` command itself failed (timed out,
    // crashed, or its binary is missing). That tells us NOTHING about whether
    // Playwright MCP actually works, so it must not abort the whole solve as it
    // did in issue #1943. A still-connecting server is normal — Tool Search
    // loads MCP tools on demand (issue #1901) — so fall back to the local
    // @playwright/mcp package check: if the package is installed, the server can
    // connect on demand and the working session should proceed.
    if (!isCommandResultSuccess(result)) {
      const packageAvailable = await hasPackage({ log });
      await diag(`⚠️  Playwright MCP 'mcp list' probe was inconclusive (exit=${code === null ? 'timeout' : code}); @playwright/mcp package ${packageAvailable ? 'is installed, so Tool Search can connect it on demand — preflight passes' : 'is NOT installed — preflight fails'}`);
      return packageAvailable;
    }

    if (hasConnectedPlaywrightMcpServer(output)) {
      await diag('🎭 Playwright MCP reported as connected by mcp list');
      return true;
    }

    // A registration row exists but is not reported connected (pending /
    // disabled / failed). Leave it untouched (do not overwrite an intentional
    // or in-progress registration) and let the caller decide.
    if (rows.length > 0) {
      await diag('🎭 Playwright MCP is registered but not reported connected by mcp list; leaving registration unchanged');
      return false;
    }

    // No registration at all → register the default server when the package is
    // available, then re-probe.
    if (!(await hasPackage({ log }))) {
      await diag('⚠️  No Playwright MCP registration found and @playwright/mcp package is unavailable');
      return false;
    }
    await diag('🎭 No Playwright MCP registration found; registering the default server...');
    await add().catch(() => null);
    const retryResult = await list().catch(() => null);
    const connected = isCommandResultSuccess(retryResult) && hasConnectedPlaywrightMcpServer(getCommandResultOutput(retryResult));
    await diag(`🎭 Playwright MCP registration ${connected ? 'succeeded and is now connected' : 'did not report connected after add'}`);
    return connected;
  } catch (error) {
    await diag(`⚠️  Playwright MCP preflight probe threw: ${error.message}`);
    return false;
  }
};

export const ensureClaudePlaywrightMcpServer = async ({ log } = {}) =>
  ensureConnectedPlaywrightMcpServer({
    list: () => $`timeout ${getPlaywrightMcpListTimeoutSeconds()} claude mcp list 2>&1`,
    add: () => $`claude mcp add playwright -s user -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080`,
    log,
  });

export const ensureCodexPlaywrightMcpServer = async ({ log } = {}) =>
  ensureConnectedPlaywrightMcpServer({
    list: () => $`timeout ${getPlaywrightMcpListTimeoutSeconds()} codex mcp list 2>&1`,
    add: () => $`codex mcp add playwright -- npx -y @playwright/mcp@latest --isolated --headless --no-sandbox --timeout-action=600000 --viewport-size 1920x1080`,
    log,
  });

const SOLVE_PLAYWRIGHT_MCP_CHECKS = {
  claude: ensureClaudePlaywrightMcpServer,
  codex: ensureCodexPlaywrightMcpServer,
  opencode: checkPlaywrightMcpPackageAvailability,
  agent: checkPlaywrightMcpPackageAvailability,
  gemini: checkPlaywrightMcpPackageAvailability,
  qwen: checkPlaywrightMcpPackageAvailability,
};

const SOLVE_PLAYWRIGHT_MCP_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  agent: 'Agent',
  gemini: 'Gemini',
  qwen: 'Qwen Code',
};

export const getSolvePlaywrightMcpCheckTool = (argv = {}) => argv.tool || 'claude';

export const ensureSolvePlaywrightMcpReady = async ({ argv = {}, log = async () => {}, checks = SOLVE_PLAYWRIGHT_MCP_CHECKS } = {}) => {
  if (argv.playwrightMcp === false) {
    await log('🎭 Playwright MCP preflight skipped because --no-playwright-mcp is set', { verbose: true });
    return { ok: true, checkedTools: [], skipped: true };
  }

  const tool = getSolvePlaywrightMcpCheckTool(argv);
  const label = SOLVE_PLAYWRIGHT_MCP_LABELS[tool] || tool;
  const checkFn = checks[tool] || SOLVE_PLAYWRIGHT_MCP_CHECKS[tool] || checkPlaywrightMcpPackageAvailability;
  await log(`🎭 Checking Playwright MCP preflight for ${label}...`, { verbose: true });

  try {
    if (await checkFn({ log })) {
      await log(`🎭 Playwright MCP ready for ${label}`, { verbose: true });
      return { ok: true, checkedTools: [tool], skipped: false };
    }
  } catch (error) {
    await log(`⚠️  Playwright MCP preflight check threw for ${label}: ${error.message}`, { verbose: true });
  }

  await log('', { level: 'error' });
  await log(`❌ Playwright MCP preflight failed for ${label}`, { level: 'error' });
  await log('   Playwright support is enabled by default, so solve stops before starting an AI working session.', { level: 'error' });
  await log('   Fix the MCP registration or run with --no-playwright-mcp only when browser automation is intentionally disabled.', { level: 'error' });
  await log('');
  return { ok: false, checkedTools: [tool], skipped: false };
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

const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value);

const mergeDeep = (base, override) => {
  const result = { ...(isPlainObject(base) ? base : {}) };
  for (const [key, value] of Object.entries(isPlainObject(override) ? override : {})) {
    result[key] = isPlainObject(result[key]) && isPlainObject(value) ? mergeDeep(result[key], value) : value;
  }
  return result;
};

const stripJsonComments = input => {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index++;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) index++;
      index++;
      continue;
    }
    output += char;
  }
  return output;
};

const stripTrailingCommas = input => {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === ',') {
      let lookahead = index + 1;
      while (/\s/.test(input[lookahead] || '')) lookahead++;
      if (input[lookahead] === '}' || input[lookahead] === ']') continue;
    }
    output += char;
  }
  return output;
};

const parseConfigContent = content => {
  if (!content || typeof content !== 'string') return {};
  try {
    return JSON.parse(content);
  } catch {
    try {
      return JSON.parse(stripTrailingCommas(stripJsonComments(content)));
    } catch {
      return {};
    }
  }
};

const readConfigFile = async filePath => {
  const content = await fs.readFile(filePath, 'utf-8').catch(() => null);
  return parseConfigContent(content);
};

const pathExists = async filePath =>
  fs
    .stat(filePath)
    .then(() => true)
    .catch(() => false);

const findUpConfigPaths = async (startDir, filenames) => {
  const results = [];
  let dir = startDir || process.cwd();
  while (dir) {
    for (const file of filenames) results.push(path.join(dir, file));
    if (await pathExists(path.join(dir, '.git'))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return results;
};

const configFilesInDir = dir => (dir ? ['config.json', 'opencode.json', 'opencode.jsonc'].map(file => path.join(dir, file)) : []);

const isPlaywrightMcpEntry = (name, config) => {
  const haystack = `${name || ''} ${JSON.stringify(config || {})}`.toLowerCase();
  return haystack.includes('playwright');
};

export const collectPlaywrightMcpServerNames = (...configs) => {
  const names = new Set();
  for (const config of configs.flat()) {
    if (!isPlainObject(config?.mcp)) continue;
    for (const [name, mcpConfig] of Object.entries(config.mcp)) {
      if (isPlaywrightMcpEntry(name, mcpConfig)) names.add(name);
    }
  }
  return [...names];
};

export const buildPlaywrightMcpDisableConfig = (serverNames = []) => {
  const names = [...new Set(['playwright', ...serverNames].filter(Boolean))];
  const mcp = {};
  const tools = {
    '*playwright*': false,
    'mcp__playwright__*': false,
  };
  for (const name of names) {
    mcp[name] = {
      type: 'local',
      command: ['npx', '-y', '@playwright/mcp@latest'],
      enabled: false,
    };
    tools[`${name}_*`] = false;
    tools[`mcp__${name}__*`] = false;
  }
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp,
    tools,
  };
};

export const mergePlaywrightMcpDisableConfigContent = (existingContent = '', serverNames = []) => {
  const existingConfig = parseConfigContent(existingContent);
  const detectedNames = collectPlaywrightMcpServerNames(existingConfig);
  const disableConfig = buildPlaywrightMcpDisableConfig([...serverNames, ...detectedNames]);
  return JSON.stringify(mergeDeep(existingConfig, disableConfig), null, 2);
};

const collectPlaywrightMcpServerNamesFromFiles = async filePaths => {
  const configs = [];
  for (const filePath of filePaths) configs.push(await readConfigFile(filePath));
  return collectPlaywrightMcpServerNames(configs);
};

const getConfigHome = env => env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');

const getOpenCodeConfigFilePaths = async ({ env = process.env, cwd = process.cwd() } = {}) => [...configFilesInDir(path.join(getConfigHome(env), 'opencode')), ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []), ...(await findUpConfigPaths(cwd, ['opencode.jsonc', 'opencode.json'])), ...configFilesInDir(env.OPENCODE_CONFIG_DIR)];

const getAgentConfigFilePaths = async ({ env = process.env, cwd = process.cwd() } = {}) => [...configFilesInDir(path.join(getConfigHome(env), 'link-assistant-agent')), ...(env.LINK_ASSISTANT_AGENT_CONFIG ? [env.LINK_ASSISTANT_AGENT_CONFIG] : []), ...(env.OPENCODE_CONFIG ? [env.OPENCODE_CONFIG] : []), ...(await findUpConfigPaths(cwd, ['opencode.jsonc', 'opencode.json'])), ...configFilesInDir(path.join(cwd, '.link-assistant-agent')), ...configFilesInDir(path.join(cwd, '.opencode')), ...configFilesInDir(env.LINK_ASSISTANT_AGENT_CONFIG_DIR), ...configFilesInDir(env.OPENCODE_CONFIG_DIR)];

export const getOpenCodePlaywrightMcpDisableEnv = async ({ env = process.env, cwd = process.cwd(), includeConfigFiles = true, log } = {}) => {
  const inlineConfig = env.OPENCODE_CONFIG_CONTENT || '';
  const names = collectPlaywrightMcpServerNames(parseConfigContent(inlineConfig));
  if (includeConfigFiles) {
    names.push(...(await collectPlaywrightMcpServerNamesFromFiles(await getOpenCodeConfigFilePaths({ env, cwd }))));
  }
  const uniqueNames = [...new Set(names)];
  const displayNames = [...new Set(['playwright', ...uniqueNames])];
  if (log) await log(`🎭 OpenCode Playwright MCP disabled through OPENCODE_CONFIG_CONTENT for: ${displayNames.join(', ')}`, { verbose: true });
  return {
    OPENCODE_CONFIG_CONTENT: mergePlaywrightMcpDisableConfigContent(inlineConfig, uniqueNames),
  };
};

export const getAgentPlaywrightMcpDisableEnv = async ({ env = process.env, cwd = process.cwd(), includeConfigFiles = true, log } = {}) => {
  const agentInlineConfig = env.LINK_ASSISTANT_AGENT_CONFIG_CONTENT || env.OPENCODE_CONFIG_CONTENT || '';
  const names = collectPlaywrightMcpServerNames(parseConfigContent(agentInlineConfig), parseConfigContent(env.OPENCODE_CONFIG_CONTENT || ''));
  if (includeConfigFiles) {
    names.push(...(await collectPlaywrightMcpServerNamesFromFiles(await getAgentConfigFilePaths({ env, cwd }))));
  }
  const uniqueNames = [...new Set(names)];
  const displayNames = [...new Set(['playwright', ...uniqueNames])];
  const configContent = mergePlaywrightMcpDisableConfigContent(agentInlineConfig, uniqueNames);
  if (log) await log(`🎭 Agent Playwright MCP disabled through LINK_ASSISTANT_AGENT_CONFIG_CONTENT for: ${displayNames.join(', ')}`, { verbose: true });
  return {
    LINK_ASSISTANT_AGENT_CONFIG_CONTENT: configContent,
    OPENCODE_CONFIG_CONTENT: mergePlaywrightMcpDisableConfigContent(env.OPENCODE_CONFIG_CONTENT || agentInlineConfig, uniqueNames),
  };
};

/** Build a temporary MCP config JSON excluding Playwright, for use with --strict-mcp-config */
export const buildMcpConfigWithoutPlaywright = async log => {
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
