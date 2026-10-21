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
  // Formal AI writes `answer_*.lino` derivations under the directory its server
  // runs in, whatever FORMAL_AI_CACHE_DIR says (link-assistant/formal-ai#1208).
  // They restarted the model over "uncommitted changes" five times per draft
  // and were preserved on recovery branches as if they were the user's work.
  // Unlike the dot directories, this is an ordinary path a repository may
  // track, so only untracked files there are tool state: a change to a tracked
  // file, or a commit of one, is the user's work.
  { path: 'data/cache/derivations/', tool: 'formal-ai', untrackedOnly: true },
  { path: '.playwright-mcp/', tool: 'playwright-mcp' },
  // Issue #3656: Claude Code's Agent tool with `isolation: "worktree"` checks
  // every subagent out as a git worktree under `.claude/worktrees/agent-<id>/`
  // and keeps it when the subagent changed something. Each one is a nested
  // repository, so `git add -A` recorded them as gitlinks (mode 160000) in the
  // pull request, and on the next run `git status` reported them as ` M`
  // ("Repository has uncommitted changes after clone"). Only the `worktrees/`
  // subdirectory is tool state: `.claude/settings.json`, `.claude/agents/` and
  // `.claude/skills/` are project configuration a repository commits.
  { path: '.claude/worktrees/', tool: 'claude-code' },
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
  const untracked = statusLine.startsWith('??') || statusLine.startsWith('!!');
  // Issue #3656: callers trim the whole status output, which strips the
  // leading space of a first ` M <path>` line. Reading `M .claude/worktrees/x`
  // as `XY PATH` lost the path's first character, so a moved subagent gitlink
  // listed first was never recognised.
  const pathStart = statusLine[2] !== ' ' && statusLine[1] === ' ' ? 2 : 3;
  return isAiToolScratchFile(statusLine.slice(pathStart), { tracked: !untracked });
};

/**
 * Is this repository-relative path (e.g. from `git ls-files --others`) inside
 * an AI tool scratch directory?
 *
 * @param {string} filePath - e.g. `data/cache/derivations/answer_1.lino`
 * @param {{tracked?: boolean}} [options] - the path is tracked (a modified
 *   status entry or a committed file), so `untrackedOnly` paths do not match
 * @returns {boolean}
 */
export const isAiToolScratchFile = (filePath, { tracked = false } = {}) => {
  const normalized = String(filePath || '')
    .trim()
    .replace(/^"|"$/g, '');
  if (!normalized) return false;
  return AI_TOOL_SCRATCH_PATHS.some(({ path: scratchPath, untrackedOnly }) => {
    if (tracked && untrackedOnly) return false;
    const withoutSlash = scratchPath.replace(/\/$/, '');
    return normalized === withoutSlash || normalized.startsWith(`${withoutSlash}/`);
  });
};

/** Where solve commits its development log (development-log.lib.mjs). */
export const DEVELOPMENT_LOG_PATH = 'dev/log/';

/**
 * Issue #3330: is this committed file solver bookkeeping rather than work - the
 * development log or AI tool scratch? One predicate for both questions: "did
 * this run change anything?" (session-changes.lib.mjs) and "does this pull
 * request contain a change?" (pull-request-changes.lib.mjs). A committed file
 * is tracked, so `data/cache/derivations/` (a path a repository may track) is
 * work here.
 *
 * @param {string} filePath - repository-relative path
 * @returns {boolean}
 */
export const isSolverBookkeepingFile = filePath => {
  const normalized = String(filePath || '')
    .trim()
    .replace(/^"|"$/g, '');
  return normalized.startsWith(DEVELOPMENT_LOG_PATH) || isAiToolScratchFile(normalized, { tracked: true });
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
 * Scratch paths that are scratch whether or not they are tracked: once one is
 * committed (a `.claude/worktrees/agent-*` gitlink), `.git/info/exclude` no
 * longer hides it, so staging has to leave it out explicitly.
 */
export const AI_TOOL_SCRATCH_TRACKED_PATHS = AI_TOOL_SCRATCH_PATHS.filter(entry => !entry.untrackedOnly).map(entry => entry.path.replace(/\/$/, ''));

// `git add -A` hashes every changed file of the workspace (10.4 GB on PR #3531);
// the index-only calls finish in seconds.
const GIT_ADD_TIMEOUT_MS = 10 * 60 * 1000;
const GIT_INDEX_TIMEOUT_MS = 60 * 1000;

/**
 * `git add -A`, then put AI tool scratch back the way HEAD has it.
 *
 * `.git/info/exclude` keeps untracked scratch out of `git add -A`, but not a
 * scratch path that is already tracked (issue #3656: the gitlinks of Claude
 * Code subagent worktrees committed by an earlier auto-commit). Resetting those
 * paths in the index means a moved worktree HEAD is never committed again.
 *
 * @param {string} tempDir - the workspace
 * @param {Function} $ - command-stream tagged-template executor
 * @returns {Promise<{code: number, stderr?: any, stdout?: any}>} the `git add` result
 */
export const stageAllExceptAiToolScratch = async (tempDir, $) => {
  const addResult = await $({ cwd: tempDir, signal: AbortSignal.timeout(GIT_ADD_TIMEOUT_MS) })`git add -A`;
  if (addResult.code !== 0) return addResult;
  for (const scratchPath of AI_TOOL_SCRATCH_TRACKED_PATHS) {
    // A pathspec that matches nothing is fine for `git reset`; in a repository
    // without commits there is no HEAD to reset to, and nothing to protect.
    await $({ cwd: tempDir, signal: AbortSignal.timeout(GIT_INDEX_TIMEOUT_MS) })`git reset -q HEAD -- ${scratchPath} 2>&1`;
  }
  return addResult;
};

/**
 * Committed AI tool scratch on the checked-out branch, e.g. the
 * `.claude/worktrees/agent-*` gitlinks an earlier auto-commit put in a pull
 * request (issue #3656). Logs a warning with the command that removes it.
 *
 * @param {string} tempDir - the workspace
 * @param {Function} $ - command-stream tagged-template executor
 * @param {(msg: string, opts?: object) => Promise<void>} [log]
 * @returns {Promise<string[]>} repository-relative paths, empty when there are none
 */
export const reportTrackedAiToolScratch = async (tempDir, $, log = null) => {
  const tracked = [];
  const roots = [];
  for (const scratchPath of AI_TOOL_SCRATCH_TRACKED_PATHS) {
    const result = await $({ cwd: tempDir, mirror: false, signal: AbortSignal.timeout(GIT_INDEX_TIMEOUT_MS) })`git ls-files -- ${scratchPath}`;
    const paths = result.code === 0 ? (result.stdout?.toString() || '').split('\n').filter(Boolean) : [];
    if (paths.length) roots.push(scratchPath);
    tracked.push(...paths);
  }
  if (tracked.length && log) {
    await log(`⚠️  AI tool scratch is committed on this branch and does not belong in it: ${tracked.join(', ')}`, { level: 'warning' });
    await log(`   Remove it with: git rm -r --cached -- ${roots.join(' ')}`, { level: 'warning' });
  }
  return tracked;
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
  AI_TOOL_SCRATCH_TRACKED_PATHS,
  reportTrackedAiToolScratch,
  stageAllExceptAiToolScratch,
  DEVELOPMENT_LOG_PATH,
  isSolverBookkeepingFile,
  ensureAiToolScratchIgnored,
  filterAiToolScratchFromStatus,
  isAiToolScratchFile,
  isAiToolScratchPath,
};
