/** Attest native discovery separately from the pinned files on disk. */
import path from 'node:path';
import { CODEX_STOCK_SKILLS } from './codex-stock-skills.lib.mjs';

const rejectDiscovery = () => {
  // Native entries can include private paths and parser excerpts. Keep the
  // diagnostic independent of all response values.
  throw new Error('Codex stock skill discovery is not pristine. Inspect native search paths and restore the pinned catalog before admission.');
};

export function assertCodexStockSkillDiscovery({ result, home, cwd }) {
  const entries = result?.data;
  if (!Array.isArray(entries) || entries.length !== 1) rejectDiscovery();
  const entry = entries[0];
  if (entry?.cwd !== cwd || !Array.isArray(entry.errors) || entry.errors.length !== 0 || !Array.isArray(entry.skills)) rejectDiscovery();
  const expected = new Map(
    Object.keys(CODEX_STOCK_SKILLS.files)
      .filter(file => file.endsWith('/SKILL.md'))
      .map(file => [path.join(home, '.codex/skills/.system', file), path.posix.basename(path.posix.dirname(file))])
  );
  if (entry.skills.length !== expected.size) rejectDiscovery();
  for (const skill of entry.skills) {
    if (!skill || typeof skill.path !== 'string' || !expected.has(skill.path) || skill.name !== expected.get(skill.path) || skill.scope !== 'system' || skill.enabled !== true || skill.pluginId != null) rejectDiscovery();
    expected.delete(skill.path);
  }
  if (expected.size) rejectDiscovery();
}
