#!/usr/bin/env node

/**
 * Issue #2119: keep AI tools' own scratch state out of the solver's workspace
 * bookkeeping.
 *
 * AI tools drop working files into the directory they are run in. Formal AI
 * writes `.formal-ai/` (a `general-change-plan.lino` plan file and friends);
 * Playwright MCP writes `.playwright-mcp/` (issue #1124). Neither belongs to the
 * user's change, but `git status --porcelain` reports them all the same, so the
 * solver read them as "the AI left uncommitted changes" and restarted the tool -
 * every iteration, forever, because restarting recreates the same scratch dir:
 *
 *     🔍 Checking for uncommitted changes...
 *     ?? .formal-ai/
 *     📝 Found uncommitted changes
 *     🔄 AUTO-RESTART: Restarting Agent to handle uncommitted changes...
 *
 * (docs/case-studies/issue-2119/data/logs/agent-scala-solution-draft.log:5425)
 *
 * The same state also reached `git add -A` on the auto-commit paths, which would
 * have published a tool's private scratch files in the user's pull request.
 *
 * Every tool integration has its own `checkForUncommittedChanges`
 * (claude/codex/agent/opencode/gemini/qwen/agent-commander), so filtering inside
 * any one of them would fix one caller and leave the rest. Instead the paths are
 * written to `.git/info/exclude`, which makes git itself stop reporting them:
 * every status check, every `git add -A` and every diff agrees, without touching
 * the repository's own `.gitignore` (that would show up in the pull request).
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Scratch paths AI tools create inside the workspace they are run in.
 *
 * Keep this list to directories a tool owns entirely. Anything a user might
 * legitimately want committed must not be here.
 */
export const AI_TOOL_SCRATCH_PATHS = [
  { path: '.formal-ai/', tool: 'formal-ai' },
  { path: '.playwright-mcp/', tool: 'playwright-mcp' },
];

const EXCLUDE_HEADER = '# hive-mind: AI tool scratch directories (issue #2119)';

/**
 * Does this `git status --porcelain` line describe only AI tool scratch state?
 *
 * @param {string} statusLine - e.g. `?? .formal-ai/`
 * @returns {boolean}
 */
export const isAiToolScratchPath = statusLine => {
  if (typeof statusLine !== 'string') return false;
  // Porcelain v1: two status characters, a space, then the path.
  const filePath = statusLine.slice(3).trim().replace(/^"|"$/g, '');
  if (!filePath) return false;
  return AI_TOOL_SCRATCH_PATHS.some(({ path: scratchPath }) => {
    const withoutSlash = scratchPath.replace(/\/$/, '');
    return filePath === withoutSlash || filePath.startsWith(`${withoutSlash}/`);
  });
};

/**
 * Drop AI tool scratch entries from `git status --porcelain` output.
 *
 * A fallback for workspaces set up before `ensureAiToolScratchIgnored` ran (an
 * existing clone, a resumed run), so a stale scratch directory cannot restart
 * the restart loop.
 *
 * @param {string} statusOutput - raw `git status --porcelain` output
 * @returns {string} the same output without scratch-only lines
 */
export const filterAiToolScratchFromStatus = statusOutput => {
  if (!statusOutput) return '';
  return statusOutput
    .split('\n')
    .filter(line => line.trim() && !isAiToolScratchPath(line))
    .join('\n');
};

/**
 * Teach a cloned workspace to ignore AI tool scratch directories.
 *
 * Writes to `.git/info/exclude` rather than `.gitignore`: the exclude file is
 * local to the clone, is never staged, and therefore never appears in the pull
 * request. Idempotent - re-running leaves the file unchanged.
 *
 * @param {string} tempDir - the cloned workspace
 * @param {(msg: string, opts?: object) => Promise<void>} [log]
 * @returns {Promise<{applied: boolean, reason?: string, added?: string[]}>}
 */
export const ensureAiToolScratchIgnored = async (tempDir, log = null) => {
  const excludePath = path.join(tempDir, '.git', 'info', 'exclude');
  const report = async msg => {
    if (log) await log(msg, { verbose: true });
  };

  let existing = '';
  try {
    existing = await fs.readFile(excludePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      await report(`⚠️  Could not read ${excludePath}: ${error.message}`);
      return { applied: false, reason: 'unreadable' };
    }
    // A worktree or a fresh clone may not have the file yet; creating it is fine.
  }

  const existingLines = new Set(
    existing
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
  );
  const missing = AI_TOOL_SCRATCH_PATHS.map(entry => entry.path).filter(scratchPath => !existingLines.has(scratchPath));

  if (missing.length === 0) {
    return { applied: true, reason: 'already_present', added: [] };
  }

  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  const block = existingLines.has(EXCLUDE_HEADER) ? `${missing.join('\n')}\n` : `${EXCLUDE_HEADER}\n${missing.join('\n')}\n`;

  try {
    await fs.mkdir(path.dirname(excludePath), { recursive: true });
    await fs.writeFile(excludePath, `${existing}${separator}${block}`, 'utf8');
  } catch (error) {
    await report(`⚠️  Could not update ${excludePath}: ${error.message}`);
    return { applied: false, reason: 'unwritable' };
  }

  await report(`🧹 Ignoring AI tool scratch directories in this workspace: ${missing.join(', ')}`);
  return { applied: true, added: missing };
};

export default {
  AI_TOOL_SCRATCH_PATHS,
  ensureAiToolScratchIgnored,
  filterAiToolScratchFromStatus,
  isAiToolScratchPath,
};
