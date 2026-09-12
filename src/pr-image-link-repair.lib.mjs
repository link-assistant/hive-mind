#!/usr/bin/env node
/**
 * Issue #2239 — repair broken GitHub file links (screenshots above all) that an
 * AI tool wrote into a pull request body or into its own PR comments.
 *
 * The failure this module exists for:
 *
 *   In fork mode the working branch is pushed to the **fork**, while the pull
 *   request itself lives in the **upstream** repository. A link of the shape
 *
 *     https://github.com/<upstream>/blob/<branch>/docs/screenshots/x.png?raw=true
 *
 *   therefore 404s, because `<branch>` exists only in the fork. GitHub renders
 *   the 404 as a broken image. Observed on Godmy/frontend#2, and before that on
 *   Jhon-Crow/godot-topdown-MVP#1796 (issue #1561).
 *
 * Issue #1561 fixed this by teaching the prompt builders to print the fork's
 * path in the screenshot example (`screenshotRepoPath`). #2239 is the same bug
 * happening again **with that fix in place**: the prompt said `konard/frontend`
 * and the model still wrote `Godmy/frontend`, because it had the upstream
 * `owner/repo` in front of it all session long. An instruction is a request;
 * this module is the check. It runs after the tool finishes, verifies every
 * repo-relative GitHub link that was published, and rewrites the ones that are
 * broken in the stated repository but resolvable in the branch's real one.
 *
 * Design notes:
 *   - A link is only rewritten when the original is **proven** missing (HTTP
 *     404 from the contents API) and the replacement is **proven** present.
 *     Anything unknown — a network error, a rate limit, an unparseable ref — is
 *     left exactly as the author wrote it.
 *   - Nothing here needs `argv.fork` or the `forkedRepo` plumbing: the pull
 *     request itself states where its head branch lives.
 *
 * See docs/case-studies/issue-2239/ for the full analysis.
 *
 * @module pr-image-link-repair
 */

import { sanitizeForPublication } from './token-sanitization.lib.mjs'; // issue #1745: anything written back to GitHub is sanitized first
import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): caller passes $ already wrapped through wrapDollarWithGhRetry
import { quietProbe } from './quiet-probe.lib.mjs'; // issue #2130: keep read-only probe payloads out of the attached log

/** `https://github.com/<owner>/<repo>/blob|raw/<ref>/<path>` */
const GITHUB_BLOB_LINK_PATTERN = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)\/(blob|raw)\/([^\s"'`)\]<>]+)/g;
/** `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>` */
const RAW_USERCONTENT_LINK_PATTERN = /https?:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9][\w.-]*)\/([A-Za-z0-9][\w.-]*)\/([^\s"'`)\]<>]+)/g;

/** Extensions that make a link an image for reporting purposes. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff', 'ico']);

/**
 * Split a URL tail into its path portion and its `?query`/`#fragment` suffix.
 * @param {string} rest
 * @returns {{pathPart: string, suffix: string}}
 */
const splitQuery = rest => {
  const cut = rest.search(/[?#]/);
  if (cut < 0) return { pathPart: rest, suffix: '' };
  return { pathPart: rest.slice(0, cut), suffix: rest.slice(cut) };
};

/**
 * Split the `<ref>/<path>` tail of a GitHub file URL.
 *
 * A ref may contain slashes (`release/2.0`), so the tail is ambiguous on its
 * own. Known refs — the PR's head branch, its base branch — are matched first,
 * longest first; otherwise the first segment is assumed to be the ref, which is
 * what a 40-character SHA or a single-segment branch name needs.
 *
 * @param {string} rest - everything after `/blob/` (or after `<owner>/<repo>/`)
 * @param {string[]} [refCandidates] - refs known to be relevant to this PR
 * @returns {{ref: string, path: string, suffix: string, refPrefix: string}}
 */
export const splitRefAndPath = (rest, refCandidates = []) => {
  const { pathPart, suffix } = splitQuery(String(rest || ''));
  let refPrefix = '';
  let remainder = pathPart;
  // raw.githubusercontent.com also accepts the fully qualified `refs/heads/<branch>` form.
  for (const prefix of ['refs/heads/', 'refs/tags/']) {
    if (remainder.startsWith(prefix)) {
      refPrefix = prefix;
      remainder = remainder.slice(prefix.length);
      break;
    }
  }
  const sorted = [...new Set(refCandidates.filter(candidate => typeof candidate === 'string' && candidate.length > 0))].sort((a, b) => b.length - a.length);
  for (const candidate of sorted) {
    if (remainder === candidate) return { ref: candidate, path: '', suffix, refPrefix };
    if (remainder.startsWith(`${candidate}/`)) return { ref: candidate, path: remainder.slice(candidate.length + 1), suffix, refPrefix };
  }
  const slash = remainder.indexOf('/');
  if (slash < 0) return { ref: remainder, path: '', suffix, refPrefix };
  return { ref: remainder.slice(0, slash), path: remainder.slice(slash + 1), suffix, refPrefix };
};

/**
 * True when the link's path looks like an image (by extension) or is served raw.
 * @param {{path: string, suffix: string}} link
 * @returns {boolean}
 */
export const looksLikeImageLink = ({ path = '', suffix = '' } = {}) => {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(extension)) return true;
  return /[?&]raw=true\b/.test(suffix);
};

/**
 * Find every repo-and-ref qualified GitHub file link in a Markdown body.
 *
 * Both Markdown (`![alt](url)`) and HTML (`<img src="url">`) embeds are covered,
 * because the URL itself is what is matched — the failing PR used HTML `<img>`.
 * Identical URLs are returned once, with an occurrence count.
 *
 * @param {string} body
 * @param {Object} [options]
 * @param {string[]} [options.refCandidates]
 * @returns {Array<{url: string, owner: string, repo: string, host: string, kind: string, ref: string, path: string, suffix: string, refPrefix: string, occurrences: number, isImage: boolean}>}
 */
export const extractGitHubFileLinks = (body, { refCandidates = [] } = {}) => {
  const text = typeof body === 'string' ? body : '';
  const byUrl = new Map();

  const record = ({ url, owner, repo, host, kind, rest }) => {
    const existing = byUrl.get(url);
    if (existing) {
      existing.occurrences++;
      return;
    }
    const { ref, path, suffix, refPrefix } = splitRefAndPath(rest, refCandidates);
    byUrl.set(url, { url, owner, repo, host, kind, ref, path, suffix, refPrefix, occurrences: 1, isImage: looksLikeImageLink({ path, suffix }) });
  };

  for (const match of text.matchAll(GITHUB_BLOB_LINK_PATTERN)) {
    record({ url: match[0], owner: match[1], repo: match[2], host: 'github.com', kind: match[3], rest: match[4] });
  }
  for (const match of text.matchAll(RAW_USERCONTENT_LINK_PATTERN)) {
    record({ url: match[0], owner: match[1], repo: match[2], host: 'raw.githubusercontent.com', kind: 'raw', rest: match[3] });
  }

  return [...byUrl.values()];
};

/**
 * Rebuild a link's URL against a different repository, preserving everything
 * else about it (host, blob/raw form, ref, path, query and fragment).
 *
 * @param {Object} link - a link from {@link extractGitHubFileLinks}
 * @param {string} owner
 * @param {string} repo
 * @returns {string}
 */
export const rewriteLinkRepository = (link, owner, repo) => {
  const tail = `${link.refPrefix}${link.ref}${link.path ? `/${link.path}` : ''}${link.suffix}`;
  if (link.host === 'raw.githubusercontent.com') return `https://raw.githubusercontent.com/${owner}/${repo}/${tail}`;
  return `https://github.com/${owner}/${repo}/${link.kind}/${tail}`;
};

/**
 * Build a `pathExists` probe backed by the GitHub contents API.
 *
 * Returns `true` when the path resolves at that ref, `false` on a clean 404,
 * and `null` when the answer could not be established (auth, network, rate
 * limit) — callers must treat `null` as "leave the link alone".
 *
 * Answers are memoized per repo/ref/path for the lifetime of the probe, so the
 * three screenshots of a typical PR cost three calls, not nine.
 *
 * @param {Object} options
 * @param {Function} options.$ - command-stream `$`, already gh-retry wrapped
 * @returns {(target: {owner: string, repo: string, ref: string, path: string}) => Promise<boolean|null>}
 */
export const createContentsProbe = ({ $ }) => {
  const cache = new Map();
  return async ({ owner, repo, ref, path }) => {
    if (!owner || !repo || !ref || !path) return null;
    const key = `${owner}/${repo}@${ref}:${path}`;
    if (cache.has(key)) return cache.get(key);
    // Not a list endpoint: `contents/<file>` returns a single object, so
    // --paginate is neither needed nor meaningful here.
    const endpoint = `repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
    let answer;
    try {
      const result = await quietProbe($)`gh api ${endpoint} --jq .sha`;
      if (result && result.code === 0) {
        answer = result.stdout.toString().trim().length > 0;
      } else {
        // `gh api` exits 1 for every HTTP error; only a 404/"Not Found" is
        // evidence of absence. Anything else stays unknown.
        answer = /HTTP 404|Not Found|No commit found for the ref/i.test(`${result?.stderr ?? ''}`) ? false : null;
      }
    } catch {
      answer = null;
    }
    cache.set(key, answer);
    return answer;
  };
};

/**
 * Decide which links in a body are broken-in-place but valid in the branch's
 * real repository, and return the repaired body.
 *
 * Pure with respect to the network: all repository knowledge arrives through
 * `pathExists`, which makes the whole decision table testable offline.
 *
 * @param {Object} options
 * @param {string} options.body
 * @param {string} options.headRepo - `owner/repo` the PR's head branch lives in
 * @param {string[]} [options.refCandidates]
 * @param {string[]} [options.ownRefs] - refs the pull request itself owns; when
 *   given, only links at one of these refs may be repaired
 * @param {Function} options.pathExists
 * @param {boolean} [options.imagesOnly=false] - restrict repairs to image links
 * @param {Function} [options.log]
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<{body: string, changed: boolean, scanned: number, repairs: Array, skipped: Array}>}
 */
export const planLinkRepairs = async ({ body, headRepo, refCandidates = [], ownRefs = [], pathExists, imagesOnly = false, log = async () => {}, verbose = false }) => {
  const original = typeof body === 'string' ? body : '';
  const result = { body: original, changed: false, scanned: 0, repairs: [], skipped: [] };
  if (!original || !headRepo || typeof pathExists !== 'function') return result;

  const [headOwner, headName] = String(headRepo).split('/');
  if (!headOwner || !headName) return result;

  const links = extractGitHubFileLinks(original, { refCandidates }).filter(link => !imagesOnly || link.isImage);
  result.scanned = links.length;
  if (links.length === 0) return result;

  // A link may only be moved to the head repository when it names a ref the
  // pull request owns. Without this, a 404 on an unrelated repository's link
  // could be "repaired" into the head repository purely because the same ref
  // name and path happen to exist there.
  const repairableRefs = new Set(ownRefs.filter(Boolean));

  let repaired = original;
  for (const link of links) {
    if (link.owner.toLowerCase() === headOwner.toLowerCase() && link.repo.toLowerCase() === headName.toLowerCase()) continue;
    if (!link.path) continue;
    if (repairableRefs.size > 0 && !repairableRefs.has(link.ref)) {
      result.skipped.push({ url: link.url, reason: 'foreign-ref' });
      continue;
    }

    const presentAsWritten = await pathExists({ owner: link.owner, repo: link.repo, ref: link.ref, path: link.path });
    if (presentAsWritten !== false) {
      if (presentAsWritten === null) result.skipped.push({ url: link.url, reason: 'existence-unknown' });
      continue;
    }

    const presentInHeadRepo = await pathExists({ owner: headOwner, repo: headName, ref: link.ref, path: link.path });
    if (presentInHeadRepo !== true) {
      result.skipped.push({ url: link.url, reason: presentInHeadRepo === false ? 'missing-in-head-repo' : 'head-repo-unknown' });
      if (verbose) await log(`   ↪ ${link.url} is broken, but ${headRepo}@${link.ref} does not have ${link.path} either — left as written`);
      continue;
    }

    const replacement = rewriteLinkRepository(link, headOwner, headName);
    if (replacement === link.url) continue;
    repaired = repaired.split(link.url).join(replacement);
    result.repairs.push({ from: link.url, to: replacement, occurrences: link.occurrences, isImage: link.isImage });
    if (verbose) await log(`   ↪ ${link.url} → ${replacement}`);
  }

  result.body = repaired;
  result.changed = repaired !== original;
  return result;
};

/**
 * Fetch the pull request fields this repair needs.
 * @param {Object} args
 * @returns {Promise<{body: string, headRepo: string|null, headRef: string|null, headSha: string|null, baseRef: string|null}|null>}
 */
const fetchPullRequest = async ({ $, owner, repo, prNumber, log }) => {
  try {
    const response = await quietProbe($)`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
    if (!response || response.code !== 0) return null;
    const pr = JSON.parse(response.stdout.toString());
    return {
      body: typeof pr.body === 'string' ? pr.body : '',
      headRepo: pr.head?.repo?.full_name ?? null,
      headRef: pr.head?.ref ?? null,
      headSha: pr.head?.sha ?? null,
      baseRef: pr.base?.ref ?? null,
    };
  } catch (error) {
    await log(`⚠️ image-link repair: failed to fetch PR ${prNumber}: ${error.message || error}`);
    return null;
  }
};

/**
 * Repair broken links in the pull request description.
 *
 * @param {Object} args
 * @param {Function} args.$
 * @param {string} args.owner
 * @param {string} args.repo
 * @param {number|string} args.prNumber
 * @param {Function} [args.log]
 * @param {boolean} [args.verbose=false]
 * @param {boolean} [args.dryRun=false] - plan the repairs without editing
 * @returns {Promise<{scanned:number, repaired:number, edited:number, errors:number, repairs:Array, skipped:Array}>}
 */
export const repairPullRequestBodyLinks = async ({ $, owner, repo, prNumber, log = async () => {}, verbose = false, dryRun = false }) => {
  const stats = { scanned: 0, repaired: 0, edited: 0, errors: 0, repairs: [], skipped: [] };
  const pr = await fetchPullRequest({ $, owner, repo, prNumber, log });
  if (!pr) {
    stats.errors++;
    return stats;
  }
  if (!pr.body || !pr.headRepo) return stats;

  const plan = await planLinkRepairs({
    body: pr.body,
    headRepo: pr.headRepo,
    refCandidates: [pr.headRef, pr.baseRef, pr.headSha].filter(Boolean),
    ownRefs: [pr.headRef, pr.headSha].filter(Boolean),
    pathExists: createContentsProbe({ $ }),
    log,
    verbose,
  });
  stats.scanned = plan.scanned;
  stats.repairs = plan.repairs;
  stats.skipped = plan.skipped;
  stats.repaired = plan.repairs.reduce((total, repair) => total + repair.occurrences, 0);
  if (!plan.changed || dryRun) return stats;

  try {
    const payload = JSON.stringify({ body: await sanitizeForPublication(plan.body) });
    const edit = await $({ stdin: payload })`gh api repos/${owner}/${repo}/pulls/${prNumber} -X PATCH --input -`;
    if (edit && edit.code === 0) {
      stats.edited = 1;
    } else {
      stats.errors++;
    }
  } catch (error) {
    await log(`⚠️ image-link repair: failed to edit PR ${prNumber} description: ${error.message || error}`);
    stats.errors++;
  }
  return stats;
};

/**
 * Repair broken links in the bot's own pull request comments.
 *
 * Only comments authored by the running gh user are touched — the same
 * boundary the post-finish sanitization sweep draws (#1745). Issue #1561's
 * broken screenshot was in a comment, not in the description, which is why
 * comments are swept too.
 *
 * @param {Object} args
 * @returns {Promise<{scanned:number, repaired:number, edited:number, errors:number, repairs:Array, skipped:Array}>}
 */
export const repairPullRequestCommentLinks = async ({ $, owner, repo, prNumber, botLogin, log = async () => {}, verbose = false, dryRun = false }) => {
  const stats = { scanned: 0, repaired: 0, edited: 0, errors: 0, repairs: [], skipped: [] };
  if (!botLogin) return stats;
  const pr = await fetchPullRequest({ $, owner, repo, prNumber, log });
  if (!pr) {
    stats.errors++;
    return stats;
  }
  if (!pr.headRepo) return stats;

  let comments;
  try {
    const response = await quietProbe($)`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
    if (!response || response.code !== 0) {
      stats.errors++;
      return stats;
    }
    comments = JSON.parse(response.stdout.toString());
  } catch (error) {
    await log(`⚠️ image-link repair: failed to list comments on PR ${prNumber}: ${error.message || error}`);
    stats.errors++;
    return stats;
  }
  if (!Array.isArray(comments)) return stats;

  const pathExists = createContentsProbe({ $ });
  const refCandidates = [pr.headRef, pr.baseRef, pr.headSha].filter(Boolean);
  const ownRefs = [pr.headRef, pr.headSha].filter(Boolean);

  for (const comment of comments) {
    if (comment?.user?.login !== botLogin) continue;
    const body = typeof comment.body === 'string' ? comment.body : '';
    if (!body) continue;
    const plan = await planLinkRepairs({ body, headRepo: pr.headRepo, refCandidates, ownRefs, pathExists, log, verbose });
    stats.scanned += plan.scanned;
    stats.repairs.push(...plan.repairs);
    stats.skipped.push(...plan.skipped);
    stats.repaired += plan.repairs.reduce((total, repair) => total + repair.occurrences, 0);
    if (!plan.changed || dryRun) continue;
    try {
      const payload = JSON.stringify({ body: await sanitizeForPublication(plan.body) });
      const edit = await $({ stdin: payload })`gh api repos/${owner}/${repo}/issues/comments/${comment.id} -X PATCH --input -`;
      if (edit && edit.code === 0) {
        stats.edited++;
      } else {
        stats.errors++;
      }
    } catch (error) {
      await log(`⚠️ image-link repair: failed to edit comment ${comment.id}: ${error.message || error}`);
      stats.errors++;
    }
  }
  return stats;
};

/**
 * Determine the gh user the repair is running as, so comment authorship can be
 * checked. Returns null when it cannot be established.
 * @param {Function} $
 * @returns {Promise<string|null>}
 */
export const detectBotLogin = async $ => {
  try {
    const result = await quietProbe($)`gh api user --jq .login`;
    if (result && result.code === 0) return result.stdout.toString().trim() || null;
  } catch {
    /* offline or unauthenticated: the comment sweep simply does not run */
  }
  return null;
};

/**
 * Run the whole repair: pull request description first, then the bot's own
 * comments. Idempotent — a second run finds nothing to change.
 *
 * @param {Object} args
 * @returns {Promise<{body:Object, comments:Object, totalRepaired:number, totalEdited:number}>}
 */
export const runPullRequestLinkRepair = async ({ $, owner, repo, prNumber, log = async () => {}, verbose = false, dryRun = false, botLogin: providedBotLogin }) => {
  const empty = { scanned: 0, repaired: 0, edited: 0, errors: 0, repairs: [], skipped: [] };
  const result = { body: { ...empty }, comments: { ...empty }, totalRepaired: 0, totalEdited: 0 };
  if (!owner || !repo || !prNumber) return result;

  result.body = await repairPullRequestBodyLinks({ $, owner, repo, prNumber, log, verbose, dryRun });
  const botLogin = providedBotLogin || (await detectBotLogin($));
  if (botLogin) {
    result.comments = await repairPullRequestCommentLinks({ $, owner, repo, prNumber, botLogin, log, verbose, dryRun });
  } else if (verbose) {
    await log('ℹ️ image-link repair: gh login unknown; skipping the comment sweep.');
  }

  result.totalRepaired = result.body.repaired + result.comments.repaired;
  result.totalEdited = result.body.edited + result.comments.edited;
  return result;
};

/**
 * Run the repair for a finished session and report what it changed, swallowing
 * any failure: a session that produced a correct pull request must not be
 * reported as failed because a read-only link probe could not reach the API.
 *
 * Lives here rather than at the call site so `src/solve.results.lib.mjs` stays
 * under the file-line warning threshold enforced by
 * `scripts/check-file-line-limits.sh`.
 *
 * @param {Object} args
 * @param {Function} args.$ - command-stream tag
 * @param {string} args.owner - owner of the repository hosting the pull request
 * @param {string} args.repo
 * @param {number|string} args.prNumber
 * @param {Function} args.log
 * @param {boolean} [args.verbose]
 * @returns {Promise<Object|null>} the repair result, or null when it did not run
 */
export const reportPullRequestLinkRepair = async ({ $, owner, repo, prNumber, log = async () => {}, verbose = false }) => {
  if (!owner || !repo || !prNumber) return null;
  try {
    const result = await runPullRequestLinkRepair({ $, owner, repo, prNumber, log, verbose });
    if (result.totalEdited > 0) {
      await log(`🖼️  Image-link repair: fixed ${result.totalRepaired} broken link(s) across ${result.totalEdited} published item(s).`);
      for (const repair of [...result.body.repairs, ...result.comments.repairs]) {
        await log(`   ${repair.from} → ${repair.to}`);
      }
    } else if (verbose) {
      await log(`ℹ️  Image-link repair: checked ${result.body.scanned + result.comments.scanned} GitHub link(s); nothing needed repair.`);
    }
    return result;
  } catch (err) {
    await log(`⚠️ Post-finish image-link repair failed: ${err.message || err}`);
    return null;
  }
};

export default {
  splitRefAndPath,
  looksLikeImageLink,
  extractGitHubFileLinks,
  rewriteLinkRepository,
  createContentsProbe,
  planLinkRepairs,
  repairPullRequestBodyLinks,
  repairPullRequestCommentLinks,
  runPullRequestLinkRepair,
  reportPullRequestLinkRepair,
};
