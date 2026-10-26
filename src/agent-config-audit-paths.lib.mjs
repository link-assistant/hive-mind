/** Conventional and explicitly selected global configuration surfaces. */
import path from 'node:path';

const unsafe = () => new Error('Global agent configuration has unsafe effective paths; no repair is permitted. Use absolute, normalized tool directories without links.');

export function agentConfigAuditScopes({ tool = 'all', homeDir, env = {} }) {
  const scopes = [];
  for (const name of tool === 'all' ? ['claude', 'codex'] : [tool]) {
    if (!['claude', 'codex'].includes(name)) continue;
    const conventional = path.join(homeDir, `.${name}`);
    const override = env[name === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME'];
    if (override !== undefined && (typeof override !== 'string' || (override !== '' && (!path.isAbsolute(override) || path.normalize(override) !== override || override === path.parse(override).root || /[\0\r\n]/u.test(override))))) throw unsafe();
    for (const configDir of new Set([conventional, override || conventional])) {
      scopes.push({ tool: name, configDir, conventional, additional: configDir !== conventional });
    }
  }
  return scopes;
}
