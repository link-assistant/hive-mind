/**
 * HANDOFF.md Agent Skill deployment (issue #1877)
 *
 * Writes the canonical handoff `SKILL.md` (built by handoff.prompts.lib.mjs)
 * into the session working directory so the AI tool loads it natively as an
 * Agent Skill, instead of relying on an injected prompt.
 *
 * Both supported tools read the Agent Skills standard, but from different
 * hardcoded project directories (neither tool exposes a setting or env var to
 * point at a custom/shared folder):
 *   - Claude Code:  .claude/skills/<name>/SKILL.md
 *   - Codex:        .agents/skills/<name>/SKILL.md
 *
 * To answer "can both CLIs use the SAME folder?": there is no native shared
 * location, so we make one ourselves. The SKILL.md is written exactly ONCE into
 * a single real directory (the Claude path, `.claude/skills/handoff/`), and the
 * Codex path (`.agents/skills/handoff`) is a relative **symlink** pointing at
 * that one real directory. Both tools therefore read byte-for-byte the same
 * file from a single source of truth on disk — not two copies that could drift.
 * If the filesystem cannot create a symlink (e.g. Windows without privilege),
 * we fall back to writing a real second copy so the feature still works.
 *
 * The deployed skill is tool configuration, not project state, so it is:
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

const SKILL_FILE = 'SKILL.md';

/**
 * The single real skill directory the SKILL.md is written into. Claude Code
 * reads it directly; Codex reaches the same files through a symlink (below).
 * @type {string}
 */
export const HANDOFF_PRIMARY_SKILL_DIR = path.join('.claude', 'skills', HANDOFF_SKILL_NAME);

/**
 * Additional skill directories that should resolve to the same SKILL.md. Each
 * is created as a symlink to HANDOFF_PRIMARY_SKILL_DIR (one source of truth),
 * falling back to a real copy only if symlinking is unsupported.
 * @type {string[]}
 */
export const HANDOFF_LINKED_SKILL_DIRS = Object.freeze([
  path.join('.agents', 'skills', HANDOFF_SKILL_NAME), // Codex
]);

/**
 * All skill directories the deployment touches (primary + links). Kept for the
 * git-exclude bookkeeping and for callers/tests that enumerate every location.
 * @type {string[]}
 */
export const HANDOFF_SKILL_DIRS = Object.freeze([HANDOFF_PRIMARY_SKILL_DIR, ...HANDOFF_LINKED_SKILL_DIRS]);

/**
 * Determine whether a path is already tracked by git in the working dir. We
 * never clobber a file/dir the target repository tracks itself.
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
 * deployed SKILL.md files (real dir and symlink alike) stay invisible to git.
 * Entries are written WITHOUT a trailing slash so they match both a real
 * directory and a directory symlink (git would not match a symlink against a
 * `dir/` pattern).
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

  const entries = HANDOFF_SKILL_DIRS.map(dir => `/${dir.split(path.sep).join('/')}`);
  const existingLines = existing.split(/\r?\n/);
  const missing = entries.filter(entry => !existingLines.includes(entry));
  if (missing.length === 0) return true;

  const header = '# hive-mind --use-handoff: experimental HANDOFF.md Agent Skill (issue #1877)';
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}${existing.includes(header) ? '' : header + '\n'}${missing.join('\n')}\n`;
  await fs.writeFile(excludePath, existing + block, 'utf8');
  return true;
};

/**
 * Write the real SKILL.md into the primary skill directory.
 */
const writeRealSkill = async ({ tempDir, content }) => {
  const absDir = path.join(tempDir, HANDOFF_PRIMARY_SKILL_DIR);
  await fs.mkdir(absDir, { recursive: true });
  await fs.writeFile(path.join(absDir, SKILL_FILE), content, 'utf8');
  return absDir;
};

/**
 * Make `relLinkDir` resolve to the same files as the primary skill directory.
 * Prefers a relative symlink (single source of truth); if symlinking is not
 * supported, falls back to writing a real copy of the SKILL.md.
 *
 * @returns {Promise<'symlink'|'copy'>}
 */
const linkOrCopySkill = async ({ tempDir, relLinkDir, primaryAbsDir, content }) => {
  const absLinkDir = path.join(tempDir, relLinkDir);
  const parent = path.dirname(absLinkDir);
  await fs.mkdir(parent, { recursive: true });
  const relTarget = path.relative(parent, primaryAbsDir);

  // Reconcile any pre-existing entry (e.g. from a prior session re-deploy).
  try {
    const st = await fs.lstat(absLinkDir);
    if (st.isSymbolicLink()) {
      const current = await fs.readlink(absLinkDir);
      if (current === relTarget) return 'symlink'; // already correct
      await fs.rm(absLinkDir, { recursive: true, force: true });
    } else if (st.isDirectory()) {
      // A real directory is already there (prior copy fallback). Refresh the
      // copy in place rather than replacing the directory.
      await fs.writeFile(path.join(absLinkDir, SKILL_FILE), content, 'utf8');
      return 'copy';
    } else {
      await fs.rm(absLinkDir, { force: true });
    }
  } catch {
    // Nothing there yet — fall through and create it.
  }

  try {
    await fs.symlink(relTarget, absLinkDir, 'dir');
    return 'symlink';
  } catch {
    await fs.mkdir(absLinkDir, { recursive: true });
    await fs.writeFile(path.join(absLinkDir, SKILL_FILE), content, 'utf8');
    return 'copy';
  }
};

/**
 * Deploy the handoff SKILL.md into the session working directory.
 *
 * @param {Object} params
 * @param {string} params.tempDir - The repo working directory.
 * @param {Object} params.argv - Parsed CLI args (uses argv.useHandoff).
 * @param {Function} [params.log] - Logger.
 * @param {Function} [params.$] - Command runner (for git checks); optional.
 * @returns {Promise<{deployed: boolean, reason?: string, paths: string[], shared: boolean}>}
 */
export const deployHandoffSkill = async ({ tempDir, argv, log = noopLog, $ = null } = {}) => {
  if (!argv || !argv.useHandoff) {
    return { deployed: false, reason: 'disabled', paths: [], shared: false };
  }
  if (!tempDir) {
    return { deployed: false, reason: 'no-temp-dir', paths: [], shared: false };
  }

  const content = buildHandoffSkillFile();
  const written = [];
  let allShared = true;

  // 1. Write the single real SKILL.md (unless the repo tracks it itself).
  const primaryRelFile = path.join(HANDOFF_PRIMARY_SKILL_DIR, SKILL_FILE);
  let primaryAbsDir = path.join(tempDir, HANDOFF_PRIMARY_SKILL_DIR);
  if (await isTracked({ $, tempDir, relPath: primaryRelFile })) {
    await log(`   Handoff skill: ${primaryRelFile} is tracked by the repo; leaving it untouched`, { verbose: true });
  } else {
    try {
      primaryAbsDir = await writeRealSkill({ tempDir, content });
      written.push(primaryRelFile);
    } catch (error) {
      await log(`   Handoff skill: failed to deploy ${primaryRelFile}: ${error.message}`, { verbose: true });
      return { deployed: false, reason: 'write-failed', paths: [], shared: false };
    }
  }

  // 2. Point every other tool's skill dir at that same real directory.
  for (const relLinkDir of HANDOFF_LINKED_SKILL_DIRS) {
    const relFile = path.join(relLinkDir, SKILL_FILE);
    if (await isTracked({ $, tempDir, relPath: relFile })) {
      await log(`   Handoff skill: ${relFile} is tracked by the repo; leaving it untouched`, { verbose: true });
      continue;
    }
    try {
      const mode = await linkOrCopySkill({ tempDir, relLinkDir, primaryAbsDir, content });
      if (mode !== 'symlink') allShared = false;
      written.push(relFile);
    } catch (error) {
      await log(`   Handoff skill: failed to link ${relFile}: ${error.message}`, { verbose: true });
    }
  }

  if (written.length > 0) {
    await updateGitExclude({ $, tempDir, log });
    const how = allShared ? 'one shared folder via symlink' : 'copied (symlink unsupported)';
    await log(`   Handoff skill deployed (--use-handoff, ${how}): ${written.join(', ')}`, { verbose: true });
  }

  return { deployed: written.length > 0, paths: written, shared: allShared };
};

export default {
  HANDOFF_PRIMARY_SKILL_DIR,
  HANDOFF_LINKED_SKILL_DIRS,
  HANDOFF_SKILL_DIRS,
  deployHandoffSkill,
};
