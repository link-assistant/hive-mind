/**
 * Preserve the work that exists only inside git submodules.
 *
 * Issue #3433: when a session is killed or hits a critical error, the work in a
 * submodule (uncommitted files, commits on no remote) is committed inside that
 * submodule, innermost submodule first, on `recovery/<branch>`, and pushed to
 * the submodule's `origin`. Only a submodule commit that reached a remote is
 * recorded as the parent's gitlink: a parent pointer to a commit that exists
 * only in this workspace is a broken checkout for everyone else.
 *
 * When the submodule's `origin` refuses the push and it is a GitHub repository,
 * the work is pushed to the authenticated user's fork instead
 * (`gh repo fork --clone=false`). When that fails too, the pointer is not
 * recorded and the failure is logged loudly and returned in `failed`.
 *
 * Two modes:
 * - `snapshot` (critical-error recovery): the submodule's branch, index and
 *   working tree are left untouched; the commit is built in a private index.
 * - `commit` (the kill/interrupt auto-commit): after the push succeeds the
 *   submodule's HEAD moves to the commit (`git reset -q`, working tree kept), so
 *   the parent's own `git add -A` records the pushed commit.
 *
 * Every command goes through the caller's `$` (injectable) and nothing throws.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3433
 */

import { rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { SUBMODULE_NETWORK_TIMEOUT_MS, attempt, collectSubmoduleWork, errorOf, hasGitmodules, innermostFirst, listSubmodules, outputOf, parseGitHubRepo, replaceGitHubRepo, runIn } from './git-submodules.lib.mjs';
import { classifyUntrackedFiles, recoveryBranchFor, seedIndexFromRealIndex } from './preserved-files.lib.mjs';

const noLog = async () => {};
const short = sha => String(sha || '').slice(0, 8);

/** Run a git command with an optional private index. */
const gitWithIndex =
  (git, indexFile) =>
  (strings, ...values) => {
    if (!indexFile) return git(strings, ...values);
    // `GIT_INDEX_FILE=<quoted path> git ...`: the path is an interpolated (shell-quoted) value.
    const [first, ...rest] = strings;
    const raw = strings.raw || strings;
    const patched = Object.assign(['GIT_INDEX_FILE=', ` ${first}`, ...rest], { raw: ['GIT_INDEX_FILE=', ` ${raw[0]}`, ...raw.slice(1)] });
    return git(patched, indexFile, ...values);
  };

/**
 * Make the index of `cwd` record, for each direct child submodule, either the
 * commit that reached a remote (`ok`) or the gitlink of HEAD (`!ok`): a
 * pointer to a commit that exists only in this workspace is never recorded.
 *
 * @param {{$: Function, cwd: string, indexFile?: string|null, children: Array<Object>}} params
 *   `children` are {@link preserveSubmoduleWork} entries whose `parentAbs` is `cwd`.
 * @returns {Promise<{ok: boolean, errors: string[]}>}
 */
export const applyGitlinkDecisions = async ({ $, cwd, indexFile = null, children = [] }) => {
  const git = gitWithIndex(runIn($, cwd), indexFile);
  const plain = runIn($, cwd);
  const errors = [];
  for (const child of children) {
    let result;
    if (child.ok && child.commit) {
      result = await attempt(() => git`git update-index --add --cacheinfo ${`160000,${child.commit},${child.smPath}`}`);
    } else {
      const head = await attempt(() => plain`git ls-tree HEAD -- ${child.smPath}`);
      const match = /^160000 commit ([0-9a-f]+)\t/.exec(outputOf(head));
      result = match ? await attempt(() => git`git update-index --add --cacheinfo ${`160000,${match[1]},${child.smPath}`}`) : await attempt(() => git`git update-index --force-remove -- ${child.smPath}`);
    }
    if (result.code !== 0) errors.push(`${child.path}: ${errorOf(result)}`);
  }
  return { ok: errors.length === 0, errors };
};

/** Build a commit of the submodule's work in a private index; HEAD, index and working tree are not changed. */
const snapshotSubmodule = async ({ $, submodule, children, message }) => {
  const git = runIn($, submodule.abs);
  let indexFile = null;
  try {
    const indexPath = outputOf(await attempt(() => git`git rev-parse --git-path hive-mind-recovery.index`)).trim();
    if (!indexPath) return { error: 'cannot locate the git directory' };
    indexFile = isAbsolute(indexPath) ? indexPath : join(submodule.abs, indexPath);
    const indexed = gitWithIndex(git, indexFile);
    const untracked = outputOf(await attempt(() => git`git ls-files --others --exclude-standard`))
      .split('\n')
      .filter(Boolean);
    const { keep, skipped } = await classifyUntrackedFiles(submodule.abs, untracked);
    // Issue #3656: a copy of the real index keeps the stat cache; `read-tree HEAD` only without one.
    const realIndexPath = outputOf(await attempt(() => git`git rev-parse --git-path index`)).trim();
    const seeded = await seedIndexFromRealIndex({ cwd: submodule.abs, realIndexPath, indexFile });
    const steps = [...(seeded ? [] : [() => indexed`git read-tree HEAD`]), () => indexed`git add -u`, ...keep.map(path => () => indexed`git add -- ${path}`)];
    for (const step of steps) {
      const result = await attempt(step);
      if (result.code !== 0) return { error: `could not stage: ${errorOf(result)}`, skipped };
    }
    const links = await applyGitlinkDecisions({ $, cwd: submodule.abs, indexFile, children });
    if (!links.ok) return { error: `could not record nested submodules: ${links.errors.join('; ')}`, skipped };
    const tree = outputOf(await attempt(() => indexed`git write-tree`)).trim();
    const headTree = outputOf(await attempt(() => git`git rev-parse HEAD^{tree}`)).trim();
    if (!tree) return { error: 'git write-tree failed', skipped };
    if (tree === headTree) return { commit: null, preserved: [], skipped };
    const created = await attempt(() => git`git commit-tree ${tree} -p HEAD -m ${message}`);
    const commit = outputOf(created).trim();
    if (created.code !== 0 || !commit) return { error: `git commit-tree failed: ${errorOf(created)}`, skipped };
    const preserved = outputOf(await attempt(() => git`git diff-tree -r --name-only HEAD ${tree}`))
      .split('\n')
      .filter(Boolean);
    return { commit, preserved, skipped };
  } finally {
    if (indexFile) await rm(indexFile, { force: true }).catch(() => {});
  }
};

/** The fork `gh repo fork` created or found, e.g. `✓ Created fork me/sandbox` / `! me/sandbox already exists`. */
const parseForkName = (output, upstream) => {
  const names = String(output || '').match(/[A-Za-z0-9][\w.-]*\/[\w.-]+/g) || [];
  return names.map(name => name.replace(/\.git$/, '')).find(name => name.toLowerCase() !== upstream.toLowerCase() && !name.includes('github.com')) || null;
};

/**
 * Push `refspec` from a submodule to its `origin`, else (GitHub only) to the
 * user's fork of it.
 *
 * @returns {Promise<{pushed: boolean, remote?: string, fork?: string, forkUrl?: string, error?: string}>}
 */
export const pushSubmoduleCommit = async ({ $, cwd, commit, branch, log = noLog, force = true }) => {
  const net = runIn($, cwd, SUBMODULE_NETWORK_TIMEOUT_MS);
  const refspec = `${commit}:refs/heads/${branch}`;
  const pushed = force ? await attempt(() => net`git push --force origin ${refspec} 2>&1`) : await attempt(() => net`git push origin ${refspec} 2>&1`);
  if (pushed.code === 0) return { pushed: true, remote: 'origin' };
  const originError = errorOf(pushed);
  const originUrl = outputOf(await attempt(() => runIn($, cwd)`git config --get remote.origin.url`)).trim();
  const upstream = parseGitHubRepo(originUrl);
  if (!upstream) return { pushed: false, error: `push to origin failed: ${originError}` };
  const upstreamName = `${upstream.owner}/${upstream.repo}`;
  await log(`   🍴 origin of submodule refused the push; trying a fork of ${upstreamName}...`);
  const forked = await attempt(() => net`gh repo fork ${upstreamName} --clone=false 2>&1`);
  let forkName = parseForkName(outputOf(forked), upstreamName);
  if (!forkName) {
    const login = outputOf(await attempt(() => net`gh api user --jq .login`)).trim();
    if (login) forkName = `${login}/${upstream.repo}`;
  }
  if (!forkName || forkName.toLowerCase() === upstreamName.toLowerCase()) return { pushed: false, error: `push to origin failed (${originError}) and no fork is available: ${errorOf(forked)}` };
  const forkUrl = replaceGitHubRepo(originUrl, forkName);
  const forkPush = force ? await attempt(() => net`git push --force ${forkUrl} ${refspec} 2>&1`) : await attempt(() => net`git push ${forkUrl} ${refspec} 2>&1`);
  if (forkPush.code === 0) return { pushed: true, remote: forkUrl, fork: forkName, forkUrl, upstream: upstreamName };
  return { pushed: false, error: `push to origin failed (${originError}); push to the fork ${forkName} failed: ${errorOf(forkPush)}` };
};

/**
 * Commit and push the work inside every submodule of `cwd`, innermost first.
 *
 * @param {object} params
 * @param {Function} params.$ - command-stream executor (also runs `gh`).
 * @param {string} params.cwd - the top-level working tree.
 * @param {string} [params.branchName] - the PR branch; submodule work goes to `recovery/<branchName>`.
 * @param {string} [params.recoveryBranch] - Issue #3572: the recovery branch name the caller already
 *   resolved (the parent's), used in every submodule instead of `recovery/<branchName>`.
 * @param {string} [params.reason]
 * @param {'snapshot'|'commit'} [params.mode='snapshot']
 * @param {string} [params.message] - commit message in the submodules.
 * @param {boolean} [params.push=true] - with `false` nothing is pushed and every commit is recorded locally.
 * @param {Function} [params.log]
 * @returns {Promise<{attempted: boolean, submodules: Array<Object>, failed: Array<Object>, top: Array<Object>}>}
 *   `submodules`: one entry per submodule that held work - `{path, smPath, abs, parentAbs, depth,
 *   commit, snapshot, changed, pushed, ok, recoveryBranch, remote, fork, preserved, error}`;
 *   `ok` means the parent may record `commit` as its gitlink. `top`: the entries
 *   of the direct submodules of `cwd`, for {@link applyGitlinkDecisions}.
 */
export const preserveSubmoduleWork = async ({ $, cwd, branchName, recoveryBranch: resolvedRecoveryBranch = null, reason = 'session interrupted', mode = 'snapshot', message, push = true, log = noLog }) => {
  const none = { attempted: false, submodules: [], failed: [], top: [] };
  if (!hasGitmodules(cwd) || typeof $ !== 'function') return none;
  try {
    const list = await listSubmodules({ $, cwd });
    if (!list.length) return none;
    const work = await collectSubmoduleWork({ $, cwd, submodules: list });
    if (!work.dirty.length) return none;
    const recoveryBranch = resolvedRecoveryBranch || recoveryBranchFor(branchName);
    const canPush = push && Boolean(branchName || resolvedRecoveryBranch);
    const commitMessage = message || `🛟 Work preserved before recovery (${reason})`;
    const byAbs = new Map(work.submodules.map(entry => [entry.abs, entry]));
    const results = new Map();
    await log(`💾 Preserving work inside ${work.dirty.length} submodule(s) on ${recoveryBranch}, innermost first...`);
    for (const submodule of innermostFirst(list)) {
      const entry = byAbs.get(submodule.abs);
      const children = list.filter(other => other.parentAbs === submodule.abs && results.has(other.abs)).map(other => results.get(other.abs));
      const hasWork = entry.status.length || entry.unpushed.length || children.length;
      if (!hasWork && !entry.error) continue;
      const result = { path: submodule.path, smPath: submodule.smPath, abs: submodule.abs, parentAbs: submodule.parentAbs, depth: submodule.depth, url: submodule.url, recoveryBranch, commit: null, snapshot: null, changed: false, pushed: false, ok: false, preserved: [], skipped: [], error: null };
      results.set(submodule.abs, result);
      if (entry.error) {
        result.error = `git status failed: ${entry.error}`;
        await log(`❌ Submodule ${submodule.path}: ${result.error}; the parent does not record a new pointer to it.`, { level: 'error' });
        continue;
      }
      const head = outputOf(await attempt(() => runIn($, submodule.abs)`git rev-parse HEAD`)).trim();
      const snap = await snapshotSubmodule({ $, submodule, children, message: commitMessage });
      if (snap.error) {
        result.error = snap.error;
        await log(`❌ Submodule ${submodule.path}: ${snap.error}; the parent does not record a new pointer to it.`, { level: 'error' });
        continue;
      }
      result.snapshot = snap.commit;
      result.commit = snap.commit || head;
      result.preserved = (snap.preserved || []).map(path => `${submodule.path}/${path}`);
      result.skipped = (snap.skipped || []).map(path => `${submodule.path}/${path}`);
      result.changed = Boolean(snap.commit) || entry.unpushed.length > 0;
      if (!result.changed) {
        result.ok = true;
        continue;
      }
      if (snap.commit) await attempt(() => runIn($, submodule.abs)`git update-ref ${`refs/heads/${recoveryBranch}`} ${snap.commit}`);
      if (!canPush) {
        result.ok = true;
        await log(`   ℹ️ Submodule ${submodule.path}: work committed locally as ${short(result.commit)} (not pushed).`);
        continue;
      }
      const sent = await pushSubmoduleCommit({ $, cwd: submodule.abs, commit: result.commit, branch: recoveryBranch, log });
      Object.assign(result, { pushed: sent.pushed, ok: sent.pushed, remote: sent.remote || null, fork: sent.fork || null, error: sent.error || null });
      if (!sent.pushed) {
        await log(`❌ Submodule ${submodule.path}: could not push ${short(result.commit)} to ${submodule.url || 'its remote'} (${sent.error}). The parent repository does not record a pointer to it; the work exists only in this workspace (${submodule.abs}).`, { level: 'error' });
        continue;
      }
      await log(`✅ Submodule ${submodule.path}: ${short(result.commit)} pushed to ${sent.fork ? `the fork ${sent.fork}` : 'origin'} as ${recoveryBranch}.`);
      if (mode === 'commit' && snap.commit) {
        const moved = await attempt(() => runIn($, submodule.abs)`git reset -q ${snap.commit}`);
        if (moved.code !== 0) {
          result.ok = false;
          result.error = `pushed, but could not move HEAD to it: ${errorOf(moved)}`;
          await log(`❌ Submodule ${submodule.path}: ${result.error}; the parent does not record a pointer to it.`, { level: 'error' });
        }
      }
    }
    const submodules = [...results.values()].sort((a, b) => b.depth - a.depth);
    const top = submodules.filter(entry => entry.depth === 1);
    const failed = submodules.filter(entry => !entry.ok);
    if (failed.length) await log(`❌ ${failed.length} submodule(s) hold work that reached no remote: ${failed.map(entry => entry.path).join(', ')}. Their pointers are not recorded in the parent repository.`, { level: 'error' });
    return { attempted: true, submodules, failed, top };
  } catch (error) {
    await log(`❌ Could not preserve the work inside submodules: ${error?.message || error}`, { level: 'error' });
    return { ...none, attempted: true, error: error?.message || String(error) };
  }
};

/**
 * One sentence about the submodules for a failure comment, or '' without submodule work.
 *
 * @param {{submodules?: Array<Object>, failed?: Array<Object>}|null} outcome
 * @returns {string}
 */
export const describeSubmodulePreservation = outcome => {
  const entries = (outcome?.submodules || []).filter(entry => entry.changed || !entry.ok);
  if (!entries.length) return '';
  const pushed = entries.filter(entry => entry.ok && entry.pushed);
  const failed = entries.filter(entry => !entry.ok);
  const parts = [];
  if (pushed.length) parts.push(`Work inside ${pushed.length} submodule(s) was pushed to \`${pushed[0].recoveryBranch}\` in each submodule's repository (${pushed.map(entry => `\`${entry.path}\` ${short(entry.commit)}${entry.fork ? ` in the fork ${entry.fork}` : ''}`).join(', ')}).`);
  if (failed.length) parts.push(`⚠️ Work inside ${failed.length} submodule(s) reached no remote and exists only in the workspace; the parent repository does not point to it: ${failed.map(entry => `\`${entry.path}\` (${entry.error || 'not pushed'})`).join(', ')}.`);
  return parts.join(' ');
};

export default { applyGitlinkDecisions, describeSubmodulePreservation, preserveSubmoduleWork, pushSubmoduleCommit };
