/**
 * Dependabot runs that pass while updating nothing (issue #4055).
 *
 * With one multi-ecosystem group, an open group pull request blocks the next
 * one: every scheduled job logs "Detected existing pull request … Deferring
 * creation of a new pull request" and the follow-up `recreate` job refreshes
 * only the dependencies the pull request already had
 * (dependabot/dependabot-core#16791). Pull request #2285 stayed open for 52
 * days, obsolete since main moved to a newer major and showing 37 "Dependabot
 * is rebasing this PR" banners. Every Dependabot run in that time passed.
 */
export const DEPENDABOT_LOGIN = 'dependabot[bot]';
/** Twice the daily schedule's room for review: older than this, the pull request is the bottleneck. */
export const MAX_OPEN_DAYS = 14;
/** One banner is a rebase in progress; several mean the rebase never finishes. */
export const MAX_REBASE_BANNERS = 2;
const REBASE_BANNER = 'Dependabot is rebasing this PR';

/**
 * @param {object[]} pulls open pull requests from the REST API
 * @param {{now?: number, maxOpenDays?: number, maxRebaseBanners?: number}} [options]
 * @returns {{number: number, url: string, title: string, reasons: string[]}[]}
 */
export function findStuckDependabotPullRequests(pulls, { now = Date.now(), maxOpenDays = MAX_OPEN_DAYS, maxRebaseBanners = MAX_REBASE_BANNERS } = {}) {
  const stuck = [];
  for (const pull of pulls) {
    if (pull.state !== 'open' || pull.user?.login !== DEPENDABOT_LOGIN) continue;
    const reasons = [];
    const days = Math.floor((now - Date.parse(pull.created_at)) / 86_400_000);
    if (days > maxOpenDays) reasons.push(`open for ${days} days (limit ${maxOpenDays})`);
    const banners = String(pull.body || '').split(REBASE_BANNER).length - 1;
    if (banners > maxRebaseBanners) reasons.push(`${banners} unfinished "${REBASE_BANNER}" banners`);
    if (reasons.length) stuck.push({ number: pull.number, url: pull.html_url, title: pull.title, reasons });
  }
  return stuck;
}

export function formatStuckReport(stuck) {
  return [`${stuck.length} Dependabot pull request(s) block newer updates:`, ...stuck.map(pull => `- #${pull.number} ${pull.title}: ${pull.reasons.join('; ')} (${pull.url})`), 'Dependabot defers every new group update to an open group pull request and never adds newer updates to it (dependabot/dependabot-core#16791).', 'Merge it if it is still current, otherwise close it; the next scheduled run opens a fresh one.'].join('\n');
}
