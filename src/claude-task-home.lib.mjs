import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveClaudeConfigDirectory, resolveClaudeCredentialDirectory } from './claude-paths.lib.mjs';
import { CLAUDE_PROMPT_CACHE_DEFAULTS, isClaudePromptCacheTtl } from './claude-prompt-cache.lib.mjs';
import { prepareStorageDirectory } from './storage-directory.lib.mjs';

const playwright = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest', '--isolated', '--headless', '--no-sandbox', '--timeout-action=600000', '--viewport-size', '1920x1080'],
};

async function taskPreferences(configDir, log) {
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(path.join(configDir, 'settings.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' && log) await log('⚠️  Could not read Claude root preferences. Using task defaults.', { verbose: true });
    return {};
  }
  const preferences = {};
  if (typeof settings?.language === 'string') preferences.language = settings.language;
  for (const key of Object.keys(CLAUDE_PROMPT_CACHE_DEFAULTS)) {
    if (isClaudePromptCacheTtl(settings?.[key])) preferences[key] = settings[key];
  }
  return preferences;
}

/** Direct, Screen and tmux solves need a fresh Claude config directory too. */
export async function prepareClaudeTaskHome({ homeDir = os.homedir(), env = process.env, tempDir = os.tmpdir(), enablePlaywright = true, log } = {}) {
  const history = resolveClaudeConfigDirectory(env, homeDir);
  const scope = await fs.mkdtemp(path.join(tempDir, 'hive-claude-'));
  const dispose = () => fs.rm(scope, { recursive: true, force: true });
  try {
    for (const name of ['projects', 'sessions']) {
      const shared = path.join(history, name);
      await prepareStorageDirectory(shared);
      await fs.symlink(shared, path.join(scope, name), 'dir');
    }
    const settingsPath = path.join(scope, 'settings.json');
    const preferences = await taskPreferences(history, log);
    if (Object.keys(preferences).length) await fs.writeFile(settingsPath, JSON.stringify(preferences), { mode: 0o600 });
    const mcpStatePath = path.join(scope, '.claude.json');
    await fs.writeFile(mcpStatePath, JSON.stringify({ hasCompletedOnboarding: true, mcpServers: enablePlaywright ? { playwright } : {} }), { mode: 0o600 });
    return {
      env: { CLAUDE_CONFIG_DIR: scope, CLAUDE_SECURESTORAGE_CONFIG_DIR: resolveClaudeCredentialDirectory(env, homeDir) },
      settingsPath,
      mcpStatePath,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
