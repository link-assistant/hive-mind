/**
 * Ready check: every submodule pointer of a pull request must be fetchable.
 *
 * Issue #3433: a parent commit whose gitlink points at a submodule commit that
 * exists on no remote is a broken checkout for everyone else
 * (`git submodule update` fails with "not our ref"). Before a pull request is
 * marked ready for review, every gitlink the pull request changes is checked
 * against the URL in `.gitmodules` (`git ls-remote`, then a fetch of the
 * remote's branches and tags into a scratch repository). Unreachable commits are
 * published first: pushed to the submodule's `origin` as the pull request's
 * branch, or, when `origin` is not writable, pushed to a fork with a pull
 * request opened in the submodule's repository (that pull request's
 * `refs/pull/<n>/head` makes the commit fetchable). Whatever is still
 * unreachable keeps the pull request a draft, with a loud log line and a
 * comment.
 *
 * Every command goes through the caller's `$` (injectable for tests). Without
 * `.gitmodules` no command runs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3433
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SUBMODULE_NETWORK_TIMEOUT_MS, attempt, errorOf, hasGitmodules, outputOf, resolveSubmoduleUrl, runIn } from './git-submodules.lib.mjs';
import { pushSubmoduleCommit } from './submodule-preserve.lib.mjs';
import { UNREACHABLE_SUBMODULE_POINTERS_MARKER } from './tool-comments.lib.mjs';

/** The deliberate-draft kind of a pull request kept a draft by this check. */
export const UNREACHABLE_SUBMODULE_POINTER_DRAFT_KIND = 'unreachable_submodule_pointer';

/** Marks the section of the parent pull request description that links the submodule pull requests. */
export const SUBMODULE_PRS_MARKER = '<!-- hive-mind:submodule-prs -->';
const SUBMODULE_PRS_END_MARKER = '<!-- /hive-mind:submodule-prs -->';

const noLog = async () => {};
const short = sha => String(sha || '').slice(0, 8);
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Whether `sha` can be fetched from `url`: it is a ref tip (pull request refs
 * included), or an ancestor of one of the remote's branches or tags.
 *
 * @param {{$: Function, cwd: string, url: string, sha: string}} params - `cwd` is
 *   the checked-out submodule when there is one (its objects make the fetch small)
 * @returns {Promise<{reachable: boolean, error?: string}>}
 */
export const isCommitReachableOnRemote = async ({ $, cwd, url, sha }) => {
  if (!url) return { reachable: false, error: 'no URL in .gitmodules' };
  const listed = await attempt(() => runIn($, cwd, SUBMODULE_NETWORK_TIMEOUT_MS)`git ls-remote ${url}`);
  if (listed.code !== 0) return { reachable: false, error: `git ls-remote failed: ${errorOf(listed)}` };
  const tips = outputOf(listed)
    .split('\n')
    .map(line => line.split('\t')[0])
    .filter(Boolean);
  if (tips.includes(sha)) return { reachable: true };
  let scratch = null;
  try {
    scratch = await mkdtemp(join(tmpdir(), 'hive-submodule-reach-'));
    const git = runIn($, scratch);
    const created = await attempt(() => git`git init -q --bare .`);
    if (created.code !== 0) return { reachable: false, error: `git init failed: ${errorOf(created)}` };
    const objects = outputOf(await attempt(() => runIn($, cwd)`git rev-parse --path-format=absolute --git-path objects`)).trim();
    if (objects && existsSync(objects)) await writeFile(join(scratch, 'objects', 'info', 'alternates'), `${objects}\n`);
    const fetched = await attempt(() => runIn($, scratch, SUBMODULE_NETWORK_TIMEOUT_MS)`git fetch -q --no-tags ${url} +refs/heads/*:refs/reach/heads/* +refs/tags/*:refs/reach/tags/* 2>&1`);
    if (fetched.code !== 0) return { reachable: false, error: `git fetch failed: ${errorOf(fetched)}` };
    const exists = await attempt(() => git`git cat-file -e ${`${sha}^{commit}`}`);
    if (exists.code !== 0) return { reachable: false, error: `${short(sha)} is on no branch or tag of ${url}` };
    const missing = await attempt(() => git`git rev-list --max-count=1 ${sha} --not --glob=refs/reach/*`);
    if (missing.code !== 0) return { reachable: false, error: `git rev-list failed: ${errorOf(missing)}` };
    return outputOf(missing).trim() ? { reachable: false, error: `${short(sha)} is on no branch or tag of ${url}` } : { reachable: true };
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true }).catch(() => {});
  }
};

/** `path -> sha` of the gitlinks in a tree-ish. */
const gitlinksOf = async ($, cwd, treeish) => {
  const listed = await attempt(() => runIn($, cwd)`git ls-tree -r ${treeish}`);
  const links = new Map();
  if (listed.code !== 0) return links;
  for (const line of outputOf(listed).split('\n')) {
    const match = /^160000 commit ([0-9a-f]+)\t(.+)$/.exec(line);
    if (match) links.set(match[2], match[1]);
  }
  return links;
};

/** `path -> url` from the `.gitmodules` of a tree-ish, relative URLs resolved. */
const gitmodulesUrls = async ($, cwd, treeish) => {
  const blob = `${treeish}:.gitmodules`;
  const paths = await attempt(() => runIn($, cwd)`git config --blob ${blob} --get-regexp ${'^submodule\\..*\\.path$'}`);
  const urls = new Map();
  if (paths.code !== 0) return urls;
  const base = outputOf(await attempt(() => runIn($, cwd)`git config --get remote.upstream.url`)).trim() || outputOf(await attempt(() => runIn($, cwd)`git config --get remote.origin.url`)).trim() || null;
  for (const line of outputOf(paths).split('\n')) {
    const match = /^submodule\.(.+)\.path (.+)$/.exec(line.trim());
    if (!match) continue;
    const url = outputOf(await attempt(() => runIn($, cwd)`git config --blob ${blob} --get ${`submodule.${match[1]}.url`}`)).trim();
    urls.set(match[2], url ? resolveSubmoduleUrl(url, base) : null);
  }
  return urls;
};

/**
 * The gitlinks introduced since `baseRef` (all gitlinks without one) that are
 * not reachable from their `.gitmodules` URL, recursively for checked-out submodules.
 *
 * @param {{$: Function, cwd: string, baseRef?: string|null, head?: string, prefix?: string, depth?: number}} params
 * @returns {Promise<Array<{path: string, smPath: string, abs: string|null, sha: string, url: (string|null), depth: number, error: string}>>}
 */
export const findUnreachableSubmodulePointers = async ({ $, cwd, baseRef = null, head = 'HEAD', prefix = '', depth = 1 }) => {
  if (typeof $ !== 'function') return [];
  if (depth === 1 && !hasGitmodules(cwd)) return [];
  if ((await attempt(() => runIn($, cwd)`git cat-file -e ${`${head}:.gitmodules`}`)).code !== 0) return [];
  const current = await gitlinksOf($, cwd, head);
  if (!current.size) return [];
  let previous = new Map();
  if (baseRef) {
    const base = outputOf(await attempt(() => runIn($, cwd)`git merge-base ${head} ${baseRef}`)).trim();
    if (base) previous = await gitlinksOf($, cwd, base);
  }
  const urls = await gitmodulesUrls($, cwd, head);
  const unreachable = [];
  for (const [smPath, sha] of current) {
    if (previous.get(smPath) === sha) continue;
    const abs = join(cwd, smPath);
    const checkedOut = existsSync(join(abs, '.git'));
    const path = `${prefix}${smPath}`;
    const url = urls.get(smPath) || null;
    const check = await isCommitReachableOnRemote({ $, cwd: checkedOut ? abs : cwd, url, sha });
    if (!check.reachable) unreachable.push({ path, smPath, abs: checkedOut ? abs : null, sha, url, depth, error: check.error });
    if (checkedOut && (await attempt(() => runIn($, abs)`git cat-file -e ${`${sha}^{commit}`}`)).code === 0) {
      unreachable.push(...(await findUnreachableSubmodulePointers({ $, cwd: abs, baseRef: previous.get(smPath) || null, head: sha, prefix: `${path}/`, depth: depth + 1 })));
    }
  }
  return unreachable;
};

/** The pull request URL in `gh pr create` output, also from its "already exists" error. */
const parsePullRequestUrl = text => /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/pull\/\d+/.exec(String(text || ''))?.[0] || null;

/** Open (or find) a pull request in the submodule's repository from the fork branch. */
const openSubmodulePullRequest = async ({ $, cwd, upstream, fork, branch, title, body }) => {
  const head = `${fork.split('/')[0]}:${branch}`;
  const { sanitizeForPublication } = await import('./token-sanitization.lib.mjs');
  const [safeTitle, safeBody] = await Promise.all([sanitizeForPublication(title), sanitizeForPublication(body)]);
  const created = await attempt(() => runIn($, cwd, SUBMODULE_NETWORK_TIMEOUT_MS)`gh pr create --repo ${upstream} --head ${head} --title ${safeTitle} --body ${safeBody} 2>&1`);
  const url = parsePullRequestUrl(`${outputOf(created)}\n${created.stderr?.toString() || ''}`);
  return url ? { ok: true, url } : { ok: false, error: errorOf(created) };
};

/** Replace (or append) the marker section that lists the submodule pull requests in the parent description. */
export const withSubmodulePullRequestLinks = (body, pullRequests) => {
  const section = [SUBMODULE_PRS_MARKER, '### Submodule pull requests', '', 'The submodule pointers of this pull request are fetchable through these pull requests:', '', ...pullRequests.map(pr => `- \`${pr.path}\` → ${pr.url}`), SUBMODULE_PRS_END_MARKER].join('\n');
  const text = String(body || '');
  const start = text.indexOf(SUBMODULE_PRS_MARKER);
  const end = text.indexOf(SUBMODULE_PRS_END_MARKER);
  if (start >= 0 && end > start) return `${text.slice(0, start)}${section}${text.slice(end + SUBMODULE_PRS_END_MARKER.length)}`;
  return text.trim() ? `${text.trimEnd()}\n\n${section}\n` : `${section}\n`;
};

const linkPullRequestsInParent = async ({ $, cwd, owner, repo, prNumber, pullRequests, log }) => {
  const net = runIn($, cwd, SUBMODULE_NETWORK_TIMEOUT_MS);
  const read = await attempt(() => net`gh pr view ${String(prNumber)} --repo ${`${owner}/${repo}`} --json body --jq .body`);
  if (read.code !== 0) return log(`⚠️ Could not read PR #${prNumber} to link the submodule pull requests: ${errorOf(read)}`, { level: 'warning' });
  const { sanitizeForPublication } = await import('./token-sanitization.lib.mjs');
  const body = await sanitizeForPublication(withSubmodulePullRequestLinks(outputOf(read).replace(/\n$/, ''), pullRequests));
  const written = await attempt(() => net`gh api ${`repos/${owner}/${repo}/pulls/${prNumber}`} -X PATCH -f ${`body=${body}`}`);
  if (written.code !== 0) await log(`⚠️ Could not link the submodule pull requests in PR #${prNumber}: ${errorOf(written)}`, { level: 'warning' });
};

/**
 * Publish unreachable submodule commits, then check again.
 *
 * @param {object} params
 * @param {Function} params.$
 * @param {string} params.cwd - the parent working tree
 * @param {string} [params.owner] @param {string} [params.repo] @param {number} [params.prNumber]
 * @param {string} [params.branchName] - the branch name used in each submodule repository
 * @param {string|null} [params.baseRef] - only gitlinks changed since this ref are checked
 * @param {boolean} [params.publish=true]
 * @param {number} [params.attempts=3] - re-checks after publishing (GitHub creates `refs/pull/*` asynchronously)
 * @param {Function} [params.sleep]
 * @returns {Promise<{ok: boolean, unreachable: Array<Object>, published: Array<Object>, pullRequests: Array<Object>}>}
 */
export const ensureSubmodulePointersReachable = async ({ $, cwd, owner, repo, prNumber, branchName, baseRef = null, publish = true, attempts = 3, retryDelayMs = 5000, sleep = defaultSleep, log = noLog }) => {
  let unreachable = await findUnreachableSubmodulePointers({ $, cwd, baseRef });
  const published = [];
  const pullRequests = [];
  if (!unreachable.length || !publish || !branchName) return { ok: !unreachable.length, unreachable, published, pullRequests };
  for (const entry of [...unreachable].sort((a, b) => b.depth - a.depth)) {
    if (!entry.abs) continue;
    await log(`📤 Submodule ${entry.path}: ${short(entry.sha)} is on no branch of ${entry.url}; publishing it as ${branchName}...`);
    const sent = await pushSubmoduleCommit({ $, cwd: entry.abs, commit: entry.sha, branch: branchName, log });
    if (!sent.pushed) {
      await log(`❌ Submodule ${entry.path}: could not publish ${short(entry.sha)}: ${sent.error}`, { level: 'error' });
      continue;
    }
    published.push({ ...entry, remote: sent.remote, fork: sent.fork || null });
    if (!sent.fork) continue;
    const title = `Submodule changes for ${owner}/${repo}#${prNumber}`;
    const body = `These commits are recorded as the \`${entry.path}\` submodule pointer by https://github.com/${owner}/${repo}/pull/${prNumber}.`;
    const opened = await openSubmodulePullRequest({ $, cwd: entry.abs, upstream: sent.upstream, fork: sent.fork, branch: branchName, title, body });
    if (opened.ok) {
      pullRequests.push({ path: entry.path, url: opened.url });
      await log(`✅ Submodule ${entry.path}: pull request ${opened.url}`);
    } else await log(`❌ Submodule ${entry.path}: pushed to the fork ${sent.fork}, but could not open a pull request in ${sent.upstream}: ${opened.error}`, { level: 'error' });
  }
  if (pullRequests.length && owner && repo && prNumber) await linkPullRequestsInParent({ $, cwd, owner, repo, prNumber, pullRequests, log });
  if (!published.length) return { ok: false, unreachable, published, pullRequests };
  for (let round = 0; round < Math.max(1, attempts); round++) {
    if (round > 0) await sleep(retryDelayMs);
    unreachable = await findUnreachableSubmodulePointers({ $, cwd, baseRef });
    if (!unreachable.length) break;
  }
  return { ok: !unreachable.length, unreachable, published, pullRequests };
};

/** The ref the pull request is compared against: its base branch, if this clone has it. */
const resolveBaseRef = async ({ $, cwd, owner, repo, prNumber }) => {
  const viewed = await attempt(() => runIn($, cwd, SUBMODULE_NETWORK_TIMEOUT_MS)`gh pr view ${String(prNumber)} --repo ${`${owner}/${repo}`} --json baseRefName,baseRefOid`);
  let info;
  try {
    info = viewed.code === 0 ? JSON.parse(outputOf(viewed)) : {};
  } catch {
    info = {};
  }
  const candidates = [info.baseRefOid && `${info.baseRefOid}^{commit}`, info.baseRefName && `refs/remotes/upstream/${info.baseRefName}`, info.baseRefName && `refs/remotes/origin/${info.baseRefName}`].filter(Boolean);
  for (const candidate of candidates) {
    const found = await attempt(() => runIn($, cwd)`git rev-parse --verify -q ${candidate}`);
    if (found.code === 0 && outputOf(found).trim()) return outputOf(found).trim();
  }
  return null;
};

/** The comment on a pull request kept a draft by this check. */
export const buildUnreachableSubmoduleComment = unreachable => [`## ⚠️ ${UNREACHABLE_SUBMODULE_POINTERS_MARKER}`, '', 'This pull request records submodule commits that are not reachable from the URLs in `.gitmodules`, so it stays a draft (a checkout of it fails with "not our ref"):', '', ...unreachable.map(entry => `- \`${entry.path}\` → \`${short(entry.sha)}\`${entry.url ? ` (${entry.url})` : ''}: ${entry.error || 'not reachable'}`), '', "Push each commit to a branch of the submodule's repository (or open a pull request there), then push this branch again."].join('\n');

/**
 * The readiness veto of verifyResults: `keepsDraft: true` when a submodule
 * pointer of the pull request cannot be fetched after publishing.
 *
 * @param {object} params - `{tempDir, owner, repo, prNumber, branchName, $, log}` plus the options of {@link ensureSubmodulePointersReachable}
 * @returns {Promise<{keepsDraft: boolean, unreachable: Array<Object>}>}
 */
export const vetoUnreachableSubmodulePointers = async ({ tempDir, owner, repo, prNumber, branchName, $, log = noLog, ...options }) => {
  if (!hasGitmodules(tempDir) || typeof $ !== 'function' || !prNumber) return { keepsDraft: false, unreachable: [] };
  try {
    await log('\n🔗 Checking that every submodule pointer can be fetched from .gitmodules...');
    const baseRef = options.baseRef !== undefined ? options.baseRef : await resolveBaseRef({ $, cwd: tempDir, owner, repo, prNumber });
    const result = await ensureSubmodulePointersReachable({ $, cwd: tempDir, owner, repo, prNumber, branchName, log, ...options, baseRef });
    if (result.ok) {
      await log('✅ Every submodule pointer can be fetched.');
      return { keepsDraft: false, unreachable: [], published: result.published, pullRequests: result.pullRequests };
    }
    for (const entry of result.unreachable) await log(`❌ Submodule pointer ${entry.path} → ${short(entry.sha)} cannot be fetched from ${entry.url || '(no URL)'}: ${entry.error}`, { level: 'error' });
    await log(`❌ PR #${prNumber} is not marked ready: ${result.unreachable.length} submodule pointer(s) cannot be fetched.`, { level: 'error' });
    const { markPullRequestLeftInDraft } = await import('./pr-draft-state.lib.mjs');
    markPullRequestLeftInDraft({ owner, repo, prNumber, reason: `${result.unreachable.length} submodule pointer(s) cannot be fetched: ${result.unreachable.map(entry => entry.path).join(', ')}`, kind: UNREACHABLE_SUBMODULE_POINTER_DRAFT_KIND });
    try {
      const { postTrackedComment } = await import('./tool-comments.lib.mjs');
      const posted = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: buildUnreachableSubmoduleComment(result.unreachable) });
      if (!posted?.ok) await log(`  ⚠️  Could not post the unreachable-submodule notice: ${posted?.stderr?.toString() || 'unknown error'}`, { level: 'warning' });
    } catch (error) {
      await log(`  ⚠️  Could not post the unreachable-submodule notice: ${error.message}`, { level: 'warning' });
    }
    return { keepsDraft: true, unreachable: result.unreachable, published: result.published, pullRequests: result.pullRequests };
  } catch (error) {
    await log(`⚠️ Could not check the submodule pointers (continuing): ${error?.message || error}`, { level: 'warning' });
    return { keepsDraft: false, unreachable: [], error: error?.message || String(error) };
  }
};

export default { UNREACHABLE_SUBMODULE_POINTER_DRAFT_KIND, buildUnreachableSubmoduleComment, ensureSubmodulePointersReachable, findUnreachableSubmodulePointers, isCommitReachableOnRemote, vetoUnreachableSubmodulePointers, withSubmodulePullRequestLinks };
