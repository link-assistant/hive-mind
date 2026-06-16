/**
 * Core, offline-testable logic for the `hive-cleanup` command (issue #1848).
 *
 * This module deliberately avoids any top-level network access (no `use-m`
 * fetch) and any side effects so it can be unit-tested without a network
 * connection or a real filesystem. All OS interaction (reading /tmp, querying
 * `$ --status`, scanning /proc, deleting paths, apt cleanup) lives in
 * `cleanup.os.lib.mjs` / `cleanup.mjs`; this module only contains pure
 * classification, parsing and formatting helpers.
 *
 * The classification mirrors the manual workflow described in the issue: list
 * the temporary directories under the tmp root, figure out which ones belong to
 * currently-running solve tasks (by branch name, the same way solve.mjs derives
 * branches), and keep those while removing the rest. Protected system paths such
 * as `/tmp/start-command/` are always preserved unless explicitly forced.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1848
 */

import { isValidIssueBranchName } from './solve.branch.lib.mjs';

/**
 * Directory names directly under the tmp root that must never be removed by
 * default because deleting them would interfere with the system's ability to
 * run or be debugged. `start-command` holds the isolation session logs that
 * `$ --status`, /log and /terminal_watch rely on.
 */
export const DEFAULT_PROTECTED_NAMES = ['start-command'];

/**
 * System-owned temp entries that we never touch even in `--all` mode unless the
 * user explicitly opts in. These are created by the OS / desktop / language
 * runtimes and removing them mid-flight can break unrelated processes.
 */
export const SYSTEM_PROTECTED_PATTERNS = [/^\.X11-unix$/, /^\.XIM-unix$/, /^\.ICE-unix$/, /^\.font-unix$/, /^\.Test-unix$/, /^systemd-private-/, /^snap-private-tmp$/, /^snap\./, /^\.snap/, /^dbus-/, /^ssh-/, /^hsperfdata_/, /^\.org\.chromium\./, /^\.com\.google\.Chrome\./];

/**
 * Patterns for temporary entries that are unambiguously created by hive-mind
 * (solve.mjs, github.lib.mjs, claude.lib.mjs, telegram-*, etc.). These are safe
 * to delete when they are not tied to an active task. Each entry has a `name`
 * (for reporting) and a `regex` matched against the basename under the tmp root.
 *
 * Sources are referenced inline so future maintainers can keep this list in
 * sync with the code that produces the files.
 */
export const HIVE_MIND_TEMP_PATTERNS = [
  // solve.repository.lib.mjs / solve.execution.lib.mjs workspace clones
  { name: 'solve workspace clone', regex: /^gh-issue-solver-\d+$/ },
  { name: 'solve resume workspace', regex: /^gh-issue-solver-resume-.+$/ },
  // solve.repository.lib.mjs buildWorkspacePath parent dir
  { name: 'solve workspace root', regex: /^hive-mind-solve-gh-/ },
  // github.lib.mjs log download working dirs
  { name: 'solution draft log dir', regex: /^log-tmp-solution-draft-log-/ },
  // claude.lib.mjs MCP config temp files
  { name: 'claude MCP config', regex: /^claude-mcp-no-useless-.+\.json$/ },
  { name: 'claude MCP config', regex: /^claude-mcp-.+\.json$/ },
  // github.lib.mjs comment / body temp files
  { name: 'solution draft log', regex: /^solution-draft-log-.+\.txt$/ },
  { name: 'log upload comment', regex: /^log-upload-comment-.+\.md$/ },
  { name: 'log comment', regex: /^log-comment-.+\.md$/ },
  // github-error-reporter.lib.mjs
  { name: 'issue body temp', regex: /^hive-mind-issue-body-.+\.md$/ },
  // solve.auto-pr.lib.mjs / solve.results.lib.mjs
  { name: 'PR body temp', regex: /^pr-body-.+$/ },
  { name: 'PR title temp', regex: /^pr-title-.+\.txt$/ },
  // solve.progress-monitoring.lib.mjs
  { name: 'PR progress temp', regex: /^pr-progress-.+$/ },
  // telegram-top-command.lib.mjs
  { name: 'telegram top output', regex: /^top-output-.+\.txt$/ },
  // start-screen.mjs
  { name: 'screen ready marker', regex: /^screen-ready-.+\.marker$/ },
];

/**
 * Parse a GitHub issue/PR URL out of an arbitrary string (e.g. a solve command
 * line). Self-contained so this module stays offline-safe (github.lib.mjs is
 * not import-safe because of its top-level use-m fetch).
 *
 * @param {string} url
 * @returns {{owner: string, repo: string, type: 'issue'|'pull', number: number}|null}
 */
export function parseTaskUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const match = url.match(/github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?\/(issues|issue|pull|pulls)\/(\d+)/i);
  if (!match) return null;
  const type = /^pull/i.test(match[3]) ? 'pull' : 'issue';
  return {
    owner: match[1],
    repo: match[2],
    type,
    number: Number(match[4]),
  };
}

/**
 * Extract all GitHub issue/PR references from a command line string. A solve
 * command typically takes the URL as its first positional argument, but we scan
 * the whole string to be tolerant of flag ordering.
 *
 * @param {string} command
 * @returns {Array<{owner: string, repo: string, type: 'issue'|'pull', number: number}>}
 */
export function extractTaskRefsFromCommand(command) {
  if (!command || typeof command !== 'string') return [];
  const refs = [];
  const seen = new Set();
  const re = /github\.com[/:]([^/\s]+)\/([^/\s#]+?)(?:\.git)?\/(issues|issue|pull|pulls)\/(\d+)/gi;
  let m;
  while ((m = re.exec(command)) !== null) {
    const ref = parseTaskUrl(m[0]);
    if (!ref) continue;
    const key = `${ref.owner}/${ref.repo}#${ref.number}:${ref.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}

/**
 * Normalise an owner/repo pair extracted from a git remote URL.
 *
 * @param {string} remoteUrl
 * @returns {{owner: string, repo: string}|null}
 */
export function parseRemoteUrl(remoteUrl) {
  if (!remoteUrl || typeof remoteUrl !== 'string') return null;
  // git@github.com:owner/repo.git  OR  https://github.com/owner/repo(.git)
  const sshMatch = remoteUrl.match(/^[^@]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  const httpMatch = remoteUrl.match(/^[a-z]+:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/i);
  if (httpMatch) return { owner: httpMatch[1], repo: httpMatch[2] };
  return null;
}

function sameRepo(a, b) {
  if (!a || !b) return false;
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase();
}

/**
 * Build the set of "active task matchers" from the running session task list.
 * For PR tasks the resolved head branch is matched exactly; for issue tasks we
 * fall back to the `issue-{number}-{hex}` prefix (the random hex is unknown from
 * the URL alone) combined with a repo match.
 *
 * @param {Array<{owner, repo, type, number, branch?: string|null, sessionId?: string|null, sessionName?: string|null, status?: string|null, workspace?: string|null}>} activeTasks
 * @returns {Array<{owner, repo, type, number: number|null, issueNumber: number|null, branch: string|null, sessionId: string|null, sessionName: string|null, status: string|null, workspace: string|null}>}
 */
export function buildActiveMatchers(activeTasks) {
  const matchers = [];
  for (const task of activeTasks || []) {
    if (!task) continue;
    matchers.push({
      owner: task.owner,
      repo: task.repo,
      type: task.type,
      number: task.number ?? null,
      issueNumber: task.type === 'issue' ? task.number : (task.issueNumber ?? null),
      branch: task.branch || null,
      sessionId: task.sessionId || null,
      sessionName: task.sessionName || null,
      status: task.status || null,
      workspace: task.workspace || null,
    });
  }
  return matchers;
}

/**
 * Decide whether a folder's git info matches one of the active task matchers.
 *
 * @param {{branch: string|null, remotes: Array<{owner, repo}>}|null} gitInfo
 * @param {Array} matchers - from buildActiveMatchers
 * @returns {Object|null} the matched matcher, or null
 */
export function folderMatchesActiveTask(gitInfo, matchers) {
  if (!gitInfo || !Array.isArray(matchers)) return null;
  const remotes = gitInfo.remotes || [];
  for (const m of matchers) {
    // 1. Exact branch match (covers PR continue-mode and any known branch).
    if (m.branch && gitInfo.branch && gitInfo.branch === m.branch) {
      return m;
    }
    // 2. issue-{number}-{hex} prefix match scoped to the same repository.
    if (m.issueNumber != null && gitInfo.branch && isValidIssueBranchName(gitInfo.branch, m.issueNumber)) {
      const repoMatches = remotes.length === 0 || remotes.some(r => sameRepo(r, m));
      if (repoMatches) return m;
    }
  }
  return null;
}

function matchesAny(name, patterns) {
  return patterns.some(p => (p.regex || p).test(name));
}

/**
 * Identify the hive-mind temp pattern a name matches, if any.
 *
 * @param {string} name
 * @returns {{name: string}|null}
 */
export function matchHiveMindPattern(name) {
  return HIVE_MIND_TEMP_PATTERNS.find(p => p.regex.test(name)) || null;
}

/**
 * Pure classification of a single temp entry into keep/remove with a reason.
 *
 * Reason precedence (highest first): protected > self > active-process >
 * active-task > dirty-worktree > hive-mind-temp (remove) > all-mode (remove) >
 * unrecognized (keep).
 *
 * @param {{name: string, path: string, isDirectory: boolean}} entry
 * @param {Object} ctx
 * @param {string[]} ctx.protectedNames
 * @param {boolean} ctx.forceStartCommand
 * @param {boolean} ctx.includeSystem - allow classifying system entries in --all
 * @param {boolean} ctx.includeAll - consider non-hive-mind entries for removal
 * @param {boolean} ctx.keepDirty
 * @param {Set<string>} ctx.selfPaths - absolute paths the cleanup process itself uses
 * @param {Set<string>} ctx.heldPaths - absolute paths held by running processes
 * @param {Array} ctx.matchers - active task matchers
 * @param {Map<string,{branch, remotes, dirty}>} ctx.gitInfoByPath
 * @returns {{action: 'keep'|'remove', reason: string}}
 */
export function classifyEntry(entry, ctx) {
  const { protectedNames = DEFAULT_PROTECTED_NAMES, forceStartCommand = false, includeSystem = false, includeAll = false, keepDirty = true, selfPaths = new Set(), heldPaths = new Set(), matchers = [], gitInfoByPath = new Map() } = ctx || {};

  const name = entry.name;

  // 1. Protected names (start-command can be forced).
  const isStartCommand = name === 'start-command';
  if (protectedNames.includes(name)) {
    if (isStartCommand && forceStartCommand) {
      // fall through to deletion logic below
    } else {
      return { action: 'keep', reason: 'protected' };
    }
  }

  // 1b. System-owned entries are protected unless explicitly included.
  if (!includeSystem && matchesAny(name, SYSTEM_PROTECTED_PATTERNS)) {
    return { action: 'keep', reason: 'system-protected' };
  }

  // 2. Paths the cleanup process itself depends on (its own clone / cwd).
  if (selfPaths.has(entry.path)) {
    return { action: 'keep', reason: 'self' };
  }

  // 3. Held open / used as cwd by a running process.
  if (heldPaths.has(entry.path)) {
    return { action: 'keep', reason: 'active-process' };
  }

  // 4. Matches an active solve task by branch / repo.
  const gitInfo = gitInfoByPath.get(entry.path);
  const matched = folderMatchesActiveTask(gitInfo, matchers);
  if (matched) {
    return { action: 'keep', reason: 'active-task' };
  }

  // 5. Dirty / unpushed worktree: keep by default to avoid losing work.
  if (keepDirty && gitInfo && gitInfo.dirty) {
    return { action: 'keep', reason: 'dirty-worktree' };
  }

  // 6. Recognised hive-mind temp artifact -> safe to remove.
  if (matchHiveMindPattern(name)) {
    return { action: 'remove', reason: isStartCommand ? 'forced-start-command' : 'hive-mind-temp' };
  }

  // start-command forced but not a hive-mind pattern: still remove when forced.
  if (isStartCommand && forceStartCommand) {
    return { action: 'remove', reason: 'forced-start-command' };
  }

  // 7. --all mode removes anything not otherwise kept.
  if (includeAll) {
    return { action: 'remove', reason: 'all-mode' };
  }

  // 8. Default: leave unrecognised entries alone.
  return { action: 'keep', reason: 'unrecognized' };
}

/**
 * Classify a list of temp entries.
 *
 * @param {Array<{name, path, isDirectory, size?: number}>} entries
 * @param {Object} ctx - see classifyEntry
 * @returns {{keep: Array, remove: Array}} each item: {name, path, size, reason}
 */
export function classifyEntries(entries, ctx) {
  const keep = [];
  const remove = [];
  const { matchers = [], gitInfoByPath = new Map() } = ctx || {};
  for (const entry of entries || []) {
    const { action, reason } = classifyEntry(entry, ctx);
    const gitInfo = gitInfoByPath.get(entry.path) || null;
    const activeTask = reason === 'active-task' ? folderMatchesActiveTask(gitInfo, matchers) : null;
    const record = { name: entry.name, path: entry.path, size: entry.size ?? null, reason, gitInfo, activeTask };
    if (action === 'remove') remove.push(record);
    else keep.push(record);
  }
  return { keep, remove };
}

/**
 * Human-readable, base-1024 byte formatting (matches `du -h` style closely
 * enough for reporting).
 *
 * @param {number|null|undefined} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes == null || Number.isNaN(bytes)) return '?';
  if (bytes < 1024) return `${bytes}B`;
  const units = ['K', 'M', 'G', 'T', 'P'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${units[unit]}`;
}

/**
 * Aggregate totals for a classification result.
 *
 * @param {{keep: Array, remove: Array}} classified
 * @returns {{keepCount, removeCount, keepBytes, removeBytes}}
 */
export function summarize(classified) {
  const sum = list => list.reduce((acc, item) => acc + (item.size || 0), 0);
  return {
    keepCount: classified.keep.length,
    removeCount: classified.remove.length,
    keepBytes: sum(classified.keep),
    removeBytes: sum(classified.remove),
  };
}

/**
 * Human-readable label for a keep/remove reason code.
 * @param {string} reason
 * @returns {string}
 */
export function describeReason(reason) {
  const map = {
    protected: 'protected path',
    'system-protected': 'system-owned temp',
    self: 'used by this cleanup process',
    'active-process': 'in use by a running process',
    'active-task': 'belongs to an active task',
    'dirty-worktree': 'has uncommitted/unpushed changes',
    'hive-mind-temp': 'hive-mind temporary artifact',
    'forced-start-command': 'start-command (forced)',
    'all-mode': 'removed by --all',
    unrecognized: 'not a recognised hive-mind artifact',
  };
  return map[reason] || reason;
}

function firstRemote(gitInfo) {
  return gitInfo?.remotes?.[0] || null;
}

function compactTaskType(type) {
  return type === 'pull' ? 'PR' : 'issue';
}

/**
 * Format an active task for logs.
 *
 * @param {{owner?: string, repo?: string, type?: string, number?: number|null, issueNumber?: number|null, branch?: string|null, sessionId?: string|null, sessionName?: string|null, status?: string|null, workspace?: string|null}} task
 * @returns {string}
 */
export function formatTaskSummary(task) {
  if (!task) return '';
  const number = task.number ?? task.issueNumber ?? null;
  const parts = [`${task.owner}/${task.repo} ${compactTaskType(task.type)} #${number ?? '?'}`];
  if (task.branch) parts.push(`branch ${task.branch}`);
  if (task.sessionId || task.sessionName) parts.push(`session ${task.sessionId || task.sessionName}`);
  if (task.status) parts.push(`status ${task.status}`);
  if (task.workspace) parts.push(`workspace ${task.workspace}`);
  return parts.join(', ');
}

/**
 * Format per-entry git/task context for one-line cleanup reports.
 *
 * @param {{gitInfo?: {branch?: string|null, remotes?: Array<{owner, repo}>|null, dirty?: boolean}|null, activeTask?: Object|null}} item
 * @returns {string}
 */
export function formatEntryContext(item) {
  const details = [];
  if (item?.activeTask) details.push(`task ${formatTaskSummary(item.activeTask)}`);

  const gitInfo = item?.gitInfo;
  if (gitInfo) {
    const remote = firstRemote(gitInfo);
    const gitParts = [];
    if (remote) gitParts.push(`repo ${remote.owner}/${remote.repo}`);
    if (gitInfo.branch) gitParts.push(`branch ${gitInfo.branch}`);
    if (gitInfo.dirty) gitParts.push('dirty/unpushed');
    if (gitParts.length > 0) details.push(gitParts.join(', '));
  }

  return details.length > 0 ? ` (${details.join('; ')})` : '';
}
