/** Conventional and explicitly selected global configuration surfaces. */
import path from 'node:path';

const unsafe = () => new Error('Global agent configuration has unsafe effective paths; no repair is permitted. Use absolute, normalized tool directories without links.');

/** Codex 0.164.0 selects <name>.config.toml with --profile. Enumerate only
 * native-selectable names, without reading auth/history or allocating an
 * unbounded directory listing. File safety is checked by the audit validator.
 */
export function codexProfileConfigPaths({ configDir, fsImpl }) {
  let directory;
  try {
    // hive-sync-ok: bounded startup admission must enumerate profiles without yielding after its validated snapshot.
    directory = fsImpl.opendirSync(configDir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw unsafe();
  }
  const profiles = [];
  try {
    let entry;
    let count = 0;
    // hive-sync-ok: this startup scan stops after 10,001 entries and reads no auth/history file contents.
    while ((entry = directory.readSync()) !== null) {
      if (++count > 10_000) throw unsafe();
      if (/^[a-zA-Z0-9_-]+\.config\.toml$/u.test(entry.name)) profiles.push(path.join(configDir, entry.name));
    }
  } catch {
    throw unsafe();
  } finally {
    // hive-sync-ok: close the startup scan descriptor before admission or repair continues.
    directory.closeSync();
  }
  return profiles.sort();
}

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
