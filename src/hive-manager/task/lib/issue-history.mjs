import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function githubIssueJson(args) {
  const { ghWithRateLimitRetry } = await import('../../../github-rate-limit.lib.mjs');
  return ghWithRateLimitRetry(async () => {
    const { stdout } = await run('gh', ['api', '--hostname', 'github.com', '--method', 'GET', ...args], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(stdout);
  });
}

async function searchIssues(query) {
  const pages = await githubIssueJson(['search/issues', '--raw-field', `q=${query}`, '--paginate', '--slurp']);
  if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => page.incomplete_results || !Array.isArray(page.items))) throw new Error('GitHub could not confirm whether the incident already exists.');
  const items = pages.flatMap(page => page.items);
  if (pages.some(page => page.total_count > items.length)) throw new Error('GitHub returned incomplete incident search results.');
  return items;
}

async function issueComments(destination, number) {
  const pages = await githubIssueJson([`repos/${destination}/issues/${number}/comments?per_page=100`, '--paginate', '--slurp']);
  if (!Array.isArray(pages) || pages.length === 0 || pages.some(page => !Array.isArray(page))) throw new Error('GitHub could not confirm whether the follow-up already exists.');
  return pages.flat();
}

export async function readIssue(destination, number) {
  const issue = await githubIssueJson([`repos/${destination}/issues/${number}`]);
  const expectedUrl = `https://github.com/${destination}/issues/${number}`;
  if (issue.number !== number || !['open', 'closed'].includes(issue.state) || issue.pull_request || (issue.html_url && issue.html_url.toLowerCase() !== expectedUrl)) {
    throw new Error('Follow-up requires a GitHub issue in the destination repository.');
  }
  return issue;
}

export function reportUrl(destination, value) {
  if (typeof value !== 'string') return null;
  const prefix = `https://github.com/${destination}/issues/`;
  return value.toLowerCase().startsWith(prefix) && /^[1-9]\d*(?:#issuecomment-[1-9]\d*)?$/.test(value.slice(prefix.length)) ? value : null;
}

async function ledgerReport(file, destination, key) {
  if (file === undefined) return null;
  return matchLedgerReport(indexLegacyLedger(JSON.parse(await readFile(file, 'utf8'))), destination, key);
}

export function indexLegacyLedger(ledger) {
  const reported = ledger?.reported;
  if (!reported || typeof reported !== 'object' || Array.isArray(reported)) throw new Error('The legacy ledger must contain a reported object.');
  const index = new Map();
  for (const [name, entry] of Object.entries(reported)) {
    if (entry && !index.has(name.toLowerCase())) index.set(name.toLowerCase(), entry);
  }
  return index;
}

export function matchLedgerReport(index, destination, key) {
  const scoped = index?.get(`${destination} ${key}`);
  const unscoped = index?.get(key);
  const entry = scoped || (reportUrl(destination, unscoped?.url) ? unscoped : null);
  return entry ? { source: 'legacy-ledger', url: reportUrl(destination, entry.url), fixedUpstream: entry.fixedUpstream === true } : null;
}

function reportSource(body, id, attempt, matchNative, exactOnly) {
  if (typeof body !== 'string') return null;
  if (matchNative && body.includes(`<!-- hive-manager-task: ${id}/${attempt} -->`)) return 'hive-manager-marker';
  const markers = body.matchAll(/<!--\s*auto-fix-key:\s*([a-f\d-]+#\d+)\s*-->/gi);
  for (const [, key] of markers) {
    if (key.toLowerCase() === `${id}#${attempt}`) return 'legacy-marker';
  }
  if (!exactOnly && attempt === 1 && body.includes(id) && body.includes('auto-fix found') && !body.includes('auto-fix-key:')) return 'legacy-report';
  return null;
}

export async function findReport({ destination, id, attempt, followUp, knownIssue, publishTitle, exactOnly = false, recentSince }) {
  // Read a known comment target directly, even while GitHub search is catching up.
  const checked = new Set();
  async function checkIssue(issue) {
    if (issue.pull_request || !Number.isSafeInteger(issue.number) || issue.number < 1 || checked.has(issue.number)) return null;
    checked.add(issue.number);
    const url = `https://github.com/${destination}/issues/${issue.number}`;
    const source = reportSource(issue.body, id, attempt, !publishTitle || (followUp === undefined && issue.title === publishTitle), exactOnly);
    if (source) return { source, url };
    // The selected route can contain a recent comment still missing from search.
    if (issue.comments === 0 && issue.number !== followUp) return null;
    for (const comment of await issueComments(destination, issue.number)) {
      const source = reportSource(comment.body, id, attempt, !publishTitle || issue.number === followUp, exactOnly);
      if (source) return { source, url: reportUrl(destination, comment.html_url) ?? url };
    }
    return null;
  }
  if (knownIssue) {
    const found = await checkIssue(knownIssue);
    if (found) return found;
  }
  if (recentSince) {
    // The newest page is a bounded way to recover a newly created issue before indexing.
    const recent = await githubIssueJson([`repos/${destination}/issues`, '--raw-field', 'state=all', '--raw-field', 'per_page=100', '--raw-field', `since=${recentSince}`]);
    if (!Array.isArray(recent)) throw new Error('GitHub could not confirm recent incident issues.');
    for (const issue of recent) {
      if (issue.pull_request || !Number.isSafeInteger(issue.number) || issue.number < 1) continue;
      const source = reportSource(issue.body, id, attempt, true, true);
      if (source) return { source, url: `https://github.com/${destination}/issues/${issue.number}` };
    }
  }
  for (const issue of await searchIssues(`repo:${destination} is:issue in:body,comments "${id}"`)) {
    const found = await checkIssue(issue);
    if (found) return found;
  }
  return null;
}

async function releaseTime(version) {
  try {
    const release = await githubIssueJson([`repos/link-assistant/hive-mind/releases/tags/v${encodeURIComponent(version)}`]);
    return Date.parse(release.published_at);
  } catch (error) {
    if (/HTTP 404\b/.test(error.stderr ?? '')) return NaN;
    throw error;
  }
}

export async function reconcileReport({ destination, followUp, id, attempt }, file, version) {
  const attemptKey = `${id}#${attempt}`;
  const knownIssue = followUp === undefined ? undefined : await readIssue(destination, followUp);
  const relatedIssue = knownIssue && { url: `https://github.com/${destination}/issues/${followUp}`, state: knownIssue.state };
  const found = (await ledgerReport(file, destination, attemptKey)) ?? (await findReport({ destination, id, attempt, followUp, knownIssue }));
  if (found) return { state: found.fixedUpstream ? 'known-fix-recorded' : 'already-reported', attemptKey, relatedIssue, ...found };
  if (knownIssue?.state !== 'closed') return { state: 'unreported', attemptKey, relatedIssue };
  return { attemptKey, ...(await reviewClosedRoute(destination, knownIssue, version)), closedAt: knownIssue.closed_at ?? null };
}

export async function reviewClosedRoute(destination, knownIssue, version) {
  const relatedIssue = { url: `https://github.com/${destination}/issues/${knownIssue.number}`, state: 'closed' };
  const closedAt = Date.parse(knownIssue.closed_at);
  const releasedAt = version && Number.isFinite(closedAt) ? await releaseTime(version) : NaN;
  let state = 'closed-issue-needs-version-review';
  if (Number.isFinite(closedAt) && Number.isFinite(releasedAt)) state = closedAt > releasedAt ? 'closed-after-installed-release' : 'possible-regression';
  return { state, relatedIssue, installedVersion: version, closedAt: Number.isFinite(closedAt) ? new Date(closedAt).toISOString() : null, releasedAt: Number.isFinite(releasedAt) ? new Date(releasedAt).toISOString() : null };
}
