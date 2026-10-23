/**
 * Git submodules of a workspace and the work that exists only inside them.
 *
 * Issue #3433: in a repository whose code lives in git submodules, the AI's work
 * is in the submodules, but every "is there unsaved work?" check looked only at
 * the top-level repository. `git status --porcelain` there prints one line,
 * ` M modules/sandbox`, for 161 uncommitted files and 4 commits that exist on no
 * remote. These helpers look inside every checked-out submodule, recursively.
 *
 * Every git call goes through the caller's command-stream `$` (injectable for
 * tests) and never throws: an unreadable submodule is reported, not fatal.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3433
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isAiToolScratchPath } from './ai-tool-scratch.lib.mjs';

/** Local git commands (status, rev-list, read-tree...). */
export const SUBMODULE_GIT_TIMEOUT_MS = 60_000;
/** git push / fetch / ls-remote and gh calls. */
export const SUBMODULE_NETWORK_TIMEOUT_MS = 180_000;

/** At most this many submodule status lines go into a log, a comment or a prompt. */
export const SUBMODULE_LINES_LIMIT = 200;

/** A quiet, captured and time-bounded command-stream tag in `cwd`. */
export const runIn = ($, cwd, timeoutMs = SUBMODULE_GIT_TIMEOUT_MS) => $({ cwd, mirror: false, capture: true, signal: AbortSignal.timeout(timeoutMs) });

export const outputOf = result => (result?.stdout ?? '').toString();
export const errorOf = result => (result?.stderr ?? '').toString().trim() || outputOf(result).trim() || `exit code ${result?.code}`;

/** Run a command; a throw becomes a failed result, so callers only check `code`. */
export const attempt = async run => {
  try {
    return (await run()) || { code: 1, stdout: '', stderr: 'no result' };
  } catch (error) {
    return { code: 1, stdout: '', stderr: error?.message || String(error) };
  }
};

/**
 * Whether the workspace declares submodules. Without `.gitmodules` no
 * submodule command runs at all, so a repository without submodules is handled
 * exactly as before.
 */
export const hasGitmodules = cwd => {
  try {
    return Boolean(cwd) && existsSync(join(cwd, '.gitmodules')); // hive-sync-ok: one stat of the solve workspace, never from a bot handler
  } catch {
    return false;
  }
};

/**
 * Resolve a `.gitmodules` URL. A relative URL (`../sandbox.git`) is relative to
 * the superproject's remote, as `git submodule` resolves it.
 *
 * @param {string} url
 * @param {string|null} baseUrl - the superproject's remote URL
 * @returns {string}
 */
export const resolveSubmoduleUrl = (url, baseUrl) => {
  if (!url || !/^\.\.?\//.test(url) || !baseUrl) return url;
  let base = baseUrl.replace(/\/+$/, '');
  let rest = url;
  let separator = '/';
  while (rest.startsWith('./') || rest.startsWith('../')) {
    if (rest.startsWith('./')) {
      rest = rest.slice(2);
      continue;
    }
    rest = rest.slice(3);
    const cut = Math.max(base.lastIndexOf('/'), base.lastIndexOf(':'));
    if (cut < 0) break;
    separator = base[cut];
    base = base.slice(0, cut);
  }
  return `${base}${separator}${rest}`;
};

/**
 * `owner/repo` of a GitHub remote URL (https, ssh or scp form), or null.
 *
 * @param {string} url
 * @returns {{owner: string, repo: string}|null}
 */
export const parseGitHubRepo = url => {
  const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(url || ''));
  return match ? { owner: match[1], repo: match[2] } : null;
};

/** Replace the `owner/repo` of a GitHub URL, keeping its transport (https, ssh). */
export const replaceGitHubRepo = (url, fullName) => String(url).replace(/(github\.com[/:])[^/\s]+\/[^/\s]+?(\.git)?\/?$/, (_m, host, suffix) => `${host}${fullName}${suffix || '.git'}`);

const readConfig = async ($, cwd, args) => {
  const result = await attempt(() => runIn($, cwd)`git config ${args}`);
  return result.code === 0 ? outputOf(result).trim() || null : null;
};

/** The superproject remote a relative submodule URL is resolved against: `upstream` in fork mode, else `origin`. */
const superprojectRemoteUrl = async ($, cwd) => (await readConfig($, cwd, ['--get', 'remote.upstream.url'])) || (await readConfig($, cwd, ['--get', 'remote.origin.url']));

const FOREACH_SCRIPT = 'printf "%s\\t%s\\t%s\\t%s\\n" "$displaypath" "$name" "$sm_path" "$toplevel"';

/**
 * Every checked-out submodule, recursively, parents before children.
 *
 * @param {{$: Function, cwd: string}} params
 * @returns {Promise<Array<{path: string, name: string, smPath: string, abs: string, parentAbs: string, depth: number, url: (string|null)}>>}
 *   `path` is relative to `cwd`, `smPath` to the immediate superproject (`parentAbs`);
 *   `url` is the resolved `.gitmodules` URL.
 */
export const listSubmodules = async ({ $, cwd }) => {
  if (!hasGitmodules(cwd) || typeof $ !== 'function') return [];
  const result = await attempt(() => runIn($, cwd)`git submodule foreach --quiet --recursive ${FOREACH_SCRIPT}`);
  if (result.code !== 0) return [];
  const top = resolve(cwd);
  const depthOf = new Map([[top, 0]]);
  const submodules = [];
  for (const line of outputOf(result).split('\n')) {
    const [path, name, smPath, toplevel] = line.split('\t');
    if (!path || !smPath || !toplevel) continue;
    const parentAbs = resolve(toplevel);
    const abs = resolve(parentAbs, smPath);
    const depth = (depthOf.get(parentAbs) ?? 0) + 1;
    depthOf.set(abs, depth);
    submodules.push({ path, name: name || smPath, smPath, abs, parentAbs, depth, url: null });
  }
  for (const submodule of submodules) {
    const declared = await readConfig($, submodule.parentAbs, ['-f', '.gitmodules', '--get', `submodule.${submodule.name}.url`]);
    submodule.url = declared ? resolveSubmoduleUrl(declared, await superprojectRemoteUrl($, submodule.parentAbs)) : null;
  }
  return submodules;
};

/** Deepest first, so a parent records its children's final commits. */
export const innermostFirst = submodules => [...submodules].sort((a, b) => b.depth - a.depth);

/** Prefix a submodule-relative porcelain line with the submodule path. */
const prefixStatusLine = (line, path) => {
  const code = line.slice(0, 3);
  const target = line
    .slice(3)
    .split(' -> ')
    .map(part => `${path}/${part.replace(/^"|"$/g, '')}`)
    .join(' -> ');
  return `${code}${target}`;
};

/**
 * What each submodule holds that its remote does not: uncommitted files and
 * commits on no remote-tracking branch.
 *
 * @param {{$: Function, cwd: string, submodules?: Array}} params
 * @returns {Promise<{submodules: Array<Object>, dirty: Array<Object>, files: number, commits: number, errors: Array<Object>}>}
 *   each entry adds `status` (submodule-relative porcelain lines), `lines`
 *   (the same, prefixed with the submodule path), `unpushed` (commit SHAs) and `error`.
 */
export const collectSubmoduleWork = async ({ $, cwd, submodules = null }) => {
  const list = submodules || (await listSubmodules({ $, cwd }));
  const entries = [];
  for (const submodule of list) {
    const git = runIn($, submodule.abs);
    const status = await attempt(() => git`git status --porcelain --untracked-files=all`);
    const unpushed = await attempt(() => git`git rev-list HEAD --not --remotes`);
    const error = status.code !== 0 ? errorOf(status) : null;
    const statusLines =
      status.code === 0
        ? outputOf(status)
            .split('\n')
            .filter(line => line.trim() && !isAiToolScratchPath(line))
        : [];
    const commits = unpushed.code === 0 ? outputOf(unpushed).split('\n').filter(Boolean) : [];
    entries.push({ ...submodule, status: statusLines, lines: statusLines.map(line => prefixStatusLine(line, submodule.path)), unpushed: commits, error });
  }
  const dirty = entries.filter(entry => entry.status.length || entry.unpushed.length || entry.error);
  return {
    submodules: entries,
    dirty,
    files: entries.reduce((sum, entry) => sum + entry.status.length, 0),
    commits: entries.reduce((sum, entry) => sum + entry.unpushed.length, 0),
    errors: entries.filter(entry => entry.error),
  };
};

/** `modules/sandbox: 161 uncommitted file(s), 4 commit(s) on no remote` */
export const describeSubmoduleEntry = entry => {
  const parts = [];
  if (entry.status.length) parts.push(`${entry.status.length} uncommitted file(s)`);
  if (entry.unpushed.length) parts.push(`${entry.unpushed.length} commit(s) on no remote`);
  if (entry.error) parts.push(`git status failed: ${entry.error}`);
  return `${entry.path}: ${parts.join(', ') || 'clean'}`;
};

/**
 * Porcelain-style lines for the submodules' work: a `## <path>: ...` header per
 * submodule, then its status lines with paths relative to the top level.
 *
 * @param {{dirty: Array<Object>}} work - {@link collectSubmoduleWork} output
 * @param {{limit?: number}} [options]
 * @returns {string[]}
 */
export const formatSubmoduleWorkLines = (work, { limit = SUBMODULE_LINES_LIMIT } = {}) => {
  const lines = [];
  let omitted = 0;
  for (const entry of work?.dirty || []) {
    lines.push(`## ${describeSubmoduleEntry(entry)}`);
    for (const line of entry.lines) {
      if (lines.length < limit) lines.push(line);
      else omitted++;
    }
  }
  if (omitted) lines.push(`## ... and ${omitted} more line(s) inside submodules`);
  return lines;
};

/**
 * The submodule lines every "is there unsaved work?" check appends to the
 * top-level `git status --porcelain` lines: `[]` without `.gitmodules` (no
 * command runs) or without work inside submodules. Never throws.
 *
 * @param {{$: Function, cwd: string}} params
 * @returns {Promise<string[]>}
 */
export const submoduleStatusLines = async ({ $, cwd }) => {
  if (!hasGitmodules(cwd) || typeof $ !== 'function') return [];
  try {
    return formatSubmoduleWorkLines(await collectSubmoduleWork({ $, cwd }));
  } catch {
    return [];
  }
};

/** One summary line, e.g. `644 uncommitted file(s) and 4 commit(s) on no remote in 6 submodule(s)`. */
export const summarizeSubmoduleWork = work => `${work.files} uncommitted file(s) and ${work.commits} commit(s) on no remote in ${work.dirty.length} submodule(s)`;

export default { attempt, collectSubmoduleWork, describeSubmoduleEntry, formatSubmoduleWorkLines, hasGitmodules, innermostFirst, listSubmodules, parseGitHubRepo, replaceGitHubRepo, resolveSubmoduleUrl, runIn, submoduleStatusLines, summarizeSubmoduleWork };
