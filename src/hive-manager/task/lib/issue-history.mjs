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
  if (issue.number !== number || !['open', 'closed'].includes(issue.state) || issue.pull_request) throw new Error('Follow-up requires a GitHub issue in the destination repository.');
  return issue;
}

function reportUrl(destination, value) {
  if (typeof value !== 'string') return null;
  const prefix = `https://github.com/${destination}/issues/`;
  return value.toLowerCase().startsWith(prefix) && /^[1-9]\d*(?:#issuecomment-[1-9]\d*)?$/.test(value.slice(prefix.length)) ? value : null;
}

async function ledgerReport(file, destination, key) {
  if (file === undefined) return null;
  const { reported } = JSON.parse(await readFile(file, 'utf8'));
  if (!reported || typeof reported !== 'object' || Array.isArray(reported)) throw new Error('The legacy ledger must contain a reported object.');
  const qualifiedKey = `${destination} ${key}`;
  const scoped = Object.entries(reported).find(([name, entry]) => name.toLowerCase() === qualifiedKey && entry)?.[1];
  const unscoped = reported[key];
  const entry = scoped || (reportUrl(destination, unscoped?.url) ? unscoped : null);
  return entry ? { source: 'legacy-ledger', url: reportUrl(destination, entry.url), fixedUpstream: entry.fixedUpstream === true } : null;
}

function reportSource(body, id, attempt, matchNative) {
  if (typeof body !== 'string') return null;
  if (matchNative && body.includes(`<!-- hive-manager-task: ${id}/${attempt} -->`)) return 'hive-manager-marker';
  const markers = body.matchAll(/<!--\s*auto-fix-key:\s*([a-f\d-]+#\d+)\s*-->/gi);
  for (const [, key] of markers) {
    if (key.toLowerCase() === `${id}#${attempt}`) return 'legacy-marker';
  }
  if (attempt === 1 && body.includes(id) && body.includes('auto-fix found') && !body.includes('auto-fix-key:')) return 'legacy-report';
  return null;
}

export async function findReport({ destination, id, attempt, followUp, knownIssue, publishTitle }) {
  const issues = await searchIssues(`repo:${destination} is:issue in:body,comments "${id}"`);
  if (knownIssue) issues.unshift(knownIssue);
  const checked = new Set();
  for (const issue of issues) {
    if (issue.pull_request || !Number.isSafeInteger(issue.number) || issue.number < 1 || checked.has(issue.number)) continue;
    checked.add(issue.number);
    const url = `https://github.com/${destination}/issues/${issue.number}`;
    const source = reportSource(issue.body, id, attempt, !publishTitle || (followUp === undefined && issue.title === publishTitle));
    if (source) return { source, url };
    // The selected route can contain a recent comment still missing from search.
    if (issue.comments === 0 && issue.number !== followUp) continue;
    for (const comment of await issueComments(destination, issue.number)) {
      const source = reportSource(comment.body, id, attempt, !publishTitle || issue.number === followUp);
      if (source) return { source, url: reportUrl(destination, comment.html_url) ?? url };
    }
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

  const closedAt = Date.parse(knownIssue.closed_at);
  const releasedAt = await releaseTime(version);
  let state = 'closed-issue-needs-version-review';
  if (Number.isFinite(closedAt) && Number.isFinite(releasedAt)) state = closedAt > releasedAt ? 'closed-after-installed-release' : 'possible-regression';
  return { state, attemptKey, relatedIssue, installedVersion: version, closedAt: knownIssue.closed_at ?? null, releasedAt: Number.isFinite(releasedAt) ? new Date(releasedAt).toISOString() : null };
}
