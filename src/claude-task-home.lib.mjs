import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveClaudeConfigDirectory, resolveClaudeCredentialDirectory } from './claude-paths.lib.mjs';
import { prepareStorageDirectory } from './storage-directory.lib.mjs';

const playwright = {
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest', '--isolated', '--headless', '--no-sandbox', '--timeout-action=600000', '--viewport-size', '1920x1080'],
};

/** Direct, Screen and tmux solves need a fresh Claude config directory too. */
export async function prepareClaudeTaskHome({ homeDir = os.homedir(), env = process.env, tempDir = os.tmpdir(), enablePlaywright = true } = {}) {
  const history = resolveClaudeConfigDirectory(env, homeDir);
  const scope = await fs.mkdtemp(path.join(tempDir, 'hive-claude-'));
  const dispose = () => fs.rm(scope, { recursive: true, force: true });
  try {
    for (const name of ['projects', 'sessions']) {
      const shared = path.join(history, name);
      await prepareStorageDirectory(shared);
      await fs.symlink(shared, path.join(scope, name), 'dir');
    }
    const mcpStatePath = path.join(scope, '.claude.json');
    await fs.writeFile(mcpStatePath, JSON.stringify({ hasCompletedOnboarding: true, mcpServers: enablePlaywright ? { playwright } : {} }), { mode: 0o600 });
    return {
      env: { CLAUDE_CONFIG_DIR: scope, CLAUDE_SECURESTORAGE_CONFIG_DIR: resolveClaudeCredentialDirectory(env, homeDir) },
      settingsPath: path.join(scope, 'settings.json'),
      mcpStatePath,
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
