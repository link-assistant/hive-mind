/** Account-synced capabilities must not repopulate the minimal global home.
 * Claude 2.1.310: skills/plugins sync by default; connectors default to enabled.
 * https://code.claude.com/docs/en/settings-reference#syncclaudeaiskills
 * https://code.claude.com/docs/en/settings-reference#syncclaudeaiplugins
 * https://code.claude.com/docs/en/settings-reference#disableclaudeaiconnectors
 */
export const CLAUDE_CLOUD_DISABLE_SETTINGS = Object.freeze({
  syncClaudeAiSkills: false,
  syncClaudeAiPlugins: false,
  disableClaudeAiConnectors: true,
});

export const CLAUDE_CLOUD_DISABLE_ENV = Object.freeze({
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
  ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
});
