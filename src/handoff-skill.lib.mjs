/**
 * HANDOFF.md Agent Skill deployment (issue #1877)
 *
 * Writes the canonical handoff `SKILL.md` (built by handoff.prompts.lib.mjs)
 * into the session working directory so the AI tool loads it natively as an
 * Agent Skill, instead of relying on an injected prompt. The same file is
 * deployed for both supported tools, which discover skills from different
 * directories:
 *   - Claude Code:  .claude/skills/<name>/SKILL.md
 *   - Codex:        .agents/skills/<name>/SKILL.md
 *
 * Both are written (gated behind --use-handoff) so the next session continues
 * to work regardless of which tool runs it — the whole point of cross-tool
 * continuity in issue #1877.
 *
 * The SKILL.md is tool configuration, not project state, so it is:
 *   - re-deployed every session by hive-mind (each session clones fresh), and
 *   - excluded from git via `.git/info/exclude` (a local, never-committed
 *     ignore) so it never pollutes the pull request or the "uncommitted
 *     changes" checks. Only the HANDOFF.md the tool produces is committed.
 */

// Fetch use-m if not available (matches the rest of src/*.lib.mjs).
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const fs = (await use('fs')).promises;
const path = (await use('path')).default;

import { buildHandoffSkillFile, HANDOFF_SKILL_NAME } from './handoff.prompts.lib.mjs';

const noopLog = async () => {};

/**
 * The skill directories (relative to the repo working dir) the SKILL.md is
 * deployed into, one per tool that natively reads the Agent Skills standard.
 */
export const HANDOFF_SKILL_DIRS = Object.freeze([
  path.join('.claude', 'skills', HANDOFF_SKILL_NAME), // Claude Code
  path.join('.agents', 'skills', HANDOFF_SKILL_NAME), // Codex
]);

const SKILL_FILE = 'SKILL.md';

/**
 * Determine whether a path is already tracked by git in the working dir. We
 * never clobber a file the target repository tracks itself.
 */
const isTracked = async ({ $, tempDir, relPath }) => {
  if (!$) return false;
  try {
    const result = await $({ cwd: tempDir })`git ls-files --error-unmatch ${relPath} 2>/dev/null`;
    return result.code === 0;
  } catch {
    return false;
  }
};

/**
 * Resolve the local git exclude file (`.git/info/exclude`), honoring worktrees
 * via `git rev-parse --git-path`. Falls back to the conventional location.
 */
const resolveExcludePath = async ({ $, tempDir }) => {
  if ($) {
    try {
      const result = await $({ cwd: tempDir })`git rev-parse --git-path info/exclude 2>/dev/null`;
      const rel = (result.stdout || '').toString().trim();
      if (result.code === 0 && rel) {
        return path.isAbsolute(rel) ? rel : path.join(tempDir, rel);
      }
    } catch {
      // fall through to default
    }
  }
  return path.join(tempDir, '.git', 'info', 'exclude');
};

/**
 * Append the skill directories to `.git/info/exclude` (idempotent) so the
 * deployed SKILL.md files stay invisible to git and are never committed.
 */
const updateGitExclude = async ({ $, tempDir, log }) => {
  const excludePath = await resolveExcludePath({ $, tempDir });
  // Only touch the exclude file if its parent (.git/info) exists — i.e. this is
  // a real git working dir. Avoid creating a stray `.git/` in non-git dirs.
  try {
    await fs.access(path.dirname(excludePath));
  } catch {
    await log('   Handoff skill: no .git/info directory; skipping git-exclude update', { verbose: true });
    return false;
  }

  let existing = '';
  try {
    existing = await fs.readFile(excludePath, 'utf8');
  } catch {
    existing = '';
  }

  const entries = HANDOFF_SKILL_DIRS.map(dir => `/${dir.split(path.sep).join('/')}/`);
  const missing = entries.filter(entry => !existing.split(/\r?\n/).includes(entry));
  if (missing.length === 0) return true;

  const header = '# hive-mind --use-handoff: experimental HANDOFF.md Agent Skill (issue #1877)';
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}${existing.includes(header) ? '' : header + '\n'}${missing.join('\n')}\n`;
  await fs.writeFile(excludePath, existing + block, 'utf8');
  return true;
};

/**
 * Deploy the handoff SKILL.md into the session working directory.
 *
 * @param {Object} params
 * @param {string} params.tempDir - The repo working directory.
 * @param {Object} params.argv - Parsed CLI args (uses argv.useHandoff).
 * @param {Function} [params.log] - Logger.
 * @param {Function} [params.$] - Command runner (for git checks); optional.
 * @returns {Promise<{deployed: boolean, reason?: string, paths: string[]}>}
 */
export const deployHandoffSkill = async ({ tempDir, argv, log = noopLog, $ = null } = {}) => {
  if (!argv || !argv.useHandoff) {
    return { deployed: false, reason: 'disabled', paths: [] };
  }
  if (!tempDir) {
    return { deployed: false, reason: 'no-temp-dir', paths: [] };
  }

  const content = buildHandoffSkillFile();
  const written = [];

  for (const relDir of HANDOFF_SKILL_DIRS) {
    const relFile = path.join(relDir, SKILL_FILE);
    try {
      if (await isTracked({ $, tempDir, relPath: relFile })) {
        await log(`   Handoff skill: ${relFile} is tracked by the repo; leaving it untouched`, { verbose: true });
        continue;
      }
      const absDir = path.join(tempDir, relDir);
      await fs.mkdir(absDir, { recursive: true });
      await fs.writeFile(path.join(absDir, SKILL_FILE), content, 'utf8');
      written.push(relFile);
    } catch (error) {
      await log(`   Handoff skill: failed to deploy ${relFile}: ${error.message}`, { verbose: true });
    }
  }

  if (written.length > 0) {
    await updateGitExclude({ $, tempDir, log });
    await log(`   Handoff skill deployed (--use-handoff): ${written.join(', ')}`, { verbose: true });
  }

  return { deployed: written.length > 0, paths: written };
};

export default {
  HANDOFF_SKILL_DIRS,
  deployHandoffSkill,
};
