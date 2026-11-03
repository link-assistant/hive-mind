/** Native Linux Claude 2.1.310 configuration and credential-root selection. */
import path from 'node:path';

export const resolveClaudeConfigDirectory = (env, homeDir) => (env.CLAUDE_CONFIG_DIR || path.join(homeDir, '.claude')).normalize('NFC');

export function resolveClaudeCredentialDirectory(env, homeDir) {
  if (env.HIVE_MIND_CLAUDE_AUTH_IDENTITY !== undefined && !env.CLAUDE_SECURESTORAGE_CONFIG_DIR) throw new Error('Canonical Claude authentication storage is unavailable or unsafe.');
  // Presence matters: empty pins the conventional store even if config moved.
  return (env.CLAUDE_SECURESTORAGE_CONFIG_DIR !== undefined ? env.CLAUDE_SECURESTORAGE_CONFIG_DIR || path.join(homeDir, '.claude') : resolveClaudeConfigDirectory(env, homeDir)).normalize('NFC');
}
